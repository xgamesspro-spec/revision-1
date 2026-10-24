// Plateforme de classe : révisions + salons + forum réservés aux élèves + actus
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { getNews } = require('./news');
const setupMeetings = require('./meetings');
const setupAccounts = require('./accounts');
const setupUploads = require('./uploads');
const setupNotify = require('./notify');
const setupCalendar = require('./calendar');
const setupExercises = require('./exercises');
const setupSocial = require('./social');
const setupGame = require('./game');
const setupIdeas = require('./ideas');
const setupFormations = require('./formations');
const cible = require('./cible');
const setupCahier = require('./cahier');
const setupNotes = require('./notes');
const setupVieScolaire = require('./viescolaire');
const setupMessagerie = require('./messagerie');
const setupLivret = require('./livret');

const PORT = process.env.PORT || 3000;
const CLASS_CODE = process.env.CLASS_CODE || ''; // code d'inscription permanent (optionnel)
const SESSION_DAYS = 30;
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === '1');
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob: mediastream:",
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)',
  });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Contenus de révision ----------
const CONTENT_DIR = path.join(__dirname, 'content');
function loadSubjects() {
  const dir = path.join(CONTENT_DIR, 'matieres');
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    s.id = path.basename(f, '.json');
    s.fiches = s.fiches || []; s.quiz = s.quiz || []; s.cartes = s.cartes || [];
    return s;
  }).sort((a, b) => (a.ordre || 99) - (b.ordre || 99));
}
let SUBJECTS = loadSubjects();
const readJson = f => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8'));

// ---------- Utilitaires ----------
const now = () => Date.now();
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(token, userId, now() + SESSION_DAYS * 864e5);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${COOKIE_SECURE ? '; Secure' : ''}`);
}
function clearSession(req, res) {
  if (req.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
}
const publicUser = u => u && ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role, filiere: u.filiere, formation: u.formation });
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// Auth middleware
app.use('/api', (req, res, next) => {
  const sid = parseCookies(req).sid;
  if (sid) {
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?`).get(sid, now());
    if (row && !row.banned && !row.deleted) { req.user = row; req.sid = sid; }
  }
  next();
});
const auth = (req, res, next) => req.user ? next() : bad(res, 'Connexion requise', 401);
// Salons, forum, réunions et liste des élèves : espace entre élèves, fermé aux formateurs
const authEleves = (req, res, next) => auth(req, res, () => (req.user.role === 'prof' ? bad(res, 'Espace réservé aux élèves', 403) : next()));
const admin = (req, res, next) => req.user?.role === 'admin' ? next() : bad(res, 'Réservé aux modérateurs', 403);

// Anti-bruteforce très simple
const attempts = new Map();
function tooMany(ip) {
  const a = attempts.get(ip) || { n: 0, t: now() };
  if (now() - a.t > 15 * 60e3) { a.n = 0; a.t = now(); }
  a.n++; attempts.set(ip, a);
  return a.n > 20;
}

const accounts = setupAccounts(app, {
  db, auth, admin, text, bad, tooMany, hashPassword, checkPassword, setSession, clearSession, parseCookies, now,
  CLASS_CODE, COOKIE_SECURE,
});
app.use('/api', accounts.gate);
app.locals.accounts = accounts;
const formations = setupFormations(app, { auth, admin, bad });

// ---------- Temps réel (Server-Sent Events) ----------
// Chaque onglet ouvert = une connexion avec un identifiant (connId), utilisé aussi pour les réunions.
const conns = new Map(); // connId -> { res, user }
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of conns.values()) c.res.write(payload);
}
function sendTo(connId, event, data) {
  const c = conns.get(connId);
  if (c) c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function onlineIds() { return [...new Set([...conns.values()].map(c => c.user.id))]; }
const meetings = setupMeetings(app, { auth: authEleves, conns, broadcast, sendTo, text, bad });
app.get('/api/stream', auth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const connId = crypto.randomBytes(12).toString('hex');
  conns.set(connId, { res, user: publicUser(req.user) });
  res.write(`retry: 3000\n\nevent: hello\ndata: ${JSON.stringify({ connId })}\n\n`);
  broadcast('presence', onlineIds());
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    conns.delete(connId);
    meetings.onDisconnect(connId);
    broadcast('presence', onlineIds());
  });
});

