// Cahier de textes (comme Pronote / Ypareo) : le formateur note ce qui a été fait en séance
// et le travail à faire pour une date ; l'élève coche ce qu'il a fait.
module.exports = function setupCahier(app, { db, auth, bad, now, text, uploads, notifier, cible, onChange = () => {} }) {
  db.exec(`CREATE TABLE IF NOT EXISTS cahier (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, matiere TEXT NOT NULL DEFAULT '', titre TEXT NOT NULL,
    contenu TEXT NOT NULL DEFAULT '', travail TEXT NOT NULL DEFAULT '', pour_le TEXT,
    filiere TEXT, formation TEXT, author_id INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cahier_date ON cahier(date);
  CREATE TABLE IF NOT EXISTS cahier_fait (
    entry_id INTEGER NOT NULL REFERENCES cahier(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (entry_id, user_id)
  );`);

  const staffOnly = (req, res, next) => cible.isStaff(req.user) ? next() : bad(res, 'Réservé aux formateurs', 403);
  const get = id => db.prepare('SELECT * FROM cahier WHERE id = ?').get(+id);
  const visible = (u, e) => !!e && cible.match(u, e);
  const canEdit = (u, e) => u.role === 'admin' || e.author_id === u.id;
  const atts = ids => uploads.forTargets('cahier', ids);

  function parse(b, cur = {}) {
    const e = { ...cur, ...cible.parse('filiere' in b || 'formation' in b ? b : cur) };
    if ('titre' in b || !cur.id) e.titre = text(b.titre, 120);
    if (!e.titre) throw new Error('Titre de la séance obligatoire');
    if ('date' in b || !cur.id) e.date = String(b.date || cible.today());
    if (!cible.isDate(e.date)) throw new Error('Date de séance invalide');
    if ('matiere' in b) e.matiere = text(b.matiere, 60);
    if ('contenu' in b) e.contenu = text(b.contenu, 20000);
    if ('travail' in b) e.travail = text(b.travail, 5000);
    if ('pour_le' in b) e.pour_le = b.pour_le ? String(b.pour_le) : null;
    if (e.pour_le && !cible.isDate(e.pour_le)) throw new Error('Date « pour le » invalide');
    if (e.pour_le && !e.travail) throw new Error('Décris le travail à faire');
    return e;
  }
  const out = (u, e, files = []) => ({
    ...e, author: cible.nameOf(e.author_id), cible: cible.label(e), attachments: files, can_edit: canEdit(u, e),
    fait: u.role === 'eleve' ? !!db.prepare('SELECT 1 FROM cahier_fait WHERE entry_id = ? AND user_id = ?').get(e.id, u.id) : undefined,
    nb_fait: cible.isStaff(u) && e.travail ? db.prepare('SELECT COUNT(*) AS n FROM cahier_fait WHERE entry_id = ?').get(e.id).n : undefined,
    nb_eleves: cible.isStaff(u) && e.travail ? cible.students(e).length : undefined,
  });

  // ?from=YYYY-MM-DD&to=… (séances) ; le travail à faire est renvoyé à part, trié par échéance
  app.get('/api/cahier', auth, (req, res) => {
    const u = req.user;
    const to = cible.isDate(req.query.to) ? req.query.to : cible.today(now() + 14 * 864e5);
    const from = cible.isDate(req.query.from) ? req.query.from : cible.today(now() - 21 * 864e5);
    const rows = db.prepare('SELECT * FROM cahier WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC').all(from, to).filter(e => visible(u, e));
    const files = atts(rows.map(r => r.id));
    const todo = db.prepare("SELECT * FROM cahier WHERE pour_le >= ? AND travail != '' ORDER BY pour_le, id").all(cible.today(now() - 864e5))
      .filter(e => visible(u, e)).map(e => out(u, e, atts([e.id])[e.id]));
    res.json({ from, to, seances: rows.map(e => out(u, e, files[e.id])), travail: todo, staff: cible.isStaff(u) });
  });

  app.post('/api/cahier', auth, staffOnly, (req, res) => {
    let e;
    try { e = parse(req.body); uploads.check(req.user, req.body.attachments); } catch (err) { return bad(res, err.message); }
    const r = db.prepare(`INSERT INTO cahier (date, matiere, titre, contenu, travail, pour_le, filiere, formation, author_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.date, e.matiere || '', e.titre, e.contenu || '', e.travail || '', e.pour_le || null,
      e.filiere, e.formation, req.user.id, now(), now());
    const created = get(r.lastInsertRowid);
    uploads.link(req.user, req.body.attachments, 'cahier', created.id, null);
    onChange(created);
    if (created.travail) {
      for (const s of cible.students(created)) {
        notifier.notify(s.id, { type: 'scolarite', link: '#/cahier', title: `📒 Travail à faire${created.matiere ? ` en ${created.matiere}` : ''}`,
          body: `${created.titre}${created.pour_le ? ` — pour le ${created.pour_le.split('-').reverse().join('/')}` : ''}` });
      }
    }
    res.json({ id: created.id });
  });

  app.patch('/api/cahier/:id', auth, staffOnly, (req, res) => {
    const cur = get(req.params.id);
    if (!cur) return bad(res, 'Séance introuvable', 404);
    if (!canEdit(req.user, cur)) return bad(res, 'Seul son auteur ou un modérateur peut la modifier', 403);
    let e;
    try { e = parse(req.body, cur); uploads.check(req.user, req.body.attachments); } catch (err) { return bad(res, err.message); }
    db.prepare('UPDATE cahier SET date = ?, matiere = ?, titre = ?, contenu = ?, travail = ?, pour_le = ?, filiere = ?, formation = ?, updated_at = ? WHERE id = ?')
      .run(e.date, e.matiere, e.titre, e.contenu, e.travail, e.pour_le || null, e.filiere, e.formation, now(), cur.id);
    uploads.link(req.user, req.body.attachments, 'cahier', cur.id, null);
    onChange(cur); onChange(get(cur.id));
    res.json({ ok: true });
  });

  app.delete('/api/cahier/:id', auth, staffOnly, (req, res) => {
    const e = get(req.params.id);
    if (!e) return bad(res, 'Séance introuvable', 404);
    if (!canEdit(req.user, e)) return bad(res, 'Seul son auteur ou un modérateur peut la supprimer', 403);
    uploads.removeFor('cahier', [e.id]);
    db.prepare('DELETE FROM cahier WHERE id = ?').run(e.id);
    onChange(e);
    res.json({ ok: true });
  });

  app.post('/api/cahier/:id/fait', auth, (req, res) => {
    const e = get(req.params.id);
    if (!visible(req.user, e) || req.user.role !== 'eleve') return bad(res, 'Séance introuvable', 404);
    if (req.body.done) db.prepare('INSERT OR IGNORE INTO cahier_fait (entry_id, user_id, at) VALUES (?, ?, ?)').run(e.id, req.user.id, now());
    else db.prepare('DELETE FROM cahier_fait WHERE entry_id = ? AND user_id = ?').run(e.id, req.user.id);
    res.json({ ok: true });
  });

  // Pour l'accueil : travail à faire non coché
  function pendingFor(u, limit = 5) {
    if (u.role !== 'eleve') return [];
    return db.prepare("SELECT * FROM cahier WHERE pour_le >= ? AND travail != '' ORDER BY pour_le").all(cible.today())
      .filter(e => visible(u, e) && !db.prepare('SELECT 1 FROM cahier_fait WHERE entry_id = ? AND user_id = ?').get(e.id, u.id))
      .slice(0, limit).map(e => ({ id: e.id, titre: e.titre, matiere: e.matiere, pour_le: e.pour_le }));
  }
  const canAccessAttachment = (u, a) => a.target === 'cahier' && visible(u, get(a.target_id));
  const forgetUser = uid => db.prepare('DELETE FROM cahier_fait WHERE user_id = ?').run(uid);
  return { pendingFor, canAccessAttachment, forgetUser, visible };
};
