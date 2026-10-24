// Discussions vivantes : réactions emoji, réponses à un message, modification, « … est en train d'écrire ».
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '✅', '🙏', '👀'];

module.exports = function setupSocial(app, { db, auth, bad, now, text, channelFor, broadcastChannel, conns, notifier }) {
  const mcols = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
  if (!mcols.includes('reply_to')) db.exec('ALTER TABLE messages ADD COLUMN reply_to INTEGER');
  if (!mcols.includes('edited_at')) db.exec('ALTER TABLE messages ADD COLUMN edited_at INTEGER');
  if (!db.prepare('PRAGMA table_info(replies)').all().some(c => c.name === 'edited_at')) db.exec('ALTER TABLE replies ADD COLUMN edited_at INTEGER');
  db.exec(`CREATE TABLE IF NOT EXISTS reactions (
    target TEXT NOT NULL, target_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (target, target_id, user_id, emoji)
  );
  CREATE INDEX IF NOT EXISTS idx_react_target ON reactions(target, target_id);`);

  // Salon auquel appartient une cible (message, sujet ou réponse), en vérifiant l'accès
  function locate(user, target, id) {
    if (target === 'message') {
      const m = db.prepare('SELECT * FROM messages WHERE id = ? AND deleted = 0').get(+id);
      const ch = m && channelFor(user, m.channel_id);
      return ch ? { ch, owner: m.user_id, item: m } : null;
    }
    if (target === 'topic') {
      const t = db.prepare('SELECT * FROM topics WHERE id = ?').get(+id);
      const ch = t && channelFor(user, t.channel_id);
      return ch ? { ch, owner: t.user_id, item: t, topicId: t.id } : null;
    }
    if (target === 'reply') {
      const r = db.prepare('SELECT r.*, t.channel_id FROM replies r JOIN topics t ON t.id = r.topic_id WHERE r.id = ?').get(+id);
      const ch = r && channelFor(user, r.channel_id);
      return ch ? { ch, owner: r.user_id, item: r, topicId: r.topic_id } : null;
    }
    return null;
  }

  function reactionsFor(target, ids) {
    const out = {};
    if (!ids.length) return out;
    const rows = db.prepare(`SELECT r.target_id, r.emoji, r.user_id, u.display_name FROM reactions r JOIN users u ON u.id = r.user_id
      WHERE r.target = ? AND r.target_id IN (${ids.map(() => '?').join(',')}) ORDER BY r.created_at`).all(target, ...ids);
    for (const r of rows) {
      const list = (out[r.target_id] ||= []);
      let e = list.find(x => x.emoji === r.emoji);
      if (!e) list.push(e = { emoji: r.emoji, users: [], names: [] });
      e.users.push(r.user_id); e.names.push(r.display_name);
    }
    return out;
  }

  // Ajoute réactions + aperçu du message cité à une liste de messages
  function decorate(rows, target = 'message') {
    const map = reactionsFor(target, rows.map(r => r.id));
    for (const r of rows) {
      r.reactions = map[r.id] || [];
      if (target === 'message' && r.reply_to) {
        const q = db.prepare('SELECT m.id, m.content, m.deleted, u.display_name FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(r.reply_to);
        r.reply = q ? { id: q.id, display_name: q.display_name, content: q.deleted ? '' : String(q.content).slice(0, 140), deleted: !!q.deleted } : null;
      }
    }
    return rows;
  }

  app.get('/api/reactions/emojis', auth, (req, res) => res.json(EMOJIS));

  app.post('/api/react', auth, (req, res) => {
    const { target } = req.body;
    const emoji = String(req.body.emoji || '');
    if (!EMOJIS.includes(emoji)) return bad(res, 'Réaction inconnue');
    const loc = locate(req.user, target, req.body.id);
    if (!loc) return bad(res, 'Introuvable', 404);
    const id = +req.body.id;
    const had = db.prepare('SELECT 1 FROM reactions WHERE target = ? AND target_id = ? AND user_id = ? AND emoji = ?').get(target, id, req.user.id, emoji);
    if (had) db.prepare('DELETE FROM reactions WHERE target = ? AND target_id = ? AND user_id = ? AND emoji = ?').run(target, id, req.user.id, emoji);
    else {
      const n = db.prepare('SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE target = ? AND target_id = ?').get(target, id).n;
      if (n >= 10) return bad(res, 'Trop de réactions différentes sur ce message');
      db.prepare('INSERT INTO reactions (target, target_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)').run(target, id, req.user.id, emoji, now());
    }
    const reactions = reactionsFor(target, [id])[id] || [];
    broadcastChannel(loc.ch, 'reaction', { target, id, channel_id: loc.ch.id, topic_id: loc.topicId || null, reactions });
    res.json({ reactions, added: !had });
  });

  // Modifier son propre message (salon) ou sa réponse (forum)
  app.patch('/api/messages/:id', auth, (req, res) => {
    const loc = locate(req.user, 'message', req.params.id);
    if (!loc) return bad(res, 'Introuvable', 404);
    if (loc.owner !== req.user.id) return bad(res, 'Tu ne peux modifier que tes messages', 403);
    const content = text(req.body.content, 2000);
    if (!content) return bad(res, 'Message vide');
    db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(content, now(), loc.item.id);
    broadcastChannel(loc.ch, 'message_edited', { id: loc.item.id, channel_id: loc.ch.id, content, edited_at: now() });
    res.json({ ok: true });
  });
  app.patch('/api/replies/:id', auth, (req, res) => {
    const loc = locate(req.user, 'reply', req.params.id);
    if (!loc) return bad(res, 'Introuvable', 404);
    if (loc.owner !== req.user.id) return bad(res, 'Tu ne peux modifier que tes réponses', 403);
    const content = text(req.body.content, 8000);
    if (!content) return bad(res, 'Réponse vide');
    db.prepare('UPDATE replies SET content = ?, edited_at = ? WHERE id = ?').run(content, now(), loc.item.id);
    broadcastChannel(loc.ch, 'topic', { channel_id: loc.ch.id, topic_id: loc.topicId });
    res.json({ ok: true });
  });

  // « … est en train d'écrire » : diffusé aux autres personnes du salon, limité à 1 fois / 2 s par personne
  const lastTyping = new Map();
  app.post('/api/channels/:id/typing', auth, (req, res) => {
    const ch = channelFor(req.user, req.params.id, 'chat');
    if (!ch) return bad(res, 'Salon introuvable', 404);
    const key = `${req.user.id}:${ch.id}`;
    if (now() - (lastTyping.get(key) || 0) > 2000) {
      lastTyping.set(key, now());
      const payload = `event: typing\ndata: ${JSON.stringify({ channel_id: ch.id, user_id: req.user.id, display_name: req.user.display_name })}\n\n`;
      for (const c of conns.values()) if (c.user.id !== req.user.id && channelFor(c.user, ch.id)) c.res.write(payload);
    }
    res.json({ ok: true });
  });
  setInterval(() => { for (const [k, t] of lastTyping) if (now() - t > 60e3) lastTyping.delete(k); }, 60e3).unref();

  // Réponse à un message : on vérifie qu'il est dans le même salon, et on prévient son auteur
  function checkReplyTo(user, chId, replyTo) {
    if (!replyTo) return null;
    const m = db.prepare('SELECT * FROM messages WHERE id = ? AND channel_id = ? AND deleted = 0').get(+replyTo, chId);
    if (!m) throw new Error('Le message auquel tu réponds n’existe plus');
    return m;
  }
  function notifyReply(author, original, ch, content) {
    if (!original || original.user_id === author.id) return;
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(original.user_id);
    if (!u || !channelFor(u, ch.id)) return;
    notifier.notify(u.id, {
      type: 'reply', link: `#/salon/${ch.id}`,
      title: `${author.display_name} a répondu à ton message dans #${ch.name}`,
      body: String(content || '📎 pièce jointe').replace(/\s+/g, ' ').slice(0, 140),
    });
  }

  function forgetUser(uid) { db.prepare('DELETE FROM reactions WHERE user_id = ?').run(uid); }
  function removeFor(target, ids) {
    if (ids.length) db.prepare(`DELETE FROM reactions WHERE target = ? AND target_id IN (${ids.map(() => '?').join(',')})`).run(target, ...ids);
  }

  return { decorate, reactionsFor, checkReplyTo, notifyReply, forgetUser, removeFor, EMOJIS };
};