// ---------- Comptes (voir accounts.js) ----------
app.get('/api/members', authEleves, (req, res) => {
  const online = new Set(onlineIds());
  const rows = db.prepare('SELECT id, username, display_name, role, filiere FROM users WHERE banned = 0 AND deleted = 0 ORDER BY display_name').all();
  res.json(rows.map(u => ({ ...u, filiere_nom: accounts.filiereNom(u.filiere), online: online.has(u.id) })));
});

// ---------- Salons (accès par filière) ----------
// Un salon sans filière est visible par tous ; sinon seulement par les élèves de la filière (et les modérateurs).
if (!db.prepare('PRAGMA table_info(channels)').all().some(c => c.name === 'filiere')) {
  db.exec('ALTER TABLE channels ADD COLUMN filiere TEXT');
  const slugs = { CAP: 'cap', BACPRO: 'bac-pro', BTS: 'bts', TP: 'titre-pro' };
  const ins = db.prepare('INSERT INTO channels (name, kind, description, position, filiere) VALUES (?, ?, ?, ?, ?)');
  accounts.FILIERES.forEach((f, i) => {
    ins.run(`${slugs[f.id] || f.id.toLowerCase()}-general`, 'chat', `Entre élèves de ${f.nom}`, i, f.id);
    ins.run(`${slugs[f.id] || f.id.toLowerCase()}-questions`, 'forum', `Questions et ressources pour les ${f.nom}`, 20 + i, f.id);
  });
}
function canSee(user, ch) {
  return !!ch && !!user && user.role !== 'prof' && (user.role === 'admin' || !ch.filiere || ch.filiere === user.filiere);
}
function canSeeChannelId(user, id) {
  return canSee(user, db.prepare('SELECT * FROM channels WHERE id = ?').get(id));
}
function channelFor(user, id, kind) {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(+id);
  return canSee(user, ch) && (!kind || ch.kind === kind) ? ch : null;
}
// Diffusion temps réel limitée aux personnes qui voient le salon
function broadcastChannel(ch, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of conns.values()) if (canSee(c.user, ch)) c.res.write(payload);
}
let calendar, exercises, cahier, viescolaire; // créés plus bas
function canAccessAttachment(user, a) {
  if (['message', 'topic', 'reply'].includes(a.target)) return canSeeChannelId(user, a.channel_id);
  if (a.target === 'event') {
    const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(a.target_id);
    return !!ev && calendar.visibleTo(user, ev);
  }
  if (a.target === 'cahier') return cahier.canAccessAttachment(user, a);
  if (a.target === 'justif') return viescolaire.canAccessAttachment(user, a);
  return exercises.canAccessAttachment(user, a);
}
const uploads = setupUploads(app, { db, auth, bad, now, canAccess: canAccessAttachment });
const notifier = setupNotify(app, { db, auth, bad, now, conns, text });
// Envoi en direct aux personnes concernées (filtre = qui a le droit de voir)
function liveTo(pred, event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of conns.values()) { try { if (pred(c.user)) c.res.write(payload); } catch { /* ignoré */ } }
}
const game = setupGame(app, { db, auth, bad, now, conns, getSubjects: () => SUBJECTS, notifier, accounts });
calendar = setupCalendar(app, { db, auth, bad, now, text, notifier, meetings, accounts, uploads,
  onChange: ev => liveTo(u => calendar.visibleTo(u, ev), 'events', { id: ev.id }) });
exercises = setupExercises(app, { db, auth, bad, now, text, uploads, notifier, accounts,
  onChange: ex => liveTo(u => exercises.visible(u, ex), 'exercises', { id: ex.id }),
  onSubmit: uid => game.award(uid, 'exercice') });
