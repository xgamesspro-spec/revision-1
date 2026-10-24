// Exercices publiés par les formateurs : consigne + fichiers + date limite (ajoutée au planning),
// rendus des élèves (texte + fichiers), correction avec note et commentaire.
module.exports = function setupExercises(app, { db, auth, bad, now, text, uploads, notifier, accounts }) {
  db.exec(`CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
    filiere TEXT, author_id INTEGER NOT NULL, due_at INTEGER, allow_submit INTEGER NOT NULL DEFAULT 1,
    event_id INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS exercise_done (
    ex_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, done_at INTEGER NOT NULL, PRIMARY KEY (ex_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ex_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, content TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    grade TEXT, feedback TEXT, graded_at INTEGER, graded_by INTEGER,
    UNIQUE (ex_id, user_id)
  );`);

  const isStaff = u => u && (u.role === 'admin' || u.role === 'prof');
  const staffOnly = (req, res, next) => isStaff(req.user) ? next() : bad(res, 'Réservé aux formateurs', 403);
  const visible = (u, ex) => !!ex && (isStaff(u) || !ex.filiere || ex.filiere === u.filiere);
  const canEdit = (u, ex) => u.role === 'admin' || ex.author_id === u.id;
  const getEx = id => db.prepare('SELECT * FROM exercises WHERE id = ?').get(+id);
  const nameOf = id => db.prepare('SELECT display_name FROM users WHERE id = ?').get(id)?.display_name || 'Ancien compte';
  const studentsOf = ex => db.prepare(`SELECT id, display_name, username FROM users WHERE role = 'eleve' AND deleted = 0 AND banned = 0
    ${ex.filiere ? 'AND filiere = ?' : ''} ORDER BY display_name`).all(...(ex.filiere ? [ex.filiere] : []));
  const atts = (target, id) => uploads.forTargets(target, [id])[id] || [];

  // Pour les droits d'accès aux pièces jointes (uploads.js)
  function canAccessAttachment(u, a) {
    if (a.target === 'exercise') return visible(u, getEx(a.target_id));
    if (a.target === 'submission') {
      const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(a.target_id);
      return !!s && (s.user_id === u.id || isStaff(u));
    }
    return false;
  }

  function parse(b, cur = {}) {
    const ex = { ...cur };
    if ('title' in b || !cur.id) ex.title = text(b.title, 120);
    if (!ex.title) throw new Error('Titre obligatoire');
    if ('subject' in b) ex.subject = text(b.subject, 60);
    if ('content' in b) ex.content = text(b.content, 20000);
    if ('filiere' in b || !cur.id) ex.filiere = accounts.FILIERES.some(f => f.id === b.filiere) ? b.filiere : null;
    if ('due_at' in b) {
      ex.due_at = b.due_at ? +b.due_at : null;
      if (ex.due_at != null && (!Number.isFinite(ex.due_at) || Math.abs(ex.due_at - now()) > 2 * 365 * 864e5)) throw new Error('Date limite invalide');
    }
    if ('allow_submit' in b || !cur.id) ex.allow_submit = b.allow_submit === false || b.allow_submit === 0 ? 0 : 1;
    return ex;
  }

  // La date limite apparaît dans le planning de la filière (type « Rendu »)
  function syncEvent(ex) {
    if (!ex.due_at) {
      if (ex.event_id) db.prepare('DELETE FROM events WHERE id = ?').run(ex.event_id);
      db.prepare('UPDATE exercises SET event_id = NULL WHERE id = ?').run(ex.id);
      return;
    }
    const vals = [`À rendre : ${ex.title}`, `Exercice à rendre${ex.subject ? ` (${ex.subject})` : ''} — voir #/exercices/${ex.id}`, ex.due_at,
      ex.filiere ? 'filiere' : 'cfa', ex.filiere];
    if (ex.event_id && db.prepare('SELECT 1 FROM events WHERE id = ?').get(ex.event_id)) {
      db.prepare('UPDATE events SET title = ?, description = ?, start_at = ?, visibility = ?, filiere = ? WHERE id = ?').run(...vals, ex.event_id);
      db.prepare('DELETE FROM event_reminders WHERE event_id = ?').run(ex.event_id);
    } else {
      const r = db.prepare(`INSERT INTO events (title, type, description, start_at, all_day, visibility, filiere, created_by, created_at)
        VALUES (?, 'rendu', ?, ?, 0, ?, ?, ?, ?)`).run(vals[0], vals[1], vals[2], vals[3], vals[4], ex.author_id, now());
      db.prepare('UPDATE exercises SET event_id = ? WHERE id = ?').run(r.lastInsertRowid, ex.id);
    }
  }

  const due = t => new Intl.DateTimeFormat('fr-FR', { timeZone: process.env.APP_TZ || 'America/Cayenne', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(t));

  app.get('/api/exercises', auth, (req, res) => {
    const u = req.user;
    const list = db.prepare('SELECT * FROM exercises ORDER BY COALESCE(due_at, created_at) DESC').all().filter(ex => visible(u, ex)).map(ex => {
      const base = {
        id: ex.id, title: ex.title, subject: ex.subject, filiere: ex.filiere, filiere_nom: accounts.filiereNom(ex.filiere),
        due_at: ex.due_at, allow_submit: !!ex.allow_submit, created_at: ex.created_at, author: nameOf(ex.author_id),
        files: atts('exercise', ex.id).length, can_edit: canEdit(u, ex),
      };
      if (isStaff(u)) {
        const subs = db.prepare('SELECT COUNT(*) AS n, COUNT(grade) AS g FROM submissions WHERE ex_id = ?').get(ex.id);
        return { ...base, students: studentsOf(ex).length, submitted: subs.n, graded: subs.g };
      }
      const s = db.prepare('SELECT id, grade, updated_at FROM submissions WHERE ex_id = ? AND user_id = ?').get(ex.id, u.id);
      const done = db.prepare('SELECT 1 FROM exercise_done WHERE ex_id = ? AND user_id = ?').get(ex.id, u.id);
      return { ...base, done: !!done || !!s, submitted: !!s, grade: s?.grade ?? null };
    });
    res.json({ items: list, staff: isStaff(u) });
  });

  app.get('/api/exercises/:id', auth, (req, res) => {
    const ex = getEx(req.params.id);
    if (!visible(req.user, ex)) return bad(res, 'Exercice introuvable', 404);
    const outEx = { ...ex, author: nameOf(ex.author_id), filiere_nom: accounts.filiereNom(ex.filiere), attachments: atts('exercise', ex.id), can_edit: canEdit(req.user, ex) };
    const sub = s => s && ({ ...s, student: nameOf(s.user_id), late: !!(ex.due_at && s.created_at > ex.due_at), attachments: atts('submission', s.id) });
    if (isStaff(req.user)) {
      const subs = db.prepare('SELECT * FROM submissions WHERE ex_id = ? ORDER BY created_at').all(ex.id).map(sub);
      const doneIds = new Set(subs.map(s => s.user_id));
      const missing = studentsOf(ex).filter(s => !doneIds.has(s.id));
      return res.json({ exercise: outEx, submissions: subs, missing, staff: true });
    }
    const mine = sub(db.prepare('SELECT * FROM submissions WHERE ex_id = ? AND user_id = ?').get(ex.id, req.user.id));
    const done = !!db.prepare('SELECT 1 FROM exercise_done WHERE ex_id = ? AND user_id = ?').get(ex.id, req.user.id);
    res.json({ exercise: outEx, mine, done: done || !!mine, staff: false });
  });

  app.post('/api/exercises', auth, staffOnly, (req, res) => {
    let ex;
    try { ex = parse(req.body); uploads.check(req.user, req.body.attachments); } catch (e) { return bad(res, e.message); }
    const r = db.prepare(`INSERT INTO exercises (title, subject, content, filiere, author_id, due_at, allow_submit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ex.title, ex.subject || '', ex.content || '', ex.filiere, req.user.id, ex.due_at ?? null, ex.allow_submit, now(), now());
    const created = getEx(r.lastInsertRowid);
    uploads.link(req.user, req.body.attachments, 'exercise', created.id, null);
    syncEvent(created);
    for (const s of studentsOf(created)) {
      notifier.notify(s.id, {
        type: 'exercice', link: `#/exercices/${created.id}`,
        title: `📝 Nouvel exercice : ${created.title}`,
        body: `${req.user.display_name}${created.due_at ? ` — à rendre ${due(created.due_at)}` : ''}`,
      });
    }
    res.json({ id: created.id });
  });

  app.patch('/api/exercises/:id', auth, staffOnly, (req, res) => {
    const cur = getEx(req.params.id);
    if (!cur) return bad(res, 'Exercice introuvable', 404);
    if (!canEdit(req.user, cur)) return bad(res, 'Seul son auteur ou un modérateur peut le modifier', 403);
    let ex;
    try { ex = parse(req.body, cur); uploads.check(req.user, req.body.attachments); } catch (e) { return bad(res, e.message); }
    db.prepare('UPDATE exercises SET title = ?, subject = ?, content = ?, filiere = ?, due_at = ?, allow_submit = ?, updated_at = ? WHERE id = ?')
      .run(ex.title, ex.subject, ex.content, ex.filiere, ex.due_at ?? null, ex.allow_submit, now(), cur.id);
    uploads.link(req.user, req.body.attachments, 'exercise', cur.id, null);
    syncEvent(getEx(cur.id));
    res.json({ ok: true });
  });

  app.delete('/api/exercises/:id', auth, staffOnly, (req, res) => {
    const ex = getEx(req.params.id);
    if (!ex) return bad(res, 'Exercice introuvable', 404);
    if (!canEdit(req.user, ex)) return bad(res, 'Seul son auteur ou un modérateur peut le supprimer', 403);
    const subIds = db.prepare('SELECT id FROM submissions WHERE ex_id = ?').all(ex.id).map(s => s.id);
    uploads.removeFor('submission', subIds);
    uploads.removeFor('exercise', [ex.id]);
    if (ex.event_id) db.prepare('DELETE FROM events WHERE id = ?').run(ex.event_id);
    db.prepare('DELETE FROM exercises WHERE id = ?').run(ex.id);
    res.json({ ok: true });
  });

  app.post('/api/exercises/:id/done', auth, (req, res) => {
    const ex = getEx(req.params.id);
    if (!visible(req.user, ex)) return bad(res, 'Exercice introuvable', 404);
    if (req.body.done) db.prepare('INSERT OR IGNORE INTO exercise_done (ex_id, user_id, done_at) VALUES (?, ?, ?)').run(ex.id, req.user.id, now());
    else db.prepare('DELETE FROM exercise_done WHERE ex_id = ? AND user_id = ?').run(ex.id, req.user.id);
    res.json({ ok: true });
  });

  // Rendu d'un élève (modifiable tant qu'il n'est pas corrigé)
  app.post('/api/exercises/:id/submit', auth, (req, res) => {
    const ex = getEx(req.params.id);
    if (!visible(req.user, ex)) return bad(res, 'Exercice introuvable', 404);
    if (req.user.role !== 'eleve') return bad(res, 'Seuls les élèves rendent un travail', 403);
    if (!ex.allow_submit) return bad(res, 'Pas de rendu en ligne pour cet exercice');
    const content = text(req.body.content, 20000);
    let n;
    try { n = uploads.check(req.user, req.body.attachments); } catch (e) { return bad(res, e.message); }
    const cur = db.prepare('SELECT * FROM submissions WHERE ex_id = ? AND user_id = ?').get(ex.id, req.user.id);
    if (cur?.grade != null) return bad(res, 'Ton travail est déjà corrigé');
    if (!content && !n && !cur) return bad(res, 'Ajoute un texte ou un fichier');
    let id = cur?.id;
    if (cur) db.prepare('UPDATE submissions SET content = ?, updated_at = ? WHERE id = ?').run(content || cur.content, now(), cur.id);
    else id = db.prepare('INSERT INTO submissions (ex_id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(ex.id, req.user.id, content, now(), now()).lastInsertRowid;
    uploads.link(req.user, req.body.attachments, 'submission', id, null);
    if (!cur) {
      notifier.notify(ex.author_id, {
        type: 'exercice', link: `#/exercices/${ex.id}`,
        title: `📥 Rendu reçu : ${ex.title}`,
        body: `${req.user.display_name}${ex.due_at && now() > ex.due_at ? ' (en retard)' : ''}`,
      });
    }
    res.json({ id });
  });

  app.post('/api/submissions/:id/grade', auth, staffOnly, (req, res) => {
    const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(+req.params.id);
    if (!s) return bad(res, 'Rendu introuvable', 404);
    const ex = getEx(s.ex_id);
    const grade = text(req.body.grade, 20);
    const feedback = text(req.body.feedback, 5000);
    if (!grade && !feedback) return bad(res, 'Mets une note ou un commentaire');
    db.prepare('UPDATE submissions SET grade = ?, feedback = ?, graded_at = ?, graded_by = ? WHERE id = ?').run(grade || '—', feedback, now(), req.user.id, s.id);
    notifier.notify(s.user_id, {
      type: 'exercice', link: `#/exercices/${ex.id}`,
      title: `✅ Exercice corrigé : ${ex.title}`,
      body: `${grade ? `Note : ${grade}. ` : ''}${feedback.slice(0, 120)}`,
    });
    res.json({ ok: true });
  });

  // Rendus et exercices d'un compte supprimé (RGPD) : on efface les rendus de l'élève
  function forgetUser(uid) {
    const ids = db.prepare('SELECT id FROM submissions WHERE user_id = ?').all(uid).map(s => s.id);
    uploads.removeFor('submission', ids);
    db.prepare('DELETE FROM submissions WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM exercise_done WHERE user_id = ?').run(uid);
  }

  function pendingFor(u, limit = 5) {
    if (u.role !== 'eleve') return [];
    return db.prepare('SELECT * FROM exercises WHERE due_at IS NULL OR due_at > ? ORDER BY COALESCE(due_at, 9e15)').all(now() - 864e5)
      .filter(ex => visible(u, ex))
      .filter(ex => !db.prepare('SELECT 1 FROM submissions WHERE ex_id = ? AND user_id = ?').get(ex.id, u.id)
        && !db.prepare('SELECT 1 FROM exercise_done WHERE ex_id = ? AND user_id = ?').get(ex.id, u.id))
      .slice(0, limit).map(ex => ({ id: ex.id, title: ex.title, subject: ex.subject, due_at: ex.due_at }));
  }

  return { canAccessAttachment, forgetUser, pendingFor, isStaff };
};
