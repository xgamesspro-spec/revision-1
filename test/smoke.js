// Test de bout en bout : lance le serveur sur une base temporaire, avec un faux Google, et teste les routes principales.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

// ----- Faux serveur Google (point de terminaison « token ») -----
const fakeGoogleUsers = {
  'code-lea': { sub: 'g-lea', email: 'Lea.Martin@gmail.com', name: 'Léa Martin' },
  'code-tom': { sub: 'g-tom', email: 'tom.r@gmail.com', name: 'Tom R' },
  'code-xavi': { sub: 'g-xavi', email: 'xavi@gmail.com', name: 'Xavi' },
};
const google = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const p = new URLSearchParams(body);
    const u = fakeGoogleUsers[p.get('code')];
    if (!u || p.get('client_id') !== 'test-client') { res.writeHead(400); return res.end('{}'); }
    const claims = { iss: 'https://accounts.google.com', aud: 'test-client', exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, ...u };
    const jwt = ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id_token: jwt }));
  });
});

(async () => {
  await new Promise(r => google.listen(0, r));
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'classe-test-'));
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${google.address().port}/token`;
  process.env.PUSH_HOST_ALLOWLIST = 'push.test.local';
  const app = require('../server');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  async function call(who, method, url, body, raw = false) {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(jar[who] ? { Cookie: Object.entries(jar[who]).map(([k, v]) => `${k}=${v}`).join('; ') } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      jar[who] = jar[who] || {};
      if (v) jar[who][k] = v; else delete jar[who][k];
    }
    if (raw) return res;
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  // Parcours « Continuer avec Google »
  async function googleLogin(who, code, invite) {
    let r = await call(who, 'GET', `/auth/google${invite ? `?invite=${invite}` : ''}`, null, true);
    if (r.headers.get('location').startsWith('/')) return r.headers.get('location');
    const loc = new URL(r.headers.get('location'));
    assert.equal(loc.hostname, 'accounts.google.com');
    r = await call(who, 'GET', `/auth/google/callback?code=${code}&state=${loc.searchParams.get('state')}`, null, true);
    return r.headers.get('location');
  }
  const thisSchoolYearEnd = () => { const d = new Date(); return d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear(); };

  // --- Premier compte = modérateur (inscription classique autorisée pour le tout premier) ---
  let r = await call('a', 'GET', '/api/setup');
  assert.equal(r.data.firstUser, true); assert.equal(r.data.google, true);
  r = await call('a', 'POST', '/api/register', { username: 'xavi', display_name: 'Xavi', password: 'motdepasse1' });
  assert.equal(r.status, 200); assert.equal(r.data.user.role, 'admin');

  // --- Avec Google activé, l'inscription classique est fermée aux élèves ---
  r = await call('x', 'POST', '/api/register', { username: 'intrus', password: 'motdepasse1', invite: 'X', filiere: 'BTS', fin: '2027' });
  assert.equal(r.status, 403);

  r = await call('a', 'POST', '/api/admin/invites', { uses: 2 });
  const code = r.data.code;

  // --- Google sans code d'invitation : refusé ---
  let loc = await googleLogin('z', 'code-tom', null);
  assert.ok(loc.includes('err=pas_de_compte'), loc);
  loc = await googleLogin('z', 'code-tom', 'MAUVAIS');
  assert.ok(!loc || loc.includes('err=invite'));

  // --- Google + code : on termine l'inscription avec filière + mot de passe ---
  loc = await googleLogin('b', 'code-lea', code);
  assert.ok(loc.startsWith('/#/finaliser?t='), loc);
  const t = loc.split('t=')[1];
  r = await call('b', 'GET', `/api/register/google?t=${t}`);
  assert.equal(r.data.email, 'lea.martin@gmail.com');
  r = await call('b', 'POST', '/api/register/google', { t, display_name: 'Léa', password: 'court', filiere: 'BTS', fin: String(thisSchoolYearEnd()) });
  assert.equal(r.status, 400, 'mot de passe trop court refusé');
  r = await call('b', 'POST', '/api/register/google', { t, display_name: 'Léa', password: 'motdepasse1', filiere: 'XYZ', fin: '2027' });
  assert.equal(r.status, 400, 'filière inconnue refusée');
  r = await call('b', 'POST', '/api/register/google', { t, display_name: 'Léa', password: 'motdepasse1', filiere: 'BTS', fin: String(thisSchoolYearEnd() + 1), intitule: 'SIO SISR' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const lea = r.data.user;
  assert.equal(lea.role, 'eleve'); assert.equal(lea.filiere, 'BTS'); assert.equal(lea.google, true);
  assert.equal(lea.end_date, `${thisSchoolYearEnd() + 1}-07-31`);
  assert.ok(lea.expires_at > Date.parse(lea.end_date), 'délai de grâce après la fin de formation');

  // --- Connexion par email + mot de passe choisi, puis par Google ---
  r = await call('b2', 'POST', '/api/login', { username: 'LEA.MARTIN@gmail.com', password: 'motdepasse1' });
  assert.equal(r.status, 200);
  loc = await googleLogin('b3', 'code-lea', null);
  assert.equal(loc, '/#/');
  r = await call('b3', 'GET', '/api/me');
  assert.equal(r.data.user.id, lea.id);

  // --- Titre pro : fin au mois près ---
  loc = await googleLogin('c', 'code-tom', code);
  const t2 = loc.split('t=')[1];
  const d = new Date(); d.setMonth(d.getMonth() + 8);
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  r = await call('c', 'POST', '/api/register/google', { t: t2, password: 'motdepasse1', filiere: 'TP', fin: ym, intitule: 'TP Technicien d’assistance informatique' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.user.end_date.startsWith(ym));
  const tom = r.data.user;

  // --- Code épuisé (2 utilisations) ---
  r = await call('a', 'GET', '/api/admin/invites');
  assert.equal(r.data.length, 0);

  // --- Accès réservé ---
  r = await call('anon', 'GET', '/api/channels');
  assert.equal(r.status, 401);
  r = await call('b', 'GET', '/api/admin/users');
  assert.equal(r.status, 403);

  // --- Réinitialisation par le modérateur ---
  r = await call('a', 'POST', `/api/admin/users/${lea.id}/reset-password`);
  assert.equal(r.status, 200);
  const temp = r.data.temp;
  r = await call('b', 'GET', '/api/me');
  assert.equal(r.data.user, null, 'sessions coupées après réinitialisation');
  r = await call('b', 'POST', '/api/login', { username: 'lea.martin@gmail.com', password: temp });
  assert.equal(r.data.user.must_change, true);
  r = await call('b', 'GET', '/api/channels');
  assert.equal(r.status, 403); assert.equal(r.data.gate, 'must_change');
  r = await call('b', 'POST', '/api/me/password', { new: 'nouveaumdp1' });
  assert.equal(r.status, 200); assert.equal(r.data.user.must_change, false);

  // --- Salons, forum, révisions ---
  r = await call('b', 'GET', '/api/channels');
  assert.equal(r.status, 200);
  const chat = r.data.find(c => c.kind === 'chat');
  const forum = r.data.find(c => c.kind === 'forum');
  r = await call('b', 'POST', `/api/channels/${chat.id}/messages`, { content: 'Salut <script>alert(1)</script>' });
  assert.equal(r.status, 200);
  r = await call('b', 'POST', `/api/channels/${forum.id}/topics`, { title: 'Broadcast /27 ?', content: 'Je bloque' });
  const tid = r.data.id;
  await call('a', 'POST', `/api/topics/${tid}/replies`, { content: 'Nombre magique 32' });
  await call('b', 'PATCH', `/api/topics/${tid}`, { solved: true });
  r = await call('b', 'GET', `/api/topics/${tid}`);
  assert.equal(r.data.solved, 1); assert.equal(r.data.replies.length, 1);
  r = await call('b', 'GET', '/api/subjects');
  assert.ok(r.data.length >= 8);
  r = await call('b', 'POST', '/api/cards/review', { key: 'reseau:0', ok: true });
  assert.equal(r.data.box, 1);
  r = await call('b', 'POST', '/api/quiz-results', { subject: 'reseau', score: 9, total: 12 });
  assert.equal(r.status, 200);
  r = await call('b', 'GET', '/api/members');
  assert.ok(r.data.find(m => m.id === lea.id).filiere_nom === 'BTS');

  for (const f of fs.readdirSync(path.join(__dirname, '..', 'content', 'matieres'))) {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'matieres', f), 'utf8'));
    for (const q of s.quiz) assert.ok(q.choix[q.reponse] !== undefined, `${f} : ${q.q}`);
  }

  // --- Réunions ---
  r = await call('b', 'POST', '/api/meetings', { name: 'Révision VLAN' });
  const mid = r.data.id;
  r = await call('b', 'POST', `/api/meetings/${mid}/join`, { connId: 'faux' });
  assert.equal(r.status, 400);
  r = await call('a', 'DELETE', `/api/meetings/${mid}`);
  assert.equal(r.status, 200);

  // ================= Espaces par filière =================
  r = await call('b', 'GET', '/api/channels');
  const leaCh = r.data.map(c => c.name);
  assert.ok(leaCh.includes('bts-general') && leaCh.includes('general'), 'BTS voit son salon + les salons communs');
  assert.ok(!leaCh.includes('cap-general') && !leaCh.includes('titre-pro-general'), 'BTS ne voit pas les autres filières');
  const btsGen = r.data.find(c => c.name === 'bts-general');
  const sharedForum = r.data.find(c => c.kind === 'forum' && !c.filiere);
  r = await call('c', 'GET', '/api/channels');
  assert.ok(r.data.some(c => c.name === 'titre-pro-general') && !r.data.some(c => c.name === 'bts-general'));
  r = await call('c', 'POST', `/api/channels/${btsGen.id}/messages`, { content: 'intrusion' });
  assert.equal(r.status, 404, 'impossible d’écrire dans le salon d’une autre filière');
  r = await call('c', 'GET', `/api/channels/${btsGen.id}/messages`);
  assert.equal(r.status, 404, 'impossible de lire le salon d’une autre filière');
  r = await call('a', 'GET', '/api/channels');
  assert.ok(r.data.some(c => c.name === 'cap-general'), 'le modérateur voit tout');
  r = await call('a', 'POST', '/api/channels', { name: 'stage-bts', kind: 'chat', filiere: 'BTS' });
  r = await call('c', 'GET', '/api/channels');
  assert.ok(!r.data.some(c => c.name === 'stage-bts'));

  // ================= Pièces jointes (OWASP) =================
  const sharp = require('sharp');
  async function upload(who, name, buf) {
    const res = await fetch(base + '/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(name), Cookie: Object.entries(jar[who]).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: buf,
    });
    return { status: res.status, data: await res.json() };
  }
  // Photo de téléphone avec métadonnées EXIF (auteur, appareil) : elles doivent disparaître
  const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3a7' } })
    .jpeg().withExif({ IFD0: { Artist: 'Lea Martin', Make: 'Phone', Model: 'X' } }).toBuffer();
  assert.ok((await sharp(photo).metadata()).exif, 'la photo de test contient bien de l’EXIF');
  let up = await upload('b', 'Schéma réseau.JPG', photo);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.is_image, true);
  const imgId = up.data.id;
  up = await upload('b', 'virus.png', Buffer.from('MZ\x90\x00 programme Windows déguisé'));
  assert.equal(up.status, 415, 'faux PNG refusé (signature)');
  up = await upload('b', 'dessin.svg', Buffer.from('<svg onload="alert(1)"/>'));
  assert.equal(up.status, 415, 'SVG refusé (risque XSS)');
  up = await upload('b', 'setup.exe', Buffer.from('MZ'));
  assert.equal(up.status, 415, 'extension hors liste blanche refusée');
  up = await upload('b', 'cours.pdf', Buffer.from('%PDF-1.4\n% test\n'));
  assert.equal(up.status, 200);
  const pdfId = up.data.id;
  up = await upload('b', '../../etc/passwd.txt', Buffer.from('root:x:0:0'));
  assert.equal(up.status, 200);
  assert.equal(up.data.name, 'passwd.txt', 'chemin retiré du nom');
  const txtId = up.data.id;

  // Fichier pas encore publié : visible seulement par son auteur
  let fr = await call('c', 'GET', `/api/files/${imgId}`, null, true);
  assert.equal(fr.status, 404);
  // On ne peut pas publier le fichier de quelqu'un d'autre
  r = await call('c', 'POST', `/api/channels/${sharedForum.id}/topics`, { title: 'vol', content: 'x', attachments: [imgId] });
  assert.equal(r.status, 400);
  // Publication dans le salon BTS
  r = await call('b', 'POST', `/api/channels/${btsGen.id}/messages`, { content: '', attachments: [imgId, pdfId] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.attachments.length, 2);
  fr = await call('b', 'GET', `/api/files/${imgId}`, null, true);
  assert.equal(fr.status, 200);
  assert.equal(fr.headers.get('content-type'), 'image/jpeg');
  assert.equal(fr.headers.get('x-content-type-options'), 'nosniff');
  const served = Buffer.from(await fr.arrayBuffer());
  const meta = await sharp(served).metadata();
  assert.ok(!meta.exif, 'métadonnées EXIF supprimées');
  assert.ok(!served.includes('Lea Martin'), 'nom de l’auteur absent du fichier');
  fr = await call('b', 'GET', `/api/files/${pdfId}`, null, true);
  assert.equal(fr.headers.get('content-type'), 'application/octet-stream', 'les documents sont téléchargés, jamais affichés');
  assert.ok(fr.headers.get('content-disposition').startsWith('attachment;'));
  fr = await call('b', 'GET', `/api/files/${imgId}`, null, true);
  assert.ok(/filename\*=UTF-8''Sch%C3%A9ma%20r%C3%A9seau\.JPG/.test(fr.headers.get('content-disposition')), 'nom UTF-8 (RFC 6266)');
  fr = await call('c', 'GET', `/api/files/${imgId}`, null, true);
  assert.equal(fr.status, 404, 'fichier d’un salon BTS invisible pour un Titre pro');
  fr = await call('a', 'GET', `/api/files/${imgId}`, null, true);
  assert.equal(fr.status, 200);
  // Suppression du message = suppression des fichiers
  await call('b', 'DELETE', `/api/messages/${r.data.id}`);
  fr = await call('b', 'GET', `/api/files/${imgId}`, null, true);
  assert.equal(fr.status, 404);
  // Quota de 5 fichiers par message
  r = await call('b', 'POST', `/api/channels/${btsGen.id}/messages`, { content: 'x', attachments: ['a', 'b', 'c', 'd', 'e', 'f'] });
  assert.equal(r.status, 400);

  // ================= Notifications =================
  const pushed = [];
  app.locals.notifier.setSender(async (sub, payload) => { pushed.push({ sub, payload: JSON.parse(payload) }); });
  r = await call('c', 'GET', '/api/me');
  const tomUser = r.data.user.username;
  const sub = { endpoint: 'https://push.test.local/sub/123', keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } };
  r = await call('c', 'POST', '/api/push/subscribe', { subscription: { ...sub, endpoint: 'https://192.168.1.1/x' } });
  assert.equal(r.status, 400, 'adresse de push non reconnue refusée (SSRF)');
  r = await call('c', 'POST', '/api/push/subscribe', { subscription: sub });
  assert.equal(r.status, 200);
  // Mention dans un salon commun → notification + push (Tom n'a pas d'onglet ouvert)
  const general = (await call('b', 'GET', '/api/channels')).data.find(c => c.name === 'general');
  r = await call('b', 'POST', `/api/channels/${general.id}/messages`, { content: `Salut @${tomUser} tu as fini le TP ?`, attachments: [txtId] });
  assert.equal(r.status, 200);
  r = await call('c', 'GET', '/api/notifications');
  assert.equal(r.data.unread, 1);
  assert.equal(r.data.items[0].type, 'mention');
  assert.equal(r.data.items[0].link, `#/salon/${general.id}`);
  assert.equal(pushed.length, 1);
  assert.ok(pushed[0].payload.title.includes('mentionné'));
  // Mention dans un salon qu'il ne voit pas → rien
  await call('b', 'POST', `/api/channels/${btsGen.id}/messages`, { content: `@${tomUser} secret BTS` });
  r = await call('c', 'GET', '/api/notifications');
  assert.equal(r.data.unread, 1, 'pas de notification pour un salon invisible');
  // Réponse à son sujet
  r = await call('c', 'POST', `/api/channels/${sharedForum.id}/topics`, { title: 'Aide VLAN', content: 'Je bloque sur le trunk' });
  const ttid = r.data.id;
  await call('b', 'POST', `/api/topics/${ttid}/replies`, { content: 'Vérifie le port trunk 802.1Q' });
  r = await call('c', 'GET', '/api/notifications');
  assert.equal(r.data.unread, 2);
  assert.equal(r.data.items[0].type, 'reply');
  // Préférences : couper les réponses
  await call('c', 'POST', '/api/notifications/prefs', { reply: false });
  await call('a', 'POST', `/api/topics/${ttid}/replies`, { content: 'Et la commande port trunk permit vlan' });
  r = await call('c', 'GET', '/api/notifications');
  assert.equal(r.data.unread, 2, 'préférence respectée');
  // Lea a répondu au sujet → elle suit la discussion
  r = await call('b', 'GET', '/api/notifications');
  assert.ok(r.data.items.some(n => n.type === 'reply' && n.link === `#/sujet/${ttid}`), 'les participants sont prévenus');
  r = await call('c', 'POST', '/api/notifications/read', {});
  assert.equal(r.data.unread, 0);
  // Abonnement expiré (410) → supprimé
  app.locals.notifier.setSender(async () => { const e = new Error('Gone'); e.statusCode = 410; throw e; });
  await call('b', 'POST', `/api/channels/${general.id}/messages`, { content: `@${tomUser} encore` });
  await new Promise(res => setTimeout(res, 50));
  r = await call('c', 'POST', '/api/push/test');
  assert.equal(r.status, 400, 'abonnement 410 supprimé');

  // --- Ancien compte sans filière : profil obligatoire ---
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(path.join(process.env.DATA_DIR, 'classe.db'));
  raw.prepare('UPDATE users SET filiere = NULL WHERE id = ?').run(tom.id);
  r = await call('c', 'GET', '/api/channels');
  assert.equal(r.data.gate, 'needs_profile');
  r = await call('c', 'POST', '/api/me/profile', { filiere: 'CAP', fin: String(thisSchoolYearEnd()) });
  assert.equal(r.status, 200);
  r = await call('c', 'GET', '/api/channels');
  assert.equal(r.status, 200);

  // --- Suppression automatique en fin de formation ---
  r = await call('a', 'POST', `/api/admin/users/${tom.id}`, { end_date: '2020-06-30' });
  assert.equal(r.status, 200);
  assert.equal(app.locals.accounts.purgeExpired(), 1);
  r = await call('c', 'GET', '/api/me');
  assert.equal(r.data.user, null, 'compte expiré déconnecté');
  r = await call('c', 'POST', '/api/login', { username: 'tom.r@gmail.com', password: 'motdepasse1' });
  assert.equal(r.status, 401, 'compte expiré supprimé');
  r = await call('a', 'GET', '/api/admin/users');
  assert.ok(!r.data.some(u => u.id === tom.id));
  r = await call('a', 'GET', `/api/topics/${tid}`);
  assert.equal(r.status, 200, 'les sujets restent (auteur anonymisé)');

  // --- Le modérateur peut rendre un compte permanent ---
  r = await call('a', 'POST', `/api/admin/users/${lea.id}`, { end_date: null });
  r = await call('a', 'GET', '/api/admin/users');
  assert.equal(r.data.find(u => u.id === lea.id).expires_at, null);

  // --- Suppression de son propre compte ---
  r = await call('b', 'POST', '/api/me/delete', { confirm: 'non' });
  assert.equal(r.status, 400);
  r = await call('b', 'POST', '/api/me/delete', { confirm: 'SUPPRIMER' });
  assert.equal(r.status, 200);
  r = await call('b', 'POST', '/api/login', { username: 'lea.martin@gmail.com', password: 'nouveaumdp1' });
  assert.equal(r.status, 401);
  r = await call('a', 'POST', '/api/me/delete', { confirm: 'SUPPRIMER' });
  assert.equal(r.status, 400, 'le dernier modérateur ne peut pas se supprimer');

  // --- Liaison Google d'un compte existant (xavi) ---
  let res = await call('a', 'GET', '/auth/google?link=1', null, true);
  const st = new URL(res.headers.get('location')).searchParams.get('state');
  res = await call('a', 'GET', `/auth/google/callback?code=code-xavi&state=${st}`, null, true);
  assert.equal(res.headers.get('location'), '/#/compte?ok=google');
  r = await call('a', 'GET', '/api/me');
  assert.equal(r.data.user.google, true);

  server.close(); google.close();
  console.log('✅ Tous les tests passent');
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