const social = setupSocial(app, { db, auth, bad, now, text, channelFor, broadcastChannel, conns, notifier });
const ideas = setupIdeas(app, { db, auth, admin, bad, now, text, conns, notifier });
// Outils « vie de classe » façon Pronote / Ypareo (formateurs ↔ élèves, jamais dans les salons)
const ci = cible({ db, accounts, formations });
cahier = setupCahier(app, { db, auth, bad, now, text, uploads, notifier, cible: ci,
  onChange: e => liveTo(u => cahier.visible(u, e), 'cahier', { id: e.id }) });
const notes = setupNotes(app, { db, auth, bad, now, text, notifier, cible: ci });
viescolaire = setupVieScolaire(app, { db, auth, bad, now, text, uploads, notifier, cible: ci });
const messagerie = setupMessagerie(app, { db, auth, bad, now, text, notifier, cible: ci, liveTo });
const livret = setupLivret(app, { db, auth, bad, now, text, notifier, cible: ci, viescolaire, notes, formations, accounts });
app.locals.calendar = calendar;
app.locals.game = game;
app.get('/api/guide', auth, (req, res) => res.json(readJson('guide.json')));
// Suppression d'un compte (fin de formation, demande RGPD) : on efface aussi ses rendus et son planning perso
accounts.onDelete(uid => {
  exercises.forgetUser(uid);
  game.forgetUser(uid);
  social.forgetUser(uid);
  ideas.forgetUser(uid);
  for (const m of [cahier, notes, viescolaire, messagerie, livret]) m.forgetUser(uid);
  const evs = db.prepare("SELECT id FROM events WHERE created_by = ? AND visibility = 'perso'").all(uid).map(e => e.id);
  uploads.removeFor('event', evs);
  db.prepare("DELETE FROM events WHERE created_by = ? AND visibility = 'perso'").run(uid);
  db.prepare('UPDATE users SET rythme = NULL, cal_token = NULL, notif_prefs = NULL WHERE id = ?').run(uid);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM push_subs WHERE user_id = ?').run(uid);
});
app.locals.notifier = notifier;
const snippet = s => String(s).replace(/\s+/g, ' ').slice(0, 140);

// Notifie les personnes mentionnées (@identifiant) qui ont accès au salon
function notifyMentions(author, content, ch, link, where) {
  const done = new Set();
  for (const u of notifier.findMentions(content)) {
    if (u.id === author.id || !canSee(u, ch)) continue;
    notifier.notify(u.id, { type: 'mention', title: `${author.display_name} t'a mentionné ${where}`, body: snippet(content), link });
    done.add(u.id);
  }
  return done;
}

app.get('/api/channels', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM channels ORDER BY position, id').all()
    .filter(c => canSee(req.user, c))
    .map(c => ({ ...c, filiere_nom: accounts.filiereNom(c.filiere) })));
});
const validFiliere = f => (f && accounts.FILIERES.some(x => x.id === f) ? f : null);
app.post('/api/channels', auth, admin, (req, res) => {
  const name = text(req.body.name, 32).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9àâçéèêëîïôûùüÿñæœ_-]/g, '');
  const kind = req.body.kind === 'forum' ? 'forum' : 'chat';
  if (!name) return bad(res, 'Nom invalide');
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM channels').get().p;
  const r = db.prepare('INSERT INTO channels (name, kind, description, position, filiere) VALUES (?, ?, ?, ?, ?)')
    .run(name, kind, text(req.body.description, 200), pos, validFiliere(req.body.filiere));
  broadcast('channels', {});
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/channels/:id', auth, admin, (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(+req.params.id);
  if (!ch) return bad(res, 'Salon introuvable', 404);
  if ('filiere' in req.body) db.prepare('UPDATE channels SET filiere = ? WHERE id = ?').run(validFiliere(req.body.filiere), ch.id);
  if (req.body.description !== undefined) db.prepare('UPDATE channels SET description = ? WHERE id = ?').run(text(req.body.description, 200), ch.id);
  broadcast('channels', {});
  res.json({ ok: true });
});
app.delete('/api/channels/:id', auth, admin, (req, res) => {
  const id = +req.params.id;
  uploads.removeChannel(id);
  db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  broadcast('channels', {});
  res.json({ ok: true });
});

