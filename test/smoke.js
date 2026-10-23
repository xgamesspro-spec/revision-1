// Test de bout en bout rapide : lance le serveur sur une base temporaire et teste les routes principales.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'classe-test-'));
const app = require('../server');

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  async function call(who, method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(jar[who] ? { Cookie: jar[who] } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const c = res.headers.get('set-cookie');
    if (c) jar[who] = c.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  }

  let r = await call('a', 'GET', '/api/setup');
  assert.equal(r.data.firstUser, true);

  r = await call('a', 'POST', '/api/register', { username: 'xavi', display_name: 'Xavi', password: 'motdepasse1' });
  assert.equal(r.status, 200); assert.equal(r.data.user.role, 'admin');

  r = await call('b', 'POST', '/api/register', { username: 'intrus', password: 'motdepasse1', invite: 'FAUX' });
  assert.equal(r.status, 403, 'inscription sans code valide refusée');

  r = await call('a', 'POST', '/api/admin/invites', { uses: 2 });
  const code = r.data.code;
  r = await call('b', 'POST', '/api/register', { username: 'eleve1', display_name: 'Élève 1', password: 'motdepasse1', invite: code });
  assert.equal(r.status, 200); assert.equal(r.data.user.role, 'eleve');

  r = await call('b', 'GET', '/api/admin/users');
  assert.equal(r.status, 403, 'un élève ne peut pas modérer');

  r = await call('anon', 'GET', '/api/channels');
  assert.equal(r.status, 401, 'pas d’accès sans compte');

  r = await call('b', 'GET', '/api/channels');
  const chat = r.data.find(c => c.kind === 'chat');
  const forum = r.data.find(c => c.kind === 'forum');
  r = await call('b', 'POST', `/api/channels/${chat.id}/messages`, { content: 'Salut <script>alert(1)</script>' });
  assert.equal(r.status, 200);
  r = await call('a', 'GET', `/api/channels/${chat.id}/messages`);
  assert.equal(r.data.length, 1);

  r = await call('b', 'POST', `/api/channels/${forum.id}/topics`, { title: 'Broadcast /27 ?', content: 'Je bloque' });
  const tid = r.data.id;
  r = await call('a', 'POST', `/api/topics/${tid}/replies`, { content: 'Nombre magique 32' });
  r = await call('b', 'PATCH', `/api/topics/${tid}`, { solved: true });
  r = await call('b', 'GET', `/api/topics/${tid}`);
  assert.equal(r.data.solved, 1); assert.equal(r.data.replies.length, 1);

  r = await call('b', 'GET', '/api/subjects');
  assert.ok(r.data.length >= 8, 'matières chargées');
  r = await call('b', 'GET', '/api/subjects/reseau');
  assert.ok(r.data.quiz.length > 5);
  r = await call('b', 'POST', '/api/cards/review', { key: 'reseau:0', ok: true });
  assert.equal(r.data.box, 1);
  r = await call('b', 'POST', '/api/quiz-results', { subject: 'reseau', score: 9, total: 12 });
  assert.equal(r.status, 200);
  r = await call('b', 'POST', '/api/fiches', { subject: 'maths', title: 'Ma fiche', content: '**test**' });
  assert.equal(r.status, 200);
  r = await call('b', 'GET', '/api/dashboard');
  assert.ok(r.data.cartes_total > 50);
  r = await call('b', 'GET', '/api/infos');
  assert.ok(r.data.cfa.nom);

  // Vérification des quiz : chaque réponse pointe vers un choix existant
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'content', 'matieres'))) {
    const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'matieres', f), 'utf8'));
    for (const q of s.quiz) assert.ok(q.choix[q.reponse] !== undefined, `${f} : ${q.q}`);
  }

  // Réunions
  r = await call('b', 'POST', '/api/meetings', { name: 'Révision VLAN' });
  assert.equal(r.status, 200);
  const mid = r.data.id;
  r = await call('b', 'GET', '/api/meetings');
  assert.equal(r.data[0].name, 'Révision VLAN');
  r = await call('b', 'POST', `/api/meetings/${mid}/join`, { connId: 'faux' });
  assert.equal(r.status, 400, 'connexion temps réel obligatoire pour rejoindre');
  r = await call('anon', 'GET', '/api/meetings');
  assert.equal(r.status, 401);
  r = await call('a', 'DELETE', `/api/meetings/${mid}`);
  assert.equal(r.status, 200, "l'admin peut terminer une réunion");

  r = await call('a', 'POST', '/api/admin/users/2', { banned: true });
  r = await call('b', 'GET', '/api/me');
  assert.equal(r.data.user, null, 'compte suspendu déconnecté');

  server.close();
  console.log('✅ Tous les tests passent');
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
