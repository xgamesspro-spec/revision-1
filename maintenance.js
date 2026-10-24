// Maintenance : version, état des mises à jour automatiques (scripts/auto-update.sh) et rapports d'erreurs
// (serveur, navigateur, mise à jour). Les modérateurs sont prévenus par notification.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATUS_FILE = path.join(DATA_DIR, 'update-status.json');
const HISTORY_FILE = path.join(DATA_DIR, 'update-history.jsonl');
// Version = commit installé (écrit par scripts/auto-update.sh dans data/version.txt avant chaque redémarrage)
const VERSION = process.env.APP_VERSION || (() => { try { return fs.readFileSync(path.join(DATA_DIR, 'version.txt'), 'utf8').trim() || 'dev'; } catch { return 'dev'; } })();
const STARTED = Date.now();

module.exports = function setupMaintenance(app, { db, auth, admin, bad, now, text, notifier }) {
  db.exec(`CREATE TABLE IF NOT EXISTS app_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL UNIQUE, source TEXT NOT NULL, message TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '', user_id INTEGER, count INTEGER NOT NULL DEFAULT 1,
    first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, notified_at INTEGER, seen INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const meta = k => db.prepare('SELECT value FROM app_meta WHERE key = ?').get(k)?.value;
  const setMeta = (k, v) => db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  const admins = () => db.prepare("SELECT id FROM users WHERE role = 'admin' AND deleted = 0 AND banned = 0").all().map(u => u.id);
  const notifyAdmins = n => { for (const id of admins()) { try { notifier.notify(id, { type: 'systeme', link: '#/maintenance', ...n }); } catch { /* ignoré */ } } };

  // Enregistre une erreur (regroupée si elle se répète) ; prévient les modérateurs au plus une fois par heure et par erreur
  function report(source, message, { detail = '', url = '', userId = null } = {}) {
    try {
      message = String(message || 'Erreur inconnue').slice(0, 300);
      const hash = crypto.createHash('sha1').update(`${source}|${message}|${String(detail).split('\n').slice(0, 3).join('|')}`).digest('hex');
      const cur = db.prepare('SELECT * FROM app_errors WHERE hash = ?').get(hash);
      if (cur) db.prepare('UPDATE app_errors SET count = count + 1, last_at = ?, seen = 0, url = ? WHERE id = ?').run(now(), String(url).slice(0, 300), cur.id);
      else db.prepare('INSERT INTO app_errors (hash, source, message, detail, url, user_id, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(hash, source, message, String(detail).slice(0, 4000), String(url).slice(0, 300), userId, now(), now());
      const row = db.prepare('SELECT * FROM app_errors WHERE hash = ?').get(hash);
      if (!row.notified_at || now() - row.notified_at > 3600e3) {
        db.prepare('UPDATE app_errors SET notified_at = ? WHERE id = ?').run(now(), row.id);
        const label = { serveur: 'Erreur du serveur', navigateur: 'Erreur dans le navigateur', 'mise-a-jour': 'Mise à jour automatique' }[source] || 'Erreur';
        notifyAdmins({ title: `⚠️ ${label}${row.count > 1 ? ` (×${row.count})` : ''}`, body: message });
      }
    } catch (e) { console.error('[maintenance] rapport impossible', e.message); }
  }

  // ---------- Santé (utilisée par le script de mise à jour pour vérifier que tout redémarre) ----------
  app.get('/api/health', (req, res) => {
    try { db.prepare('SELECT 1').get(); } catch { return res.status(500).json({ ok: false }); }
    res.json({ ok: true, version: VERSION, uptime: Math.round((Date.now() - STARTED) / 1000) });
  });

  // ---------- Erreurs du navigateur (envoyées automatiquement par l'appli) ----------
  const hits = new Map();
  app.post('/api/client-error', (req, res) => {
    const h = hits.get(req.ip) || { n: 0, t: now() };
    if (now() - h.t > 3600e3) { h.n = 0; h.t = now(); }
    if (++h.n > 30) return res.status(204).end();
    hits.set(req.ip, h);
    const msg = text(req.body.message, 300);
    if (!msg) return res.status(204).end();
    report('navigateur', msg, { detail: `${text(req.body.stack, 3000)}\n\nNavigateur : ${text(req.get('user-agent'), 200)}`, url: text(req.body.url, 300), userId: req.user?.id || null });
    res.status(204).end();
  });

  // ---------- Mises à jour automatiques ----------
  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const history = () => {
    try { return fs.readFileSync(HISTORY_FILE, 'utf8').trim().split('\n').filter(Boolean).slice(-30).reverse().map(l => JSON.parse(l)); } catch { return []; }
  };
  function checkUpdate() {
    const s = readJson(STATUS_FILE);
    if (!s?.at || meta('update_seen') === s.at) return;
    setMeta('update_seen', s.at);
    if (s.result === 'erreur' || s.result === 'rollback') {
      report('mise-a-jour', s.message || 'La mise à jour a échoué', { detail: (s.log || []).join('\n') });
    } else if (s.result === 'ok') {
      notifyAdmins({ title: `✅ Mise à jour installée (${s.to || 'nouvelle version'})`, body: (s.commits || []).slice(0, 3).join(' · ') || 'Nouvelle version en ligne' });
    }
  }
  setTimeout(checkUpdate, 15000).unref();
  setInterval(checkUpdate, 5 * 60e3).unref();

  app.get('/api/admin/maintenance', auth, admin, (req, res) => {
    res.json({
      version: VERSION, started_at: STARTED, node: process.version,
      update: readJson(STATUS_FILE), history: history(), auto_update: fs.existsSync(STATUS_FILE),
      errors: db.prepare('SELECT id, source, message, detail, url, count, first_at, last_at, seen FROM app_errors ORDER BY seen, last_at DESC LIMIT 100').all(),
    });
  });
  app.post('/api/admin/errors/:id/seen', auth, admin, (req, res) => {
    db.prepare('UPDATE app_errors SET seen = 1 WHERE id = ?').run(+req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/admin/errors/clear', auth, admin, (req, res) => {
    db.prepare('DELETE FROM app_errors WHERE seen = 1').run();
    res.json({ ok: true });
  });
  app.post('/api/admin/errors/test', auth, admin, (req, res) => {
    report('serveur', 'Erreur de test (bouton « Tester les alertes »)', { detail: 'Tout fonctionne : les alertes arrivent bien.', userId: req.user.id });
    res.json({ ok: true });
  });
  const unseen = () => db.prepare('SELECT COUNT(*) AS n FROM app_errors WHERE seen = 0').get().n;

  // Erreurs non prévues dans les routes : réponse propre + rapport
  function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') return bad(res, 'Requête invalide');
    if (err.type === 'entity.too.large') return bad(res, 'Envoi trop volumineux', 413);
    console.error('[erreur]', req.method, req.path, err);
    report('serveur', err.message, { detail: err.stack || '', url: `${req.method} ${req.path}`, userId: req.user?.id || null });
    res.status(500).json({ error: 'Erreur du serveur : les modérateurs ont été prévenus.' });
  }
  process.on('unhandledRejection', err => { console.error('[erreur async]', err); report('serveur', err?.message || String(err), { detail: err?.stack || '' }); });

  return { report, errorHandler, unseen, VERSION };
};