const MSG_SELECT = `SELECT m.id, m.channel_id, m.content, m.created_at, m.user_id, m.reply_to, m.edited_at, u.display_name, u.username, u.role
  FROM messages m JOIN users u ON u.id = m.user_id`;
const withAtt = (rows, target) => {
  const map = uploads.forTargets(target, rows.map(r => r.id));
  rows.forEach(r => { r.attachments = map[r.id] || []; });
  return rows;
};
app.get('/api/channels/:id/messages', auth, (req, res) => {
  const ch = channelFor(req.user, req.params.id, 'chat');
  if (!ch) return bad(res, 'Salon introuvable', 404);
  const before = +req.query.before || 9e15;
  const rows = db.prepare(`${MSG_SELECT} WHERE m.channel_id = ? AND m.deleted = 0 AND m.id < ? ORDER BY m.id DESC LIMIT 50`).all(ch.id, before);
  res.json(social.decorate(withAtt(rows.reverse(), 'message')));
});
app.post('/api/channels/:id/messages', auth, (req, res) => {
  const ch = channelFor(req.user, req.params.id, 'chat');
  if (!ch) return bad(res, 'Salon introuvable', 404);
  const content = text(req.body.content, 2000);
  let nAtt;
  try { nAtt = uploads.check(req.user, req.body.attachments); } catch (e) { return bad(res, e.message); }
  if (!content && !nAtt) return bad(res, 'Message vide');
  let original;
  try { original = social.checkReplyTo(req.user, ch.id, req.body.reply_to); } catch (e) { return bad(res, e.message); }
  const r = db.prepare('INSERT INTO messages (channel_id, user_id, content, created_at, reply_to) VALUES (?, ?, ?, ?, ?)').run(ch.id, req.user.id, content, now(), original?.id ?? null);
  uploads.link(req.user, req.body.attachments, 'message', r.lastInsertRowid, ch.id);
  const msg = social.decorate(withAtt([db.prepare(`${MSG_SELECT} WHERE m.id = ?`).get(r.lastInsertRowid)], 'message'))[0];
  broadcastChannel(ch, 'message', msg);
  const mentioned = notifyMentions(req.user, content, ch, `#/salon/${ch.id}`, `dans #${ch.name}`);
  if (original && !mentioned.has(original.user_id)) social.notifyReply(req.user, original, ch, content);
  res.json(msg);
});
app.delete('/api/messages/:id', auth, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(+req.params.id);
  const ch = m && channelFor(req.user, m.channel_id);
  if (!m || !ch) return bad(res, 'Introuvable', 404);
  if (m.user_id !== req.user.id && req.user.role !== 'admin') return bad(res, 'Interdit', 403);
  db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(m.id);
  uploads.removeFor('message', [m.id]);
  social.removeFor('message', [m.id]);
  broadcastChannel(ch, 'message_deleted', { id: m.id, channel_id: m.channel_id });
  res.json({ ok: true });
});

