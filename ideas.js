// Boîtes à idées : une pour les élèves, une pour les formateurs (séparées).
// Chacun propose, vote ; les modérateurs voient les deux, répondent et changent le statut.
const STATUSES = {
  nouvelle: '🆕 Nouvelle', etudiee: '🔍 À l’étude', prevue: '📅 Prévue', faite: '✅ Faite', refusee: '❌ Pas retenue',
};
const CATEGORIES = ['Révisions', 'Discussions & forum', 'Réunions', 'Planning', 'Exercices', 'Notifications', 'Apparence', 'Autre'];

module.exports = function setupIdeas(app, { db, auth, admin, bad, now, text, conns, notifier }) {
  db.exec(`CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, box TEXT NOT NULL, user_id INTEGER NOT NULL,
    title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Autre',
    anonymous INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'nouvelle', admin_reply TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS idea_votes (idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, PRIMARY KEY (idea_id, user_id));`);

  // Boîte de chacun : élèves → « eleves », formateurs → « profs », modérateurs → les deux
  const boxOf = u => (u.role === 'prof' ? 'profs' : 'eleves');
  const canSeeBox = (u, box) => u.role === 'admin' || boxOf(u) === box;
  const boxFor = (u, wanted) => (u.role === 'admin' && ['eleves', 'profs'].includes(wanted) ? wanted : boxOf(u));
  const get = id => db.prepare('SELECT * FROM ideas WHERE id = ?').get(+id);

  function live(box) {
    const payload = `event: ideas\ndata: ${JSON.stringify({ box })}\n\n`;
    for (const c of conns.values()) if (canSeeBox(c.user, box)) c.res.write(payload);
  }
  function out(u, i) {
    const votes = db.prepare('SELECT COUNT(*) AS n FROM idea_votes WHERE idea_id = ?').get(i.id).n;
    const voted = !!db.prepare('SELECT 1 FROM idea_votes WHERE idea_id = ? AND user_id = ?').get(i.id, u.id);
    const name = db.prepare('SELECT display_name FROM users WHERE id = ?').get(i.user_id)?.display_name || 'Ancien compte';
    const mine = i.user_id === u.id;
    return {
      id: i.id, box: i.box, title: i.title, content: i.content, category: i.category, status: i.status, status_nom: STATUSES[i.status],
      admin_reply: i.admin_reply, created_at: i.created_at, updated_at: i.updated_at, votes, voted, mine,
      anonymous: !!i.anonymous, author: i.anonymous && u.role !== 'admin' && !mine ? 'Anonyme' : name,
      can_edit: mine && i.status === 'nouvelle', can_delete: u.role === 'admin' || (mine && i.status === 'nouvelle'),
    };
  }

  app.get('/api/ideas', auth, (req, res) => {
    const box = boxFor(req.user, req.query.box);
    let list = db.prepare('SELECT * FROM ideas WHERE box = ?').all(box).map(i => out(req.user, i));
    if (STATUSES[req.query.status]) list = list.filter(i => i.status === req.query.status);
    if (req.query.mine === '1') list = list.filter(i => i.mine);
    list.sort(req.query.sort === 'new' ? (a, b) => b.created_at - a.created_at : (a, b) => b.votes - a.votes || b.created_at - a.created_at);
    const counts = Object.fromEntries(Object.keys(STATUSES).map(s => [s, db.prepare('SELECT COUNT(*) AS n FROM ideas WHERE box = ? AND status = ?').get(box, s).n]));
    res.json({ box, boxes: req.user.role === 'admin' ? ['eleves', 'profs'] : [box], items: list, statuses: STATUSES, categories: CATEGORIES, counts });
  });

  app.post('/api/ideas', auth, (req, res) => {
    const title = text(req.body.title, 120), content = text(req.body.content, 3000);
    if (title.length < 4) return bad(res, 'Donne un titre un peu plus précis');
    const recent = db.prepare('SELECT COUNT(*) AS n FROM ideas WHERE user_id = ? AND created_at > ?').get(req.user.id, now() - 864e5).n;
    if (recent >= 10) return bad(res, '10 idées par jour maximum', 429);
    const box = boxFor(req.user, req.body.box);
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Autre';
    const r = db.prepare('INSERT INTO ideas (box, user_id, title, content, category, anonymous, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(box, req.user.id, title, content, category, req.body.anonymous ? 1 : 0, now(), now());
    db.prepare('INSERT OR IGNORE INTO idea_votes (idea_id, user_id) VALUES (?, ?)').run(r.lastInsertRowid, req.user.id); // on soutient sa propre idée
    live(box);
    res.json({ id: r.lastInsertRowid });
  });

  app.post('/api/ideas/:id/vote', auth, (req, res) => {
    const i = get(req.params.id);
    if (!i || !canSeeBox(req.user, i.box)) return bad(res, 'Idée introuvable', 404);
    const had = db.prepare('SELECT 1 FROM idea_votes WHERE idea_id = ? AND user_id = ?').get(i.id, req.user.id);
    if (had) db.prepare('DELETE FROM idea_votes WHERE idea_id = ? AND user_id = ?').run(i.id, req.user.id);
    else db.prepare('INSERT INTO idea_votes (idea_id, user_id) VALUES (?, ?)').run(i.id, req.user.id);
    live(i.box);
    res.json(out(req.user, i));
  });

  app.patch('/api/ideas/:id', auth, (req, res) => {
    const i = get(req.params.id);
    if (!i || !canSeeBox(req.user, i.box)) return bad(res, 'Idée introuvable', 404);
    const isAdmin = req.user.role === 'admin';
    if (isAdmin && (req.body.status || 'admin_reply' in req.body)) {
      const status = STATUSES[req.body.status] ? req.body.status : i.status;
      const reply = 'admin_reply' in req.body ? text(req.body.admin_reply, 2000) : i.admin_reply;
      db.prepare('UPDATE ideas SET status = ?, admin_reply = ?, updated_at = ? WHERE id = ?').run(status, reply, now(), i.id);
      if (i.user_id !== req.user.id && (status !== i.status || reply !== i.admin_reply)) {
        notifier.notify(i.user_id, {
          type: 'idee', link: '#/idees',
          title: `💡 Ton idée « ${i.title} » : ${STATUSES[status]}`,
          body: reply ? reply.slice(0, 140) : 'Merci pour ta proposition !',
        });
      }
    } else {
      if (i.user_id !== req.user.id || i.status !== 'nouvelle') return bad(res, 'Tu ne peux plus modifier cette idée', 403);
      const title = text(req.body.title ?? i.title, 120), content = text(req.body.content ?? i.content, 3000);
      if (title.length < 4) return bad(res, 'Titre trop court');
      const category = CATEGORIES.includes(req.body.category) ? req.body.category : i.category;
      db.prepare('UPDATE ideas SET title = ?, content = ?, category = ?, updated_at = ? WHERE id = ?').run(title, content, category, now(), i.id);
    }
    live(i.box);
    res.json(out(req.user, get(i.id)));
  });

  app.delete('/api/ideas/:id', auth, (req, res) => {
    const i = get(req.params.id);
    if (!i || !canSeeBox(req.user, i.box)) return bad(res, 'Idée introuvable', 404);
    if (!(req.user.role === 'admin' || (i.user_id === req.user.id && i.status === 'nouvelle'))) return bad(res, 'Interdit', 403);
    db.prepare('DELETE FROM ideas WHERE id = ?').run(i.id);
    live(i.box);
    res.json({ ok: true });
  });

  // Compte supprimé : ses idées restent (anonymisées par le nom « Ancien élève »), ses votes partent
  function forgetUser(uid) { db.prepare('DELETE FROM idea_votes WHERE user_id = ?').run(uid); }
  return { forgetUser, STATUSES };
};
