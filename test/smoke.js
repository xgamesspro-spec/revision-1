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
  'code-prof': { sub: 'g-prof', email: 'prof.dupont@gmail.com', name: 'M. Dupont' },
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


  // ================= Rôle formateur =================
  r = await call('a', 'POST', '/api/admin/invites', { uses: 1, role: 'prof' });
  assert.equal(r.data.role, 'prof');
  r = await call('anon', 'GET', `/api/invite-info?code=${r.data.code}`);
  assert.equal(r.data.role, 'prof');
  const profCode = (await call('a', 'GET', '/api/admin/invites')).data.find(i => i.role === 'prof').code;
  loc = await googleLogin('p', 'code-prof', profCode);
  const tp = loc.split('t=')[1];
  r = await call('p', 'POST', '/api/register/google', { t: tp, password: 'motdepasse1' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.role, 'prof'); assert.equal(r.data.user.needs_profile, false, 'un prof n’a pas de filière obligatoire');
  r = await call('p', 'GET', '/api/channels');
  assert.equal(r.data.length, 0, 'les formateurs ne voient pas les salons des élèves');
  r = await call('p', 'GET', '/api/members');
  assert.equal(r.status, 403);
  r = await call('p', 'POST', '/api/meetings', { name: 'x' });
  assert.equal(r.status, 403, 'réunions réservées aux élèves');

  // ================= Planning =================
  const DAY = 864e5;
  const cal = app.locals.calendar;
  r = await call('b', 'GET', `/api/events?from=${Date.now()}&to=${Date.now() + 300 * DAY}`);
  assert.ok(r.data.events.some(e => e.type === 'examen' && e.title.startsWith('Culture générale')), 'dates du BTS 2027 préremplies');
  r = await call('c', 'GET', `/api/events?from=${Date.now()}&to=${Date.now() + 300 * DAY}`);
  assert.ok(!r.data.events.some(e => e.type === 'examen'), 'examens BTS invisibles pour un Titre pro');
  r = await call('b', 'POST', '/api/events', { title: 'Tout le CFA', type: 'autre', start_at: Date.now() + DAY, visibility: 'cfa' });
  assert.equal(r.status, 400, 'un élève ne publie pas pour tout le CFA');
  r = await call('b', 'POST', '/api/events', { title: 'Dentiste', type: 'perso', start_at: Date.now() + 2 * DAY, visibility: 'perso' });
  const persoId = r.data.id;
  for (const who of ['a', 'p', 'c']) {
    r = await call(who, 'GET', '/api/events');
    assert.ok(!r.data.events.some(e => e.id === persoId), `événement perso invisible pour ${who}`);
  }
  // Absence : visible par les formateurs et modos, pas par les autres élèves
  r = await call('b', 'POST', '/api/events', { title: 'Absente', type: 'absence', detail: 'cfa', all_day: true, start_at: Date.now() + 3 * DAY, visibility: 'cfa' });
  const absId = r.data.id;
  r = await call('p', 'GET', '/api/events');
  const abs = r.data.events.find(e => e.id === absId);
  assert.ok(abs && abs.author === 'Léa' && abs.visibility === 'perso' && abs.detail === 'cfa', 'le prof voit l’absence et son auteur');
  r = await call('c', 'GET', '/api/events');
  assert.ok(!r.data.events.some(e => e.id === absId));
  r = await call('p', 'DELETE', `/api/events/${absId}`);
  assert.equal(r.status, 403, 'un prof ne supprime pas l’absence d’un élève');

  // Rythme d'alternance
  r = await call('b', 'POST', '/api/rythme/filiere', { filiere: 'BTS', days: [4, 5] });
  assert.equal(r.status, 403);
  r = await call('p', 'POST', '/api/rythme/filiere', { filiere: 'BTS', days: [5, 4] });
  r = await call('b', 'GET', '/api/rythme');
  assert.equal(r.data.effective, '4,5');
  r = await call('b', 'POST', '/api/rythme', { days: [3, 4] });
  assert.equal(r.data.effective, '3,4');
  r = await call('b', 'POST', '/api/rythme', { days: null });
  assert.equal(r.data.effective, '4,5', 'retour au rythme de la filière');
  r = await call('b', 'GET', '/api/dashboard');
  assert.ok(['cfa', 'entreprise', 'weekend'].includes(r.data.alternance.aujourdhui));

  // Congés : jours ouvrables (lundi → samedi) et alerte si des jours de CFA sont inclus
  const monday = (() => { let t = Date.now() + 10 * DAY; while (cal.weekday(t) !== 1) t += DAY; return t; })();
  r = await call('b', 'POST', '/api/events', { title: 'Congés', type: 'conge', detail: 'cp', all_day: true, start_at: monday, end_at: monday + 6 * DAY });
  assert.equal(r.status, 200);
  assert.equal(r.data.warnings.length, 1, 'alerte : jeudi et vendredi sont des jours de CFA');
  r = await call('b', 'GET', '/api/events');
  assert.ok(r.data.conges.cp >= 6, `6 jours ouvrables comptés (${r.data.conges.cp})`);
  r = await call('b', 'POST', '/api/events', { title: 'Fermeture', type: 'conge', detail: 'fermeture', all_day: true, start_at: monday });
  assert.equal(r.status, 400, 'seule l’équipe publie une fermeture du CFA');
  r = await call('p', 'POST', '/api/events', { title: 'Vacances de Noël', type: 'conge', detail: 'fermeture', all_day: true, start_at: monday, end_at: monday + 13 * DAY, visibility: 'cfa' });
  assert.equal(r.status, 200);
  r = await call('c', 'GET', '/api/events');
  assert.ok(r.data.events.some(e => e.title === 'Vacances de Noël'), 'fermeture visible par tout le CFA');

  // Répétition hebdomadaire
  const start = Date.now() + DAY;
  r = await call('b', 'POST', '/api/events', { title: 'Cours CFA', type: 'cours', start_at: start, end_at: start + 7 * 3600e3, repeat_days: [4, 5], repeat_until: start + 28 * DAY });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const coursId = r.data.id;
  r = await call('b', 'GET', `/api/events?from=${Date.now()}&to=${Date.now() + 40 * DAY}`);
  const occ = r.data.events.filter(e => e.id === coursId);
  assert.ok(occ.length >= 7 && occ.length <= 9, `≈8 cours sur 4 semaines (${occ.length})`);
  assert.ok(occ.every(e => [4, 5].includes(cal.weekday(e.occ_start))), 'uniquement jeudi et vendredi');

  // Flux iCalendar (RFC 5545)
  r = await call('b', 'GET', '/api/calendar/feed');
  const icsPath = new URL(r.data.url).pathname;
  let icsRes = await fetch(base + icsPath);
  assert.equal(icsRes.status, 200);
  assert.ok(icsRes.headers.get('content-type').startsWith('text/calendar'));
  const ics = await icsRes.text();
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trim().endsWith('END:VCALENDAR'));
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=TH,FR;UNTIL='), 'répétition exportée');
  assert.ok(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75), 'lignes pliées à 75 octets');
  assert.ok(!/[^\r]\n/.test(ics), 'fins de ligne CRLF');
  assert.ok(ics.includes('Dentiste'), 'événements perso dans son propre flux');
  r = await call('b', 'POST', '/api/calendar/feed/reset');
  icsRes = await fetch(base + icsPath);
  assert.equal(icsRes.status, 404, 'ancien lien révoqué');

  // Rappels (24 h avant)
  r = await call('b', 'POST', '/api/events', { title: 'Oral blanc', type: 'examen', start_at: Date.now() + 2 * 3600e3 });
  const before = (await call('b', 'GET', '/api/notifications')).data.items.length;
  cal.sendReminders();
  r = await call('b', 'GET', '/api/notifications');
  assert.equal(r.data.items.length, before + 1);
  assert.equal(r.data.items[0].type, 'rappel');
  assert.ok(r.data.items[0].title.includes('Oral blanc'));
  cal.sendReminders();
  assert.equal((await call('b', 'GET', '/api/notifications')).data.items.length, before + 1, 'pas de rappel en double');

  // Réunion planifiée
  r = await call('b', 'POST', '/api/events', { title: 'Révision E5', type: 'reunion', start_at: Date.now() + 5 * DAY });
  r = await call('b', 'POST', `/api/events/${r.data.id}/meeting`);
  assert.ok(/^[a-f0-9]{12}$/.test(r.data.id));

  // ================= Exercices =================
  r = await call('b', 'POST', '/api/exercises', { title: 'Triche', filiere: 'BTS' });
  assert.equal(r.status, 403, 'un élève ne publie pas d’exercice');
  up = await upload('p', 'TP-VLAN.pdf', Buffer.from('%PDF-1.4\nTP'));
  const dueAt = Date.now() + 3 * DAY;
  r = await call('p', 'POST', '/api/exercises', { title: 'TP VLAN', subject: 'Réseaux', content: 'Configurez **3 VLAN**', filiere: 'BTS', due_at: dueAt, attachments: [up.data.id] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const exId = r.data.id;
  r = await call('b', 'GET', '/api/notifications');
  assert.equal(r.data.items[0].type, 'exercice');
  r = await call('b', 'GET', '/api/exercises');
  assert.equal(r.data.items.length, 1);
  r = await call('c', 'GET', '/api/exercises');
  assert.equal(r.data.items.length, 0, 'exercice BTS invisible pour un Titre pro');
  r = await call('b', 'GET', `/api/events?from=${Date.now()}&to=${Date.now() + 10 * DAY}`);
  assert.ok(r.data.events.some(e => e.title === 'À rendre : TP VLAN' && e.type === 'rendu'), 'date limite ajoutée au planning');
  r = await call('b', 'GET', `/api/exercises/${exId}`);
  fr = await call('b', 'GET', `/api/files/${r.data.exercise.attachments[0].id}`, null, true);
  assert.equal(fr.status, 200, 'l’élève télécharge la consigne');
  fr = await call('c', 'GET', `/api/files/${r.data.exercise.attachments[0].id}`, null, true);
  assert.equal(fr.status, 404);
  r = await call('c', 'POST', `/api/exercises/${exId}/submit`, { content: 'x' });
  assert.equal(r.status, 404);
  up = await upload('b', 'config.txt', Buffer.from('vlan 10 20 30'));
  r = await call('b', 'POST', `/api/exercises/${exId}/submit`, { content: 'Voici ma config', attachments: [up.data.id] });
  assert.equal(r.status, 200);
  r = await call('p', 'GET', '/api/notifications');
  assert.ok(r.data.items[0].title.includes('Rendu reçu'));
  r = await call('p', 'GET', `/api/exercises/${exId}`);
  assert.equal(r.data.submissions.length, 1);
  const subId = r.data.submissions[0].id;
  const subFile = r.data.submissions[0].attachments[0].id;
  assert.ok(!r.data.missing.some(m => m.id === lea.id));
  fr = await call('p', 'GET', `/api/files/${subFile}`, null, true);
  assert.equal(fr.status, 200, 'le prof ouvre le rendu');
  fr = await call('c', 'GET', `/api/files/${subFile}`, null, true);
  assert.equal(fr.status, 404, 'un autre élève ne voit pas le rendu');
  r = await call('b', 'POST', `/api/submissions/${subId}/grade`, { grade: '20/20' });
  assert.equal(r.status, 403, 'un élève ne se note pas');
  r = await call('p', 'POST', `/api/submissions/${subId}/grade`, { grade: '15/20', feedback: 'Bien, pense au VLAN natif' });
  r = await call('b', 'GET', `/api/exercises/${exId}`);
  assert.equal(r.data.mine.grade, '15/20');
  r = await call('b', 'POST', `/api/exercises/${exId}/submit`, { content: 'modif' });
  assert.equal(r.status, 400, 'rendu figé après correction');
  r = await call('p', 'DELETE', `/api/exercises/${exId}`);
  r = await call('b', 'GET', `/api/events?from=${Date.now()}&to=${Date.now() + 10 * DAY}`);
  assert.ok(!r.data.events.some(e => e.title === 'À rendre : TP VLAN'), 'date limite retirée du planning');


  // ================= Discussions vivantes =================
  {
    const gen = (await call('b', 'GET', '/api/channels')).data.find(c => c.name === 'general');
    let m1 = (await call('a', 'POST', `/api/channels/${gen.id}/messages`, { content: 'Qui révise ce soir ?' })).data;
    r = await call('b', 'POST', `/api/channels/${gen.id}/messages`, { content: 'Moi !', reply_to: m1.id });
    assert.equal(r.status, 200);
    assert.equal(r.data.reply.id, m1.id, 'aperçu du message cité');
    const m2 = r.data;
    r = await call('a', 'GET', '/api/notifications');
    assert.ok(r.data.items.some(n => n.type === 'reply' && n.title.includes('répondu à ton message')), 'l’auteur est prévenu de la réponse');
    r = await call('b', 'POST', `/api/channels/${gen.id}/messages`, { content: 'x', reply_to: 999999 });
    assert.equal(r.status, 400);
    r = await call('b', 'POST', '/api/react', { target: 'message', id: m1.id, emoji: '👍' });
    assert.equal(r.data.added, true);
    r = await call('a', 'POST', '/api/react', { target: 'message', id: m1.id, emoji: '👍' });
    assert.equal(r.data.reactions[0].users.length, 2);
    r = await call('a', 'POST', '/api/react', { target: 'message', id: m1.id, emoji: '👍' });
    assert.equal(r.data.added, false, 'second clic = retirer');
    r = await call('b', 'POST', '/api/react', { target: 'message', id: m1.id, emoji: '💩' });
    assert.equal(r.status, 400, 'emoji hors liste refusé');
    const btsGen2 = (await call('b', 'GET', '/api/channels')).data.find(c => c.name === 'bts-general');
    const secret = (await call('b', 'POST', `/api/channels/${btsGen2.id}/messages`, { content: 'secret BTS' })).data;
    r = await call('c', 'POST', '/api/react', { target: 'message', id: secret.id, emoji: '👍' });
    assert.equal(r.status, 404, 'pas de réaction sur un salon d’une autre filière');
    r = await call('a', 'PATCH', `/api/messages/${m2.id}`, { content: 'pirate' });
    assert.equal(r.status, 403, 'on ne modifie pas le message d’un autre');
    r = await call('b', 'PATCH', `/api/messages/${m2.id}`, { content: 'Moi ! (vers 20h)' });
    assert.equal(r.status, 200);
    r = await call('a', 'GET', `/api/channels/${gen.id}/messages`);
    const edited = r.data.find(x => x.id === m2.id);
    assert.ok(edited.edited_at && edited.content.includes('20h'));
    assert.equal(r.data.find(x => x.id === m1.id).reactions[0].users.length, 1);
    r = await call('b', 'POST', `/api/channels/${gen.id}/typing`);
    assert.equal(r.status, 200);
    r = await call('c', 'POST', `/api/channels/${btsGen2.id}/typing`);
    assert.equal(r.status, 404);
  }

  // ================= Progression / XP =================
  {
    const game = app.locals.game;
    r = await call('b', 'GET', '/api/progress');
    const xp0 = r.data.xp;
    assert.equal(r.data.plays, true);
    r = await call('b', 'POST', '/api/quiz-results', { subject: 'reseau', score: 10, total: 10 });
    assert.ok(r.data.xp > 0 && r.data.perfect, 'XP gagnée sur un quiz');
    r = await call('b', 'GET', '/api/progress');
    assert.ok(r.data.xp > xp0);
    assert.ok(r.data.badges.find(b => b.id === 'quiz_parfait').got, 'badge Sans faute');
    assert.equal(r.data.streak.current, 1);
    // Plafond journalier
    for (let i = 0; i < 6; i++) await call('b', 'POST', '/api/quiz-results', { subject: 'reseau', score: 10, total: 10 });
    r = await call('b', 'GET', '/api/progress');
    const { DatabaseSync } = require('node:sqlite');
    const raw2 = new DatabaseSync(path.join(process.env.DATA_DIR, 'classe.db'));
    const quizToday = raw2.prepare("SELECT SUM(amount) AS n FROM xp_log WHERE user_id = ? AND kind = 'quiz' AND day = ?").get(lea.id, game.dayKey()).n;
    assert.equal(quizToday, 150, 'plafond de 150 XP/jour pour les quiz');
    // Série : on simule une activité hier et avant-hier
    raw2.prepare("INSERT INTO xp_log (user_id, amount, reason, kind, day, created_at) VALUES (?, 5, 'test', 'test', ?, ?)").run(lea.id, game.dayKey(Date.now() - 864e5), Date.now() - 864e5);
    raw2.prepare("INSERT INTO xp_log (user_id, amount, reason, kind, day, created_at) VALUES (?, 5, 'test', 'test', ?, ?)").run(lea.id, game.dayKey(Date.now() - 2 * 864e5), Date.now() - 2 * 864e5);
    assert.equal(game.streakOf(lea.id).current, 3, 'série de 3 jours');
    // Formateur : pas de points
    r = await call('p', 'GET', '/api/progress');
    assert.equal(r.data.plays, false);
    r = await call('p', 'GET', '/api/daily');
    assert.equal(r.status, 403);

    // Défi du jour : corrigé côté serveur, une seule tentative
    r = await call('b', 'GET', '/api/daily');
    assert.equal(r.data.started, false);
    assert.equal(r.data.questions, null, 'questions cachées avant de commencer');
    r = await call('b', 'GET', '/api/daily?start=1');
    assert.equal(r.data.questions.length, 5);
    assert.ok(r.data.questions.every(q => q.choix.every(c => !('reponse' in c)) && !('reponse' in q)), 'pas de réponse envoyée au navigateur');
    const keys = r.data.questions.map(q => q.key);
    r = await call('c', 'GET', '/api/daily?start=1');
    assert.deepEqual(r.data.questions.map(q => q.key), keys, 'même défi pour tout le monde');
    // Réponses correctes calculées depuis les fichiers de cours
    const subjFiles = Object.fromEntries(fs.readdirSync(path.join(__dirname, '..', 'content', 'matieres')).map(f => [f.replace('.json', ''), JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'matieres', f), 'utf8'))]));
    const good = keys.map(k => { const [sid, i] = k.split(':'); return subjFiles[sid].quiz[+i].reponse; });
    r = await call('b', 'POST', '/api/daily', { answers: good });
    assert.equal(r.data.score, 5);
    assert.equal(r.data.xp, 70);
    r = await call('b', 'POST', '/api/daily', { answers: good });
    assert.equal(r.status, 400, 'une seule tentative');
    r = await call('c', 'POST', '/api/daily', { answers: [9, 9, 9, 9, 9] });
    assert.equal(r.data.score, 0);
    r = await call('b', 'GET', '/api/daily');
    assert.equal(r.data.done, true);
    assert.ok(r.data.board.some(x => x.me && x.score === 5));
    assert.ok(!r.data.board.some(x => x.name === 'Tom R'), 'classement limité à la filière');
    r = await call('b', 'GET', '/api/progress');
    assert.ok(r.data.badges.find(b => b.id === 'defi_parfait').got);

    // Duel
    const tomId = (await call('c', 'GET', '/api/me')).data.user.id;
    r = await call('b', 'POST', '/api/duels', { opponent_id: tomId, subject: 'reseau' });
    assert.equal(r.status, 200);
    const duelId = r.data.id;
    r = await call('c', 'GET', '/api/notifications');
    assert.ok(r.data.items.some(n => n.type === 'duel'));
    let g1 = (await call('b', 'GET', `/api/duels/${duelId}/play`)).data;
    assert.equal(g1.questions.length, 5);
    const dgood = g1.questions.map(q => subjFiles[q.key.split(':')[0]].quiz[+q.key.split(':')[1]].reponse);
    r = await call('b', 'POST', `/api/duels/${duelId}/answers`, { answers: dgood });
    assert.equal(r.data.score, 5);
    assert.equal(r.data.duel.status, 'pending');
    r = await call('b', 'POST', `/api/duels/${duelId}/answers`, { answers: dgood });
    assert.equal(r.status, 400, 'on ne rejoue pas un duel');
    await call('c', 'GET', `/api/duels/${duelId}/play`);
    r = await call('c', 'POST', `/api/duels/${duelId}/answers`, { answers: [0, 0, 0, 0, 0] });
    assert.equal(r.data.duel.status, 'done');
    r = await call('b', 'GET', '/api/duels');
    assert.equal(r.data[0].won, true, 'Léa gagne');
    r = await call('b', 'GET', '/api/progress');
    assert.ok(r.data.badges.find(b => b.id === 'duelliste').got);
    r = await call('b', 'POST', '/api/duels', { opponent_id: (await call('p', 'GET', '/api/me')).data.user.id });
    assert.equal(r.status, 400, 'pas de duel contre un formateur');

    // Classement
    r = await call('b', 'GET', '/api/leaderboard?period=week');
    assert.equal(r.data.filiere, 'BTS');
    assert.ok(r.data.list[0].me);
    await call('b', 'POST', '/api/progress/prefs', { hide_rank: true });
    r = await call('a', 'GET', '/api/leaderboard?period=all&filiere=BTS');
    assert.ok(!r.data.list.some(x => x.name === 'Léa'), 'élève masqué du classement');
    await call('b', 'POST', '/api/progress/prefs', { hide_rank: false });
  }

  // ================= Boîtes à idées =================
  {
    r = await call('b', 'POST', '/api/ideas', { title: 'Mode sombre pour le planning', content: 'Ce serait cool', category: 'Apparence', anonymous: true });
    assert.equal(r.status, 200);
    const ideaId = r.data.id;
    r = await call('p', 'POST', '/api/ideas', { title: 'Exporter les notes en CSV', category: 'Exercices' });
    const profIdea = r.data.id;
    r = await call('c', 'GET', '/api/ideas');
    assert.equal(r.data.box, 'eleves');
    const it = r.data.items.find(i => i.id === ideaId);
    assert.equal(it.author, 'Anonyme', 'anonyme pour les autres élèves');
    assert.ok(!r.data.items.some(i => i.id === profIdea), 'boîte des profs invisible pour un élève');
    r = await call('p', 'GET', '/api/ideas?box=eleves');
    assert.equal(r.data.box, 'profs', 'un prof ne lit que la boîte des profs');
    assert.ok(!r.data.items.some(i => i.id === ideaId));
    r = await call('c', 'POST', `/api/ideas/${profIdea}/vote`);
    assert.equal(r.status, 404, 'vote impossible dans l’autre boîte');
    r = await call('c', 'POST', `/api/ideas/${ideaId}/vote`);
    assert.equal(r.data.votes, 2);
    r = await call('a', 'GET', '/api/ideas?box=eleves');
    assert.equal(r.data.items.find(i => i.id === ideaId).author, 'Léa', 'le modo voit l’auteur');
    r = await call('a', 'GET', '/api/ideas?box=profs');
    assert.ok(r.data.items.some(i => i.id === profIdea), 'le modo voit les deux boîtes');
    r = await call('c', 'PATCH', `/api/ideas/${ideaId}`, { status: 'faite' });
    assert.equal(r.status, 403, 'un élève ne change pas le statut');
    r = await call('a', 'PATCH', `/api/ideas/${ideaId}`, { status: 'prevue', admin_reply: 'Bonne idée, prévu pour décembre' });
    assert.equal(r.data.status, 'prevue');
    r = await call('b', 'GET', '/api/notifications');
    assert.ok(r.data.items.some(n => n.type === 'idee' && n.title.includes('Prévue')));
    r = await call('b', 'DELETE', `/api/ideas/${ideaId}`);
    assert.equal(r.status, 403, 'plus supprimable par l’auteur une fois traitée');
  }

  // ================= Guide =================
  r = await call('p', 'GET', '/api/guide');
  assert.ok(r.data.roles.eleve.sections.length >= 5 && r.data.roles.prof && r.data.roles.admin);

  // ================= Formations du CFA =================
  r = await call('anon', 'GET', '/api/formations');
  assert.equal(r.data.items.length, 41, 'les 41 formations du CFA');
  assert.equal(new Set(r.data.items.map(f => f.filiere)).size, 4);
  r = await call('b', 'POST', '/api/me/profile', { filiere: 'BTS', fin: String(thisSchoolYearEnd() + 1), formation: 'cap-ol' });
  assert.equal(r.status, 400, 'formation hors filière refusée');
  r = await call('b', 'POST', '/api/me/profile', { filiere: 'BTS', fin: String(thisSchoolYearEnd() + 1), formation: 'bts-sio', intitule: 'option SISR' });
  assert.equal(r.data.user.formation, 'bts-sio'); assert.ok(r.data.user.formation_nom.includes('SIO'));
  r = await call('b', 'GET', '/api/formations/bts-sio');
  assert.equal(r.data.rncp, 'RNCP40792'); assert.ok(r.data.liens.rncp.includes('40792')); assert.ok(r.data.examen.dates.length >= 5);
  assert.ok(r.data.ou_trouver.length >= 6);
  r = await call('c', 'GET', '/api/formations/tp-gp');
  assert.equal(r.data.examen.dates.length, 0, 'titre pro : pas de date nationale');
  r = await call('b', 'GET', '/api/subjects');
  const subj = id => r.data.find(x => x.id === id);
  assert.equal(subj('reseau').pour_toi, true); assert.equal(subj('reseau').pertinence, 3);
  assert.equal(subj('pse').pour_toi, false); assert.equal(subj('apprenti').pour_toi, true);
  assert.equal(subj('cyber').epreuve.coef, 4, 'matière liée à une épreuve de la formation, avec son coef');
  assert.ok(subj('cejm').sources > 0);
  r = await call('b', 'GET', '/api/formations/bts-ndrc');
  assert.equal(r.data.epreuves.find(e => e.code === 'E4').coef, 5);
  r = await call('b', 'GET', '/api/subjects/vente');
  assert.ok(r.data.sources.length && r.data.quiz.every(q => q.explication), 'quiz expliqués + sources');
  r = await call('b', 'GET', '/api/news');
  assert.ok(r.data.alaune.some(x => x.pour_toi && x.categorie === 'Cybersécurité'));
  assert.ok(r.data.alaune.some(x => !x.pour_toi && x.categorie === 'Transport & logistique'), 'actus transport hors formation');
  r = await call('b', 'GET', '/api/subjects');
  r = await call('c', 'GET', '/api/subjects');
  assert.equal(r.data.find(x => x.id === 'titrepro').pour_toi, true);
  assert.equal(r.data.find(x => x.id === 'reseau').pour_toi, false);
  r = await call('b', 'GET', '/api/dashboard');
  assert.ok(r.data.examen && r.data.examen.filiere === 'BTS');
  r = await call('b', 'GET', `/api/events?from=${Date.now()}&to=${Date.now() + 300 * DAY}`);
  assert.equal(r.data.events.filter(e => e.title.startsWith('Culture générale')).length, 1, 'dates BTS importées une seule fois');

  // ================= Cahier de textes =================
  const demain = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
  r = await call('b', 'POST', '/api/cahier', { titre: 'x' });
  assert.equal(r.status, 403, 'un élève ne remplit pas le cahier de textes');
  r = await call('p', 'POST', '/api/cahier', { titre: 'VLAN et trunk', matiere: 'Réseaux', contenu: 'Cours sur 802.1Q', travail: 'Exercice 3', pour_le: demain, formation: 'bts-sio' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cid = r.data.id;
  r = await call('b', 'GET', '/api/cahier');
  assert.ok(r.data.travail.some(e => e.id === cid && !e.fait));
  r = await call('c', 'GET', '/api/cahier');
  assert.ok(!r.data.travail.some(e => e.id === cid), 'invisible pour une autre formation');
  r = await call('b', 'GET', '/api/dashboard');
  assert.equal(r.data.travail.length, 1);
  await call('b', 'POST', `/api/cahier/${cid}/fait`, { done: true });
  r = await call('b', 'GET', '/api/dashboard');
  assert.equal(r.data.travail.length, 0, 'travail coché = plus à faire');
  r = await call('p', 'GET', '/api/cahier');
  assert.equal(r.data.travail.find(e => e.id === cid).nb_fait, 1);
  r = await call('b', 'GET', '/api/notifications');
  assert.ok(r.data.items.some(n => n.type === 'scolarite' && n.link === '#/cahier'));

  // ================= Notes et moyennes =================
  r = await call('p', 'POST', '/api/evaluations', { titre: 'Contrôle subnetting', matiere: 'Réseaux', bareme: 40, coef: 2, filiere: 'BTS' });
  const evid = r.data.id;
  r = await call('p', 'PUT', `/api/evaluations/${evid}/notes`, { notes: [{ user_id: tom.id, valeur: 10 }] });
  assert.equal(r.status, 400, 'élève hors de la classe');
  r = await call('p', 'PUT', `/api/evaluations/${evid}/notes`, { notes: [{ user_id: lea.id, valeur: '45' }] });
  assert.equal(r.status, 400, 'note au-dessus du barème');
  r = await call('p', 'PUT', `/api/evaluations/${evid}/notes`, { notes: [{ user_id: lea.id, valeur: '30,5', appreciation: 'Bien' }] });
  assert.equal(r.status, 200);
  r = await call('b', 'GET', '/api/evaluations');
  assert.equal(r.data.items.length, 0, 'brouillon invisible pour les élèves');
  r = await call('p', 'PUT', `/api/evaluations/${evid}/notes`, { notes: [], publier: true });
  assert.equal(r.data.publiee, true);
  r = await call('b', 'GET', '/api/evaluations');
  assert.equal(r.data.items[0].ma_note.valeur, 30.5); assert.equal(r.data.items[0].stats.moyenne, undefined, 'pas de stats sous 3 notes');
  r = await call('b', 'GET', '/api/releve');
  assert.equal(r.data.generale, 15.25); assert.equal(r.data.matieres[0].moyenne, 15.25);
  r = await call('c', 'GET', `/api/releve?user_id=${lea.id}`);
  assert.equal(r.data.eleve.id, tom.id, 'un élève ne voit que son relevé');
  r = await call('p', 'GET', `/api/releve?user_id=${lea.id}`);
  assert.equal(r.data.generale, 15.25);

  // ================= Vie scolaire =================
  r = await call('c', 'GET', '/api/appels');
  assert.equal(r.status, 403);
  r = await call('p', 'POST', '/api/appels', { filiere: 'BTS', creneau: 'matin', matiere: 'Réseaux' });
  const apid = r.data.id;
  r = await call('p', 'POST', '/api/appels', { filiere: 'BTS', creneau: 'matin' });
  assert.equal(r.data.existant, true);
  r = await call('p', 'PUT', `/api/appels/${apid}`, { eleves: [{ id: lea.id, statut: 'absent' }, { id: tom.id, statut: 'absent' }] });
  r = await call('c', 'GET', '/api/viescolaire');
  assert.equal(r.data.resume.absences, 0, 'Tom n’est pas dans cette classe');
  r = await call('b', 'GET', '/api/viescolaire');
  assert.equal(r.data.resume.absences, 1); assert.equal(r.data.resume.a_justifier, 1);
  r = await call('b', 'POST', '/api/justifs', { appels: [apid], motif: 'transport', commentaire: 'Bus en panne' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const jid = r.data.id;
  r = await call('b', 'POST', '/api/justifs', { appels: [apid], motif: 'autre' });
  assert.equal(r.status, 400, 'déjà justifiée');
  r = await call('p', 'GET', '/api/appels');
  assert.equal(r.data.justifs.length, 1); assert.equal(r.data.appels[0].absents, 1);
  r = await call('b', 'POST', `/api/justifs/${jid}`, { statut: 'acceptee' });
  assert.equal(r.status, 403);
  await call('p', 'POST', `/api/justifs/${jid}`, { statut: 'acceptee', reponse: 'OK' });
  r = await call('b', 'GET', '/api/viescolaire');
  assert.equal(r.data.evenements[0].justifiee, true); assert.equal(r.data.resume.a_justifier, 0);

  // ================= Messagerie formateurs ↔ élèves =================
  r = await call('b', 'GET', '/api/contacts');
  assert.ok(r.data.length && r.data.every(c => c.role !== 'eleve'), 'un élève ne contacte que l’équipe');
  r = await call('b', 'POST', '/api/convs', { sujet: 'x', message: 'y', to: [tom.id] });
  assert.equal(r.status, 403, 'pas de messagerie privée entre élèves');
  const profId = (await call('p', 'GET', '/api/me')).data.user.id;
  r = await call('b', 'POST', '/api/convs', { sujet: 'Question VLAN', message: 'Bonjour, je bloque sur l’exercice 3', to: [profId] });
  const conv1 = r.data.id;
  r = await call('p', 'GET', '/api/convs');
  assert.equal(r.data.find(c => c.id === conv1).unread, 1);
  await call('p', 'POST', `/api/convs/${conv1}/messages`, { content: 'Regarde le trunk 802.1Q' });
  r = await call('a', 'GET', `/api/convs/${conv1}`);
  assert.equal(r.status, 404, 'même un modérateur ne lit pas une discussion dont il ne fait pas partie');
  // Message à un groupe : les élèves ne lisent pas les réponses des autres
  r = await call('p', 'POST', '/api/convs', { sujet: 'Sortie', message: 'Qui vient ?', to: [lea.id, tom.id] });
  const conv2 = r.data.id;
  await call('b', 'POST', `/api/convs/${conv2}/messages`, { content: 'Moi !' });
  r = await call('c', 'GET', `/api/convs/${conv2}`);
  assert.equal(r.data.messages.length, 1); assert.equal(r.data.autres_eleves, 1);
  r = await call('p', 'GET', `/api/convs/${conv2}`);
  assert.equal(r.data.messages.length, 2);
  r = await call('p', 'POST', '/api/convs', { sujet: 'Info', message: 'Pas de cours lundi', classe: { filiere: 'BTS' }, reponses: false });
  r = await call('b', 'POST', `/api/convs/${r.data.id}/messages`, { content: 'ok' });
  assert.equal(r.status, 403, 'réponses fermées');

  // ================= Livret d'apprentissage & tuteur =================
  r = await call('b', 'POST', '/api/livret/periodes', { titre: 'Novembre', activites: 'Installation de postes', debut: '2026-11-02', fin: '2026-11-20' });
  const perId = r.data.id;
  r = await call('b', 'POST', '/api/livret/tuteurs', { nom: 'Mme Tuteur', entreprise: 'Entreprise fictive' });
  const tok = r.data.token;
  assert.ok(tok.length >= 30);
  r = await call('anon', 'POST', '/api/tuteur/livret', { token: 'faux-jeton-faux-jeton-faux' });
  assert.equal(r.status, 404);
  r = await call('anon', 'POST', '/api/tuteur/livret', { token: tok });
  assert.equal(r.status, 200); assert.equal(r.data.apprenti.display_name, 'Léa'); assert.equal(r.data.periodes.length, 1);
  assert.equal(r.data.absences.absences, 1); assert.equal(r.data.releve, undefined, 'notes cachées au tuteur par défaut');
  assert.ok(!('channels' in r.data) && !('tuteurs' in r.data));
  r = await call('anon', 'POST', `/api/tuteur/periodes/${perId}`, { token: tok, appreciation: 'Très bon début', evals: { ponctualite: 'A', autonomie: 'EC', pirate: 'X' }, signer: true });
  assert.equal(r.data.signee, true);
  r = await call('b', 'PATCH', `/api/livret/periodes/${perId}`, { activites: 'modifié' });
  assert.equal(r.status, 400, 'période signée non modifiable');
  r = await call('b', 'GET', '/api/livret');
  assert.deepEqual(r.data.periodes[0].tuteur_evals, { ponctualite: 'A', autonomie: 'EC' });
  r = await call('p', 'PATCH', `/api/livret/periodes/${perId}`, { formateur_remarque: 'Continue' });
  assert.equal(r.status, 200);
  r = await call('p', 'POST', '/api/livret/visites', { user_id: lea.id, type: 'visite', compte_rendu: 'RAS' });
  assert.equal(r.status, 200);
  r = await call('c', 'GET', `/api/livret?user_id=${lea.id}`);
  assert.equal(r.data.apprenti.id, tom.id, 'un élève ne lit que son livret');
  r = await call('b', 'GET', '/api/livret');
  await call('b', 'DELETE', `/api/livret/tuteurs/${r.data.tuteurs[0].id}`);
  r = await call('anon', 'POST', '/api/tuteur/livret', { token: tok });
  assert.equal(r.status, 404, 'lien désactivé');

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