// ---------- Forum ----------
app.get('/api/channels/:id/topics', auth, (req, res) => {
  const ch = channelFor(req.user, req.params.id, 'forum');
  if (!ch) return bad(res, 'Forum introuvable', 404);
  res.json(db.prepare(`SELECT t.id, t.title, t.pinned, t.solved, t.created_at, t.last_activity, u.display_name,
      (SELECT COUNT(*) FROM replies r WHERE r.topic_id = t.id) AS replies,
      (SELECT COUNT(*) FROM attachments a WHERE a.target = 'topic' AND a.target_id = t.id) AS files
    FROM topics t JOIN users u ON u.id = t.user_id WHERE t.channel_id = ?
    ORDER BY t.pinned DESC, t.last_activity DESC`).all(ch.id));
});
app.post('/api/channels/:id/topics', auth, (req, res) => {
  const ch = channelFor(req.user, req.params.id, 'forum');
  if (!ch) return bad(res, 'Forum introuvable', 404);
  const title = text(req.body.title, 120), content = text(req.body.content, 8000);
  if (!title || !content) return bad(res, 'Titre et contenu obligatoires');
  try { uploads.check(req.user, req.body.attachments); } catch (e) { return bad(res, e.message); }
  const r = db.prepare('INSERT INTO topics (channel_id, user_id, title, content, created_at, last_activity) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ch.id, req.user.id, title, content, now(), now());
  uploads.link(req.user, req.body.attachments, 'topic', r.lastInsertRowid, ch.id);
  game.award(req.user.id, 'sujet');
  broadcastChannel(ch, 'topic', { channel_id: ch.id });
  notifyMentions(req.user, content, ch, `#/sujet/${r.lastInsertRowid}`, `dans « ${title} »`);
  res.json({ id: r.lastInsertRowid });
});
function topicFor(user, id) {
  const t = db.prepare('SELECT * FROM topics WHERE id = ?').get(+id);
  const ch = t && channelFor(user, t.channel_id);
  return ch ? { t, ch } : null;
}
app.get('/api/topics/:id', auth, (req, res) => {
  const tc = topicFor(req.user, req.params.id);
  if (!tc) return bad(res, 'Sujet introuvable', 404);
  const t = db.prepare(`SELECT t.*, u.display_name, u.username, c.name AS channel_name FROM topics t
    JOIN users u ON u.id = t.user_id JOIN channels c ON c.id = t.channel_id WHERE t.id = ?`).get(tc.t.id);
  t.attachments = withAtt([{ id: t.id }], 'topic')[0].attachments;
  t.reactions = social.reactionsFor('topic', [t.id])[t.id] || [];
  t.replies = social.decorate(withAtt(db.prepare(`SELECT r.id, r.content, r.created_at, r.edited_at, r.user_id, u.display_name, u.username, u.role FROM replies r
    JOIN users u ON u.id = r.user_id WHERE r.topic_id = ? ORDER BY r.id`).all(t.id), 'reply'), 'reply');
  res.json(t);
});
app.post('/api/topics/:id/replies', auth, (req, res) => {
  const tc = topicFor(req.user, req.params.id);
  if (!tc) return bad(res, 'Sujet introuvable', 404);
  const { t, ch } = tc;
  const content = text(req.body.content, 8000);
  let nAtt;
  try { nAtt = uploads.check(req.user, req.body.attachments); } catch (e) { return bad(res, e.message); }
  if (!content && !nAtt) return bad(res, 'Réponse vide');
  const r = db.prepare('INSERT INTO replies (topic_id, user_id, content, created_at) VALUES (?, ?, ?, ?)').run(t.id, req.user.id, content, now());
  uploads.link(req.user, req.body.attachments, 'reply', r.lastInsertRowid, ch.id);
  db.prepare('UPDATE topics SET last_activity = ? WHERE id = ?').run(now(), t.id);
  if (t.user_id !== req.user.id) game.award(req.user.id, 'reponse');
  broadcastChannel(ch, 'topic', { channel_id: t.channel_id, topic_id: t.id });
  // Mentions d'abord, puis l'auteur du sujet et les personnes qui y ont déjà répondu
  const link = `#/sujet/${t.id}`;
  const done = notifyMentions(req.user, content, ch, link, `dans « ${t.title} »`);
  const followers = new Set([t.user_id, ...db.prepare('SELECT DISTINCT user_id FROM replies WHERE topic_id = ?').all(t.id).map(x => x.user_id)]);
  for (const uid of followers) {
    if (uid === req.user.id || done.has(uid)) continue;
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!canSee(u, ch)) continue;
    notifier.notify(uid, {
      type: 'reply', link,
      title: uid === t.user_id ? `Nouvelle réponse à ton sujet « ${t.title} »` : `Nouvelle réponse dans « ${t.title} »`,
      body: `${req.user.display_name} : ${snippet(content || '📎 pièce jointe')}`,
    });
  }
  res.json({ ok: true });
});
app.patch('/api/topics/:id', auth, (req, res) => {
  const tc = topicFor(req.user, req.params.id);
  if (!tc) return bad(res, 'Sujet introuvable', 404);
  const { t, ch } = tc;
  const isAdmin = req.user.role === 'admin';
  if (t.user_id !== req.user.id && !isAdmin) return bad(res, 'Interdit', 403);
  if ('solved' in req.body) db.prepare('UPDATE topics SET solved = ? WHERE id = ?').run(req.body.solved ? 1 : 0, t.id);
  if ('pinned' in req.body && isAdmin) db.prepare('UPDATE topics SET pinned = ? WHERE id = ?').run(req.body.pinned ? 1 : 0, t.id);
  broadcastChannel(ch, 'topic', { channel_id: t.channel_id, topic_id: t.id });
  res.json({ ok: true });
});
app.delete('/api/topics/:id', auth, (req, res) => {
  const tc = topicFor(req.user, req.params.id);
  if (!tc) return bad(res, 'Sujet introuvable', 404);
  const { t, ch } = tc;
  if (t.user_id !== req.user.id && req.user.role !== 'admin') return bad(res, 'Interdit', 403);
  uploads.removeFor('reply', db.prepare('SELECT id FROM replies WHERE topic_id = ?').all(t.id).map(x => x.id));
  uploads.removeFor('topic', [t.id]);
  social.removeFor('reply', db.prepare('SELECT id FROM replies WHERE topic_id = ?').all(t.id).map(x => x.id));
  social.removeFor('topic', [t.id]);
  db.prepare('DELETE FROM topics WHERE id = ?').run(t.id);
  broadcastChannel(ch, 'topic', { channel_id: t.channel_id });
  res.json({ ok: true });
});
app.delete('/api/replies/:id', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM replies WHERE id = ?').get(+req.params.id);
  const tc = r && topicFor(req.user, r.topic_id);
  if (!tc) return bad(res, 'Introuvable', 404);
  if (r.user_id !== req.user.id && req.user.role !== 'admin') return bad(res, 'Interdit', 403);
  uploads.removeFor('reply', [r.id]);
  db.prepare('DELETE FROM replies WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

// ---------- Révisions ----------
const INTERVALS = [0, 1, 3, 7, 14, 30, 60]; // jours, système de Leitner
app.get('/api/subjects', auth, (req, res) => {
  const mastered = db.prepare('SELECT card_key FROM card_progress WHERE user_id = ? AND box >= 4').all(req.user.id).map(r => r.card_key);
  const best = db.prepare('SELECT subject, MAX(CAST(score AS REAL) / total) AS best FROM quiz_results WHERE user_id = ? GROUP BY subject').all(req.user.id);
  const bestMap = Object.fromEntries(best.map(b => [b.subject, b.best]));
  const community = db.prepare('SELECT subject, COUNT(*) AS n FROM fiches GROUP BY subject').all();
  const cMap = Object.fromEntries(community.map(c => [c.subject, c.n]));
  res.json(SUBJECTS.map(s => ({
    id: s.id, nom: s.nom, icone: s.icone, description: s.description, groupe: s.groupe,
    publics: s.publics || ['*'], pour_toi: formations.matches(req.user, s.publics), pertinence: formations.score(req.user, s.publics),
    epreuve: formations.epreuveFor(req.user, s.id), sources: (s.sources || []).length,
    fiches: s.fiches.length + (cMap[s.id] || 0), quiz: s.quiz.length, cartes: s.cartes.length,
    maitrise: mastered.filter(k => k.startsWith(s.id + ':')).length,
    meilleur_quiz: bestMap[s.id] ?? null,
  })));
});
app.get('/api/subjects/:id', auth, (req, res) => {
  const s = SUBJECTS.find(x => x.id === req.params.id);
  if (!s) return bad(res, 'Matière introuvable', 404);
  const community = db.prepare(`SELECT f.id, f.title, f.content, f.created_at, f.user_id, u.display_name FROM fiches f
    JOIN users u ON u.id = f.user_id WHERE f.subject = ? ORDER BY f.id DESC`).all(s.id);
  const progress = db.prepare('SELECT card_key, box, due FROM card_progress WHERE user_id = ? AND card_key LIKE ?').all(req.user.id, s.id + ':%');
  res.json({ ...s, communaute: community, progression: progress });
});
app.post('/api/fiches', auth, (req, res) => {
  const subject = text(req.body.subject, 40);
  if (!SUBJECTS.find(s => s.id === subject)) return bad(res, 'Matière inconnue');
  const title = text(req.body.title, 120), content = text(req.body.content, 20000);
  if (!title || !content) return bad(res, 'Titre et contenu obligatoires');
  const r = db.prepare('INSERT INTO fiches (subject, title, content, user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(subject, title, content, req.user.id, now());
  game.award(req.user.id, 'fiche');
  res.json({ id: r.lastInsertRowid });
});
app.delete('/api/fiches/:id', auth, (req, res) => {
  const f = db.prepare('SELECT * FROM fiches WHERE id = ?').get(+req.params.id);
  if (!f) return bad(res, 'Introuvable', 404);
  if (f.user_id !== req.user.id && req.user.role !== 'admin') return bad(res, 'Interdit', 403);
  db.prepare('DELETE FROM fiches WHERE id = ?').run(f.id);
  res.json({ ok: true });
});
app.post('/api/cards/review', auth, (req, res) => {
  const key = text(req.body.key, 80);
  const [sid, idx] = key.split(':');
  const s = SUBJECTS.find(x => x.id === sid);
  if (!s || !s.cartes[+idx]) return bad(res, 'Carte inconnue');
  const cur = db.prepare('SELECT box FROM card_progress WHERE user_id = ? AND card_key = ?').get(req.user.id, key);
  let box = cur ? cur.box : 0;
  box = req.body.ok ? Math.min(box + 1, INTERVALS.length - 1) : 0;
  const due = now() + INTERVALS[box] * 864e5;
  db.prepare(`INSERT INTO card_progress (user_id, card_key, box, due) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, card_key) DO UPDATE SET box = excluded.box, due = excluded.due`).run(req.user.id, key, box, due);
  game.award(req.user.id, req.body.ok ? 'carte_ok' : 'carte_ko');
  res.json({ box, due });
});
app.post('/api/quiz-results', auth, (req, res) => {
  const subject = text(req.body.subject, 40);
  const score = Math.max(0, +req.body.score | 0), total = Math.max(1, +req.body.total | 0);
  if (!SUBJECTS.find(s => s.id === subject) || score > total) return bad(res, 'Résultat invalide');
  db.prepare('INSERT INTO quiz_results (user_id, subject, score, total, created_at) VALUES (?, ?, ?, ?, ?)').run(req.user.id, subject, score, total, now());
  const perfect = score === total && total >= 5;
  const xp = game.award(req.user.id, 'quiz', score * 3 + (perfect ? 15 : 0), { perfectQuiz: perfect });
  res.json({ ok: true, xp, perfect });
});
// Compte à rebours de l'accueil : première épreuve à venir de la filière de l'élève
function prochainExamen(u) {
  const ex = formations.examens()[u.filiere];
  if (!ex) return null;
  const today = new Date().toISOString().slice(0, 10);
  const d = ex.dates.find(x => x.date >= today && !x.titre.startsWith('Fin des inscriptions'));
  return d ? { date: d.date, titre: d.titre, filiere: accounts.filiereNom(u.filiere) } : { date: null, titre: ex.comment[0], filiere: accounts.filiereNom(u.filiere) };
}
app.get('/api/dashboard', auth, (req, res) => {
  const due = db.prepare('SELECT COUNT(*) AS n FROM card_progress WHERE user_id = ? AND due <= ?').get(req.user.id, now()).n;
  const seen = db.prepare('SELECT COUNT(*) AS n FROM card_progress WHERE user_id = ?').get(req.user.id).n;
  const total = SUBJECTS.filter(s => formations.matches(req.user, s.publics)).reduce((a, s) => a + s.cartes.length, 0);
  const quizzes = db.prepare('SELECT subject, score, total, created_at FROM quiz_results WHERE user_id = ? ORDER BY id DESC LIMIT 5').all(req.user.id);
  const topics = db.prepare(`SELECT t.id, t.title, t.solved, c.name AS channel FROM topics t JOIN channels c ON c.id = t.channel_id
    WHERE ? = 'admin' OR c.filiere IS NULL OR c.filiere = ? ORDER BY t.last_activity DESC LIMIT 5`).all(req.user.role, req.user.filiere || '');
  const r = calendar.rythmeOf(req.user);
  const cfaDays = (r.effective || '').split(',').filter(Boolean).map(Number);
  const today = calendar.weekday(now());
  res.json({
    cartes_a_revoir: Math.max(due, due + total - seen), cartes_total: total, quiz: quizzes,
    sujets: req.user.role === 'prof' ? [] : topics, examen: prochainExamen(req.user),
    formation: req.user.formation ? { id: req.user.formation, nom: formations.nom(req.user.formation) } : null,
    evenements: calendar.upcoming(req.user, 5), exercices: exercises.pendingFor(req.user, 5),
    travail: cahier.pendingFor(req.user, 5), messages_non_lus: messagerie.unreadTotal(req.user.id),
    viescolaire: req.user.role === 'eleve' ? viescolaire.resume(req.user.id) : null,
    alternance: req.user.role === 'eleve' ? { configure: cfaDays.length > 0, aujourdhui: cfaDays.length ? (cfaDays.includes(today) ? 'cfa' : today >= 6 ? 'weekend' : 'entreprise') : null, jours_cfa: cfaDays } : null,
  });
});

// ---------- Actus & infos ----------
app.get('/api/news', auth, async (req, res) => {
  let live = { items: [], errors: [] };
  try { live = await getNews(req.query.refresh === '1' && req.user.role === 'admin'); } catch { /* hors ligne */ }
  // « Pour toi » : actus des domaines de la formation de l'élève (les formateurs voient tout)
  const tag = x => ({ ...x, pour_toi: formations.matches(req.user, x.publics || ['*']), metier: !(x.publics || ['*']).includes('*') });
  res.json({ alaune: readJson('alaune.json').map(tag), flux: live.items.map(tag), indisponibles: live.errors, formation: formations.nom(req.user.formation) });
});
app.get('/api/infos', auth, (req, res) => res.json(readJson('infos.json')));

// ---------- Modération ----------
app.get('/api/admin/invites', auth, admin, (req, res) => {
  res.json(db.prepare('SELECT * FROM invites WHERE uses_left > 0 ORDER BY created_at DESC').all());
});
app.post('/api/admin/invites', auth, admin, (req, res) => {
  const uses = Math.min(Math.max(+req.body.uses | 0, 1), 100);
  const role = req.body.role === 'prof' ? 'prof' : 'eleve';
  const code = (role === 'prof' ? 'P' : '') + crypto.randomBytes(5).toString('hex').toUpperCase();
  db.prepare('INSERT INTO invites (code, created_by, uses_left, created_at, role) VALUES (?, ?, ?, ?, ?)').run(code, req.user.id, uses, now(), role);
  res.json({ code, uses_left: uses, role });
});
app.delete('/api/admin/invites/:code', auth, admin, (req, res) => {
  db.prepare('DELETE FROM invites WHERE code = ?').run(req.params.code);
  res.json({ ok: true });
});
app.post('/api/admin/reload-content', auth, admin, (req, res) => {
  SUBJECTS = loadSubjects();
  res.json({ ok: true, matieres: SUBJECTS.length });
});

app.use('/api', (req, res) => bad(res, 'Route inconnue', 404));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Nettoyage des sessions expirées
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(now()), 3600e3).unref();

if (require.main === module) {
  app.listen(PORT, () => console.log(`Plateforme lancée sur http://localhost:${PORT}`));
}
module.exports = app;
