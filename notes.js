// Notes et moyennes (comme Pronote / Ypareo) : le formateur crée une évaluation (barème, coefficient),
// saisit les notes (ou Abs / Disp / NN) puis les publie. L'élève voit ses notes, la moyenne de la classe
// et son relevé : moyenne par matière (pondérée) et moyenne générale.
const CODES = { abs: 'Absent', disp: 'Dispensé', nn: 'Non noté' };

module.exports = function setupNotes(app, { db, auth, bad, now, text, notifier, cible }) {
  db.exec(`CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre TEXT NOT NULL, matiere TEXT NOT NULL, date TEXT NOT NULL,
    bareme REAL NOT NULL DEFAULT 20, coef REAL NOT NULL DEFAULT 1, commentaire TEXT NOT NULL DEFAULT '',
    filiere TEXT, formation TEXT, publiee INTEGER NOT NULL DEFAULT 0,
    author_id INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notes (
    eval_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, valeur REAL, code TEXT, appreciation TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL, PRIMARY KEY (eval_id, user_id)
  );`);

  const staffOnly = (req, res, next) => cible.isStaff(req.user) ? next() : bad(res, 'Réservé aux formateurs', 403);
  const get = id => db.prepare('SELECT * FROM evaluations WHERE id = ?').get(+id);
  const visible = (u, ev) => !!ev && cible.match(u, ev) && (cible.isStaff(u) || ev.publiee);
  const canEdit = (u, ev) => u.role === 'admin' || ev.author_id === u.id;
  const sur20 = (n, ev) => (n.valeur == null ? null : n.valeur / ev.bareme * 20);
  const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

  // Statistiques de classe : seulement à partir de 3 notes, pour ne pas deviner la note de quelqu'un
  function stats(ev) {
    const vals = db.prepare('SELECT valeur FROM notes WHERE eval_id = ? AND valeur IS NOT NULL').all(ev.id).map(r => r.valeur);
    if (vals.length < 3) return { n: vals.length };
    return { n: vals.length, moyenne: round(vals.reduce((a, b) => a + b, 0) / vals.length), min: Math.min(...vals), max: Math.max(...vals) };
  }

  function parse(b, cur = {}) {
    const ev = { ...cur, ...cible.parse('filiere' in b || 'formation' in b ? b : cur) };
    if ('titre' in b || !cur.id) ev.titre = text(b.titre, 120);
    if (!ev.titre) throw new Error("Titre de l'évaluation obligatoire");
    if ('matiere' in b || !cur.id) ev.matiere = text(b.matiere, 60);
    if (!ev.matiere) throw new Error('Matière obligatoire');
    if ('date' in b || !cur.id) ev.date = String(b.date || cible.today());
    if (!cible.isDate(ev.date)) throw new Error('Date invalide');
    if ('bareme' in b || !cur.id) ev.bareme = +b.bareme || 20;
    if (!(ev.bareme > 0 && ev.bareme <= 1000)) throw new Error('Barème invalide');
    if ('coef' in b || !cur.id) ev.coef = b.coef === undefined || b.coef === '' ? 1 : +b.coef;
    if (!(ev.coef >= 0 && ev.coef <= 100)) throw new Error('Coefficient invalide');
    if ('commentaire' in b) ev.commentaire = text(b.commentaire, 2000);
    return ev;
  }

  function notifyPublished(ev) {
    for (const s of cible.students(ev)) {
      if (!db.prepare('SELECT 1 FROM notes WHERE eval_id = ? AND user_id = ?').get(ev.id, s.id)) continue;
      notifier.notify(s.id, { type: 'scolarite', link: '#/notes', title: `📊 Nouvelle note en ${ev.matiere}`, body: ev.titre });
    }
  }

  app.get('/api/evaluations', auth, (req, res) => {
    const u = req.user;
    const rows = db.prepare('SELECT * FROM evaluations ORDER BY date DESC, id DESC').all().filter(ev => visible(u, ev));
    res.json({
      staff: cible.isStaff(u), codes: CODES,
      items: rows.map(ev => {
        const base = { ...ev, publiee: !!ev.publiee, cible: cible.label(ev), author: cible.nameOf(ev.author_id), can_edit: canEdit(u, ev), stats: stats(ev) };
        if (cible.isStaff(u)) return { ...base, saisies: db.prepare('SELECT COUNT(*) AS n FROM notes WHERE eval_id = ?').get(ev.id).n, eleves: cible.students(ev).length };
        const n = db.prepare('SELECT valeur, code, appreciation FROM notes WHERE eval_id = ? AND user_id = ?').get(ev.id, u.id);
        return { ...base, ma_note: n || null };
      }),
    });
  });

  app.get('/api/evaluations/:id', auth, staffOnly, (req, res) => {
    const ev = get(req.params.id);
    if (!ev) return bad(res, 'Évaluation introuvable', 404);
    const notes = Object.fromEntries(db.prepare('SELECT * FROM notes WHERE eval_id = ?').all(ev.id).map(n => [n.user_id, n]));
    res.json({
      evaluation: { ...ev, publiee: !!ev.publiee, cible: cible.label(ev), can_edit: canEdit(req.user, ev), stats: stats(ev) }, codes: CODES,
      eleves: cible.students(ev).map(s => ({ id: s.id, display_name: s.display_name, note: notes[s.id] || null })),
    });
  });

  app.post('/api/evaluations', auth, staffOnly, (req, res) => {
    let ev;
    try { ev = parse(req.body); } catch (e) { return bad(res, e.message); }
    const r = db.prepare(`INSERT INTO evaluations (titre, matiere, date, bareme, coef, commentaire, filiere, formation, author_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ev.titre, ev.matiere, ev.date, ev.bareme, ev.coef, ev.commentaire || '', ev.filiere, ev.formation, req.user.id, now(), now());
    res.json({ id: r.lastInsertRowid });
  });

  app.patch('/api/evaluations/:id', auth, staffOnly, (req, res) => {
    const cur = get(req.params.id);
    if (!cur) return bad(res, 'Évaluation introuvable', 404);
    if (!canEdit(req.user, cur)) return bad(res, 'Seul son auteur ou un modérateur peut la modifier', 403);
    let ev;
    try { ev = parse(req.body, cur); } catch (e) { return bad(res, e.message); }
    const publiee = 'publiee' in req.body ? (req.body.publiee ? 1 : 0) : cur.publiee;
    db.prepare('UPDATE evaluations SET titre = ?, matiere = ?, date = ?, bareme = ?, coef = ?, commentaire = ?, filiere = ?, formation = ?, publiee = ?, updated_at = ? WHERE id = ?')
      .run(ev.titre, ev.matiere, ev.date, ev.bareme, ev.coef, ev.commentaire, ev.filiere, ev.formation, publiee, now(), cur.id);
    if (publiee && !cur.publiee) notifyPublished(get(cur.id));
    res.json({ ok: true });
  });

  app.delete('/api/evaluations/:id', auth, staffOnly, (req, res) => {
    const ev = get(req.params.id);
    if (!ev) return bad(res, 'Évaluation introuvable', 404);
    if (!canEdit(req.user, ev)) return bad(res, 'Seul son auteur ou un modérateur peut la supprimer', 403);
    db.prepare('DELETE FROM evaluations WHERE id = ?').run(ev.id);
    res.json({ ok: true });
  });

  // Saisie des notes : [{ user_id, valeur | code, appreciation }] ; valeur vide + pas de code = on efface
  app.put('/api/evaluations/:id/notes', auth, staffOnly, (req, res) => {
    const ev = get(req.params.id);
    if (!ev) return bad(res, 'Évaluation introuvable', 404);
    if (!canEdit(req.user, ev)) return bad(res, 'Seul son auteur ou un modérateur peut saisir les notes', 403);
    const allowed = new Set(cible.students(ev).map(s => s.id));
    const list = Array.isArray(req.body.notes) ? req.body.notes.slice(0, 500) : [];
    const rows = [];
    for (const n of list) {
      const uid = +n.user_id;
      if (!allowed.has(uid)) return bad(res, 'Élève hors de cette classe');
      const code = CODES[n.code] ? n.code : null;
      const raw = n.valeur === '' || n.valeur == null ? null : +String(n.valeur).replace(',', '.');
      if (raw != null && !(raw >= 0 && raw <= ev.bareme)) return bad(res, `Note invalide (entre 0 et ${ev.bareme})`);
      rows.push({ uid, valeur: code ? null : raw, code, appreciation: text(n.appreciation, 500) });
    }
    db.exec('BEGIN');
    try {
      for (const r of rows) {
        if (r.valeur == null && !r.code && !r.appreciation) db.prepare('DELETE FROM notes WHERE eval_id = ? AND user_id = ?').run(ev.id, r.uid);
        else db.prepare(`INSERT INTO notes (eval_id, user_id, valeur, code, appreciation, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(eval_id, user_id) DO UPDATE SET valeur = excluded.valeur, code = excluded.code, appreciation = excluded.appreciation, updated_at = excluded.updated_at`)
          .run(ev.id, r.uid, r.valeur, r.code, r.appreciation, now());
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    let publiee = ev.publiee;
    if (req.body.publier && !ev.publiee) {
      db.prepare('UPDATE evaluations SET publiee = 1, updated_at = ? WHERE id = ?').run(now(), ev.id);
      publiee = 1;
      notifyPublished(get(ev.id));
    }
    res.json({ ok: true, publiee: !!publiee, stats: stats(ev) });
  });

  // Relevé de notes : moyennes /20 par matière (pondérées par les coefficients) et moyenne générale
  function releve(uid) {
    const u = cible.userById(uid);
    if (!u) return null;
    const rows = db.prepare(`SELECT e.*, n.valeur, n.code, n.appreciation FROM notes n JOIN evaluations e ON e.id = n.eval_id
      WHERE n.user_id = ? AND e.publiee = 1 ORDER BY e.date`).all(uid);
    const parMatiere = {};
    for (const r of rows) {
      const m = (parMatiere[r.matiere] ||= { matiere: r.matiere, notes: [], somme: 0, coefs: 0 });
      const v = sur20(r, r);
      m.notes.push({ id: r.id, titre: r.titre, date: r.date, valeur: r.valeur, code: r.code, bareme: r.bareme, coef: r.coef, sur20: round(v), appreciation: r.appreciation, classe: stats(r).moyenne ?? null });
      if (v != null && r.coef > 0) { m.somme += v * r.coef; m.coefs += r.coef; }
    }
    const matieres = Object.values(parMatiere).map(m => ({ matiere: m.matiere, notes: m.notes, moyenne: m.coefs ? round(m.somme / m.coefs) : null }))
      .sort((a, b) => a.matiere.localeCompare(b.matiere, 'fr'));
    const avec = matieres.filter(m => m.moyenne != null);
    return {
      eleve: { id: u.id, display_name: u.display_name },
      matieres, generale: avec.length ? round(avec.reduce((a, m) => a + m.moyenne, 0) / avec.length) : null,
    };
  }
  app.get('/api/releve', auth, (req, res) => {
    const uid = cible.isStaff(req.user) && req.query.user_id ? +req.query.user_id : req.user.id;
    if (!cible.isStaff(req.user) && uid !== req.user.id) return bad(res, 'Interdit', 403);
    const r = releve(uid);
    if (!r) return bad(res, 'Élève introuvable', 404);
    res.json({ ...r, codes: CODES });
  });

  const forgetUser = uid => db.prepare('DELETE FROM notes WHERE user_id = ?').run(uid);
  return { releve, forgetUser, CODES };
};
