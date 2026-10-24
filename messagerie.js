// Messagerie privée formateurs ↔ élèves (comme les « Discussions » de Pronote).
// Séparée des salons : chaque discussion contient au moins un formateur ou un modérateur,
// donc pas de discussion privée entre élèves ici (ils ont leurs salons), et les formateurs
// ne voient que les discussions dont ils font partie.
module.exports = function setupMessagerie(app, { db, auth, bad, now, text, notifier, cible, liveTo }) {
  db.exec(`CREATE TABLE IF NOT EXISTS convs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sujet TEXT NOT NULL, created_by INTEGER NOT NULL, reponses INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, last_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conv_members (
    conv_id INTEGER NOT NULL REFERENCES convs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, last_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (conv_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS conv_msgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_id INTEGER NOT NULL REFERENCES convs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conv_msgs ON conv_msgs(conv_id, id);`);

  const members = cid => db.prepare('SELECT user_id FROM conv_members WHERE conv_id = ?').all(cid).map(m => m.user_id);
  const isMember = (cid, uid) => !!db.prepare('SELECT 1 FROM conv_members WHERE conv_id = ? AND user_id = ?').get(cid, uid);
  const getConv = id => db.prepare('SELECT * FROM convs WHERE id = ?').get(+id);
  const roleNom = r => ({ admin: 'Modérateur', prof: 'Formateur', eleve: 'Élève' }[r] || '');
  // Messages qu'une personne a le droit de lire : tout pour un formateur ; pour un élève, les siens et ceux des formateurs
  const visibleSql = `(? != 'eleve' OR m.user_id = ? OR m.user_id IN (SELECT id FROM users WHERE role != 'eleve'))`;
  const roleOf = uid => db.prepare('SELECT role FROM users WHERE id = ?').get(uid)?.role || 'eleve';
  const unread = (cid, uid) => db.prepare(`SELECT COUNT(*) AS n FROM conv_msgs m WHERE m.conv_id = ? AND m.user_id != ?
    AND m.id > (SELECT last_read FROM conv_members WHERE conv_id = ? AND user_id = ?) AND ${visibleSql}`).get(cid, uid, cid, uid, roleOf(uid), uid).n;
  const ping = (cid, data = {}) => { const ids = new Set(members(cid)); liveTo(u => ids.has(u.id), 'convs', { id: cid, ...data }); };

  // Qui peut-on contacter ? Un élève : les formateurs et modérateurs. Un formateur : tout le monde.
  app.get('/api/contacts', auth, (req, res) => {
    const staff = cible.isStaff(req.user);
    const rows = db.prepare(`SELECT id, display_name, role, filiere, formation FROM users WHERE deleted = 0 AND banned = 0 AND id != ?
      ${staff ? '' : "AND role IN ('prof', 'admin')"} ORDER BY role != 'eleve', display_name`).all(req.user.id);
    res.json(rows.map(u => ({ ...u, role_nom: roleNom(u.role), cible: u.role === 'eleve' ? cible.label(u) : null })));
  });

  app.get('/api/convs', auth, (req, res) => {
    const rows = db.prepare(`SELECT c.* FROM convs c JOIN conv_members m ON m.conv_id = c.id WHERE m.user_id = ? ORDER BY c.last_at DESC LIMIT 200`).all(req.user.id);
    res.json(rows.map(c => {
      const last = db.prepare(`SELECT m.user_id, m.content, m.created_at FROM conv_msgs m WHERE m.conv_id = ? AND ${visibleSql} ORDER BY m.id DESC LIMIT 1`).get(c.id, req.user.role, req.user.id);
      const others = members(c.id).filter(id => id !== req.user.id && (req.user.role !== 'eleve' || roleOf(id) !== 'eleve'));
      return { id: c.id, sujet: c.sujet, last_at: c.last_at, reponses: !!c.reponses, unread: unread(c.id, req.user.id),
        avec: others.slice(0, 4).map(cible.nameOf), nb: others.length,
        dernier: last ? { auteur: last.user_id === req.user.id ? 'Toi' : cible.nameOf(last.user_id), extrait: last.content.slice(0, 90), at: last.created_at } : null };
    }));
  });

  // Nouvelle discussion : destinataires choisis, ou toute une classe (formateurs seulement)
  app.post('/api/convs', auth, (req, res) => {
    const u = req.user, staff = cible.isStaff(u);
    const sujet = text(req.body.sujet, 120), content = text(req.body.message, 5000);
    if (!sujet || !content) return bad(res, 'Mets un sujet et un message');
    let ids = [...new Set((Array.isArray(req.body.to) ? req.body.to : []).map(Number))].filter(id => id && id !== u.id);
    if (staff && req.body.classe) {
      let t;
      try { t = cible.parse(req.body.classe); } catch (e) { return bad(res, e.message); }
      ids = [...new Set([...ids, ...cible.students(t).map(s => s.id)])];
    }
    if (!ids.length) return bad(res, 'Choisis au moins un destinataire');
    if (ids.length > 300) return bad(res, 'Trop de destinataires');
    const dest = ids.map(id => cible.userById(id));
    if (dest.some(d => !d || d.banned)) return bad(res, 'Destinataire introuvable');
    if (!staff && dest.some(d => d.role === 'eleve')) return bad(res, 'Pour parler entre élèves, utilise les salons 😉', 403);
    const reponses = staff ? (req.body.reponses === false ? 0 : 1) : 1;
    const cid = db.prepare('INSERT INTO convs (sujet, created_by, reponses, created_at, last_at) VALUES (?, ?, ?, ?, ?)').run(sujet, u.id, reponses, now(), now()).lastInsertRowid;
    const add = db.prepare('INSERT OR IGNORE INTO conv_members (conv_id, user_id, last_read) VALUES (?, ?, 0)');
    [u.id, ...ids].forEach(id => add.run(cid, id));
    const mid = db.prepare('INSERT INTO conv_msgs (conv_id, user_id, content, created_at) VALUES (?, ?, ?, ?)').run(cid, u.id, content, now()).lastInsertRowid;
    db.prepare('UPDATE conv_members SET last_read = ? WHERE conv_id = ? AND user_id = ?').run(mid, cid, u.id);
    for (const id of ids) notifier.notify(id, { type: 'message', link: `#/messages/${cid}`, title: `✉️ ${u.display_name} : ${sujet}`, body: content.slice(0, 140) });
    ping(cid);
    res.json({ id: cid });
  });

  app.get('/api/convs/:id', auth, (req, res) => {
    const c = getConv(req.params.id);
    if (!c || !isMember(c.id, req.user.id)) return bad(res, 'Discussion introuvable', 404);
    const all = db.prepare('SELECT * FROM conv_msgs WHERE conv_id = ? ORDER BY id').all(c.id);
    if (all.length) db.prepare('UPDATE conv_members SET last_read = ? WHERE conv_id = ? AND user_id = ?').run(all.at(-1).id, c.id, req.user.id);
    let people = db.prepare(`SELECT u.id, u.display_name, u.role FROM conv_members m JOIN users u ON u.id = m.user_id WHERE m.conv_id = ? ORDER BY u.role != 'eleve', u.display_name`).all(c.id);
    // Un élève ne voit que les messages des formateurs et les siens (pas ceux des autres élèves du groupe)
    const eleve = req.user.role === 'eleve';
    const staffIds = new Set(people.filter(p => p.role !== 'eleve').map(p => p.id));
    const msgs = eleve ? all.filter(m => m.user_id === req.user.id || staffIds.has(m.user_id) || cible.isStaff(cible.userById(m.user_id))) : all;
    const autresEleves = eleve ? people.filter(p => p.role === 'eleve' && p.id !== req.user.id).length : 0;
    if (eleve) people = people.filter(p => p.role !== 'eleve' || p.id === req.user.id);
    const canReply = c.reponses || cible.isStaff(req.user);
    res.json({
      id: c.id, sujet: c.sujet, reponses: !!c.reponses, can_reply: !!canReply, created_by: cible.nameOf(c.created_by),
      membres: people.map(p => ({ ...p, role_nom: roleNom(p.role) })), autres_eleves: autresEleves,
      messages: msgs.map(m => ({ id: m.id, content: m.content, at: m.created_at, mine: m.user_id === req.user.id, auteur: cible.nameOf(m.user_id) })),
    });
  });

  app.post('/api/convs/:id/messages', auth, (req, res) => {
    const c = getConv(req.params.id);
    if (!c || !isMember(c.id, req.user.id)) return bad(res, 'Discussion introuvable', 404);
    if (!c.reponses && !cible.isStaff(req.user)) return bad(res, 'Les réponses sont fermées pour ce message d’information', 403);
    const content = text(req.body.content, 5000);
    if (!content) return bad(res, 'Message vide');
    const mid = db.prepare('INSERT INTO conv_msgs (conv_id, user_id, content, created_at) VALUES (?, ?, ?, ?)').run(c.id, req.user.id, content, now()).lastInsertRowid;
    db.prepare('UPDATE convs SET last_at = ? WHERE id = ?').run(now(), c.id);
    db.prepare('UPDATE conv_members SET last_read = ? WHERE conv_id = ? AND user_id = ?').run(mid, c.id, req.user.id);
    // Dans un message envoyé à toute une classe, la réponse d'un élève ne part qu'aux formateurs
    const targets = members(c.id).filter(id => id !== req.user.id);
    const recipients = req.user.role === 'eleve' ? targets.filter(id => cible.isStaff(cible.userById(id))) : targets;
    for (const id of recipients) notifier.notify(id, { type: 'message', link: `#/messages/${c.id}`, title: `✉️ ${req.user.display_name} : ${c.sujet}`, body: content.slice(0, 140) });
    ping(c.id);
    res.json({ id: mid });
  });

  // Quitter une discussion (elle disparaît de ta liste)
  app.post('/api/convs/:id/leave', auth, (req, res) => {
    const c = getConv(req.params.id);
    if (!c || !isMember(c.id, req.user.id)) return bad(res, 'Discussion introuvable', 404);
    db.prepare('DELETE FROM conv_members WHERE conv_id = ? AND user_id = ?').run(c.id, req.user.id);
    if (!members(c.id).length) db.prepare('DELETE FROM convs WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  const unreadTotal = uid => db.prepare('SELECT conv_id FROM conv_members WHERE user_id = ?').all(uid).reduce((n, m) => n + unread(m.conv_id, uid), 0);
  app.get('/api/convs-unread', auth, (req, res) => res.json({ unread: unreadTotal(req.user.id) }));

  function forgetUser(uid) {
    db.prepare('DELETE FROM conv_members WHERE user_id = ?').run(uid);
    db.prepare("UPDATE conv_msgs SET content = '(message supprimé)' WHERE user_id = ?").run(uid);
    db.prepare('DELETE FROM convs WHERE id NOT IN (SELECT conv_id FROM conv_members)').run();
  }
  return { unreadTotal, forgetUser };
};
