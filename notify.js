// Notifications : dans l'appli (temps réel) + Web Push (Push API du W3C, RFC 8030 / 8291 / 8292 via la librairie web-push).
// Le push n'est envoyé que si la personne n'a aucun onglet ouvert, pour éviter les doublons.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
// Seuls les vrais services push des navigateurs sont acceptés (protection contre le SSRF)
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/, /^android\.googleapis\.com$/,
  ...(process.env.PUSH_HOST_ALLOWLIST || '').split(',').filter(Boolean).map(h => new RegExp(`^${h.replace(/\./g, '\\.')}$`)),
];
const DEFAULT_PREFS = { mention: true, reply: true, exercice: true, rappel: true, push: true };

function loadVapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = path.join(DATA_DIR, 'vapid.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* première fois */ }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

module.exports = function setupNotify(app, { db, auth, bad, now, conns, text }) {
  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
    read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id);
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL
  );`);
  if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'notif_prefs')) db.exec('ALTER TABLE users ADD COLUMN notif_prefs TEXT');

  const vapid = loadVapid();
  const publicUrl = process.env.PUBLIC_URL || '';
  const subject = process.env.VAPID_SUBJECT || (publicUrl.startsWith('https://') ? publicUrl : 'mailto:admin@example.org');
  webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
  let sender = (sub, payload, opts) => webpush.sendNotification(sub, payload, opts);

  const prefsOf = u => ({ ...DEFAULT_PREFS, ...(() => { try { return JSON.parse(u.notif_prefs || '{}'); } catch { return {}; } })() });
  const unreadCount = uid => db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(uid).n;
  const userConns = uid => [...conns.values()].filter(c => c.user.id === uid);

  async function push(uid, payload) {
    const subs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(uid);
    await Promise.all(subs.map(async s => {
      try {
        await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400, urgency: 'normal' });
      } catch (err) {
        // 404 / 410 : abonnement expiré ou révoqué, on le supprime
        if (err.statusCode === 404 || err.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint);
        else console.warn('[push] échec', err.statusCode || err.message);
      }
    }));
  }

  function notify(uid, { type, title, body = '', link = '' }) {
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0 AND banned = 0').get(uid);
    if (!u) return;
    const prefs = prefsOf(u);
    if (prefs[type] === false) return;
    const r = db.prepare('INSERT INTO notifications (user_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid, type, title.slice(0, 140), body.slice(0, 200), link, now());
    const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(r.lastInsertRowid);
    const open = userConns(uid);
    const payload = `event: notif\ndata: ${JSON.stringify({ notif, unread: unreadCount(uid) })}\n\n`;
    open.forEach(c => c.res.write(payload));
    if (!open.length && prefs.push) push(uid, { title: notif.title, body: notif.body, link: notif.link, tag: `${type}-${notif.id}` }).catch(() => {});
  }

  // @identifiant dans un texte → utilisateurs existants (10 max)
  function findMentions(content) {
    const names = [...new Set([...String(content).matchAll(/(^|[^\w@])@([a-zA-Z0-9_.-]{3,24})/g)].map(m => m[2].toLowerCase().replace(/\.+$/, '')))].slice(0, 10);
    return names.map(n => db.prepare('SELECT * FROM users WHERE username = ? AND deleted = 0 AND banned = 0').get(n)).filter(Boolean);
  }

  // ---------- Routes ----------
  app.get('/api/notifications', auth, (req, res) => {
    const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
    res.json({ items, unread: unreadCount(req.user.id), prefs: prefsOf(req.user) });
  });
  app.post('/api/notifications/read', auth, (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean).slice(0, 200) : null;
    if (ids && ids.length) db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`).run(req.user.id, ...ids);
    else db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ unread: unreadCount(req.user.id) });
  });
  app.post('/api/notifications/prefs', auth, (req, res) => {
    const p = prefsOf(req.user);
    for (const k of Object.keys(DEFAULT_PREFS)) if (k in req.body) p[k] = !!req.body[k];
    db.prepare('UPDATE users SET notif_prefs = ? WHERE id = ?').run(JSON.stringify(p), req.user.id);
    res.json({ prefs: p });
  });

  app.get('/api/push/key', auth, (req, res) => res.json({ publicKey: vapid.publicKey }));
  app.post('/api/push/subscribe', auth, (req, res) => {
    const s = req.body.subscription || {};
    let url;
    try { url = new URL(String(s.endpoint)); } catch { return bad(res, 'Abonnement invalide'); }
    if (url.protocol !== 'https:' || !PUSH_HOSTS.some(rx => rx.test(url.hostname))) return bad(res, 'Service de notification non reconnu');
    const p256dh = text(s.keys?.p256dh, 200), authKey = text(s.keys?.auth, 100);
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,30}$/.test(authKey)) return bad(res, 'Clés invalides');
    db.prepare(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
      .run(url.toString(), req.user.id, p256dh, authKey, now());
    const n = db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').get(req.user.id).n;
    if (n > 10) db.prepare('DELETE FROM push_subs WHERE user_id = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10)').run(req.user.id, req.user.id);
    res.json({ ok: true });
  });
  app.post('/api/push/unsubscribe', auth, (req, res) => {
    db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(String(req.body.endpoint || ''), req.user.id);
    res.json({ ok: true });
  });
  app.post('/api/push/test', auth, async (req, res) => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').get(req.user.id).n;
    if (!n) return bad(res, 'Aucun appareil abonné');
    await push(req.user.id, { title: 'Notifications activées ✅', body: 'Tu seras prévenu des mentions et des réponses.', link: '#/notifications', tag: 'test' });
    res.json({ ok: true });
  });

  // Ménage : notifications de plus de 60 jours
  setInterval(() => db.prepare('DELETE FROM notifications WHERE created_at < ?').run(now() - 60 * 864e5), 6 * 3600e3).unref();

  return { notify, findMentions, setSender: fn => { sender = fn; } };
};
