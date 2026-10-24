// Réunions vidéo (type Teams) : salles en mémoire + signalisation WebRTC.
// La vidéo/le son passent directement entre les navigateurs (maillage pair-à-pair) ;
// le serveur ne fait que mettre les participants en relation.
const crypto = require('crypto');

const MAX_PEERS = +(process.env.MEETING_MAX || 10);
const REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '😮', '❓'];

function buildIceServers() {
  if (process.env.ICE_SERVERS) {
    try { return JSON.parse(process.env.ICE_SERVERS); } catch { console.warn('ICE_SERVERS invalide, valeurs par défaut utilisées'); }
  }
  const list = [{ urls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302').split(',') }];
  if (process.env.TURN_URL) {
    list.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  }
  return list;
}

module.exports = function setupMeetings(app, { auth, conns, broadcast, sendTo, text, bad }) {
  const rooms = new Map();
  const iceServers = buildIceServers();

  const summary = r => ({
    id: r.id, name: r.name, created_by: r.created_by, creator_name: r.creator_name, created_at: r.created_at,
    count: r.peers.size, people: [...r.peers.values()].map(p => p.display_name),
  });
  const list = () => [...rooms.values()].sort((a, b) => b.created_at - a.created_at).map(summary);
  const pushList = () => broadcast('meetings', list());
  const toRoom = (room, event, data, except) => {
    for (const p of room.peers.values()) if (p.connId !== except) sendTo(p.connId, event, data);
  };
  const cleanState = s => ({ mic: !!s?.mic, cam: !!s?.cam, screen: !!s?.screen, hand: !!s?.hand });

  function leave(room, connId) {
    if (!room.peers.delete(connId)) return;
    toRoom(room, 'rtc_left', { room: room.id, connId });
    if (room.peers.size === 0) room.emptySince = Date.now();
    pushList();
  }

  // Vérifie que la connexion temps réel appartient bien à l'utilisateur, et (option) qu'il est dans la salle
  function ctx(req, res, mustBeIn = true) {
    const room = rooms.get(req.params.id);
    if (!room) { bad(res, 'Réunion terminée ou introuvable', 404); return null; }
    const connId = String(req.body?.connId || '');
    const conn = conns.get(connId);
    if (!conn || conn.user.id !== req.user.id) { bad(res, 'Connexion temps réel absente, recharge la page', 400); return null; }
    const peer = room.peers.get(connId);
    if (mustBeIn && !peer) { bad(res, "Tu n'es pas dans cette réunion", 403); return null; }
    return { room, connId, conn, peer };
  }

  app.get('/api/meetings', auth, (req, res) => res.json(list()));
  app.get('/api/meetings/config', auth, (req, res) => res.json({ iceServers, max: MAX_PEERS }));

  app.post('/api/meetings', auth, (req, res) => {
    const name = text(req.body.name, 60) || `Réunion de ${req.user.display_name}`;
    if (rooms.size >= 50) return bad(res, 'Trop de réunions ouvertes');
    const id = crypto.randomBytes(6).toString('hex');
    rooms.set(id, { id, name, created_by: req.user.id, creator_name: req.user.display_name, created_at: Date.now(), peers: new Map(), emptySince: Date.now() });
    pushList();
    res.json({ id });
  });

  app.get('/api/meetings/:id', auth, (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room) return bad(res, 'Réunion terminée ou introuvable', 404);
    res.json(summary(room));
  });

  app.delete('/api/meetings/:id', auth, (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room) return bad(res, 'Introuvable', 404);
    if (room.created_by !== req.user.id && req.user.role !== 'admin') return bad(res, "Seul l'organisateur ou un modérateur peut terminer la réunion", 403);
    toRoom(room, 'rtc_closed', { room: room.id });
    rooms.delete(room.id);
    pushList();
    res.json({ ok: true });
  });

  app.post('/api/meetings/:id/join', auth, (req, res) => {
    const c = ctx(req, res, false);
    if (!c) return;
    const { room, connId } = c;
    if (!room.peers.has(connId) && room.peers.size >= MAX_PEERS) return bad(res, `Réunion pleine (${MAX_PEERS} personnes max)`, 409);
    for (const r of rooms.values()) if (r !== room) leave(r, connId); // une seule réunion à la fois par onglet
    const existing = [...room.peers.values()].filter(p => p.connId !== connId);
    const peer = {
      connId, user_id: req.user.id, display_name: req.user.display_name, role: req.user.role,
      state: cleanState(req.body.state), joined_at: Date.now(),
    };
    room.peers.set(connId, peer);
    room.emptySince = null;
    toRoom(room, 'rtc_joined', { room: room.id, peer }, connId);
    pushList();
    res.json({ room: summary(room), peers: existing, iceServers });
  });

  app.post('/api/meetings/:id/leave', auth, (req, res) => {
    const c = ctx(req, res, false);
    if (!c) return;
    leave(c.room, c.connId);
    res.json({ ok: true });
  });

  app.post('/api/meetings/:id/signal', auth, (req, res) => {
    const c = ctx(req, res);
    if (!c) return;
    const to = String(req.body.to || '');
    if (!c.room.peers.has(to)) return bad(res, 'Participant introuvable', 404);
    const data = req.body.data;
    if (!data || typeof data !== 'object' || JSON.stringify(data).length > 100_000) return bad(res, 'Signal invalide');
    sendTo(to, 'rtc_signal', { room: c.room.id, from: c.connId, data });
    res.json({ ok: true });
  });

  app.post('/api/meetings/:id/state', auth, (req, res) => {
    const c = ctx(req, res);
    if (!c) return;
    c.peer.state = cleanState(req.body.state);
    toRoom(c.room, 'rtc_state', { room: c.room.id, connId: c.connId, state: c.peer.state }, c.connId);
    res.json({ ok: true });
  });

  app.post('/api/meetings/:id/chat', auth, (req, res) => {
    const c = ctx(req, res);
    if (!c) return;
    const content = text(req.body.content, 1000);
    if (!content) return bad(res, 'Message vide');
    toRoom(c.room, 'rtc_chat', { room: c.room.id, from: c.connId, display_name: req.user.display_name, content, at: Date.now() });
    res.json({ ok: true });
  });

  app.post('/api/meetings/:id/react', auth, (req, res) => {
    const c = ctx(req, res);
    if (!c) return;
    const emoji = String(req.body.emoji || '');
    if (!REACTIONS.includes(emoji)) return bad(res, 'Réaction inconnue');
    toRoom(c.room, 'rtc_react', { room: c.room.id, from: c.connId, emoji });
    res.json({ ok: true });
  });

  // Supprime les salles vides depuis plus de 30 minutes
  setInterval(() => {
    let changed = false;
    for (const r of rooms.values()) {
      if (r.peers.size === 0 && r.emptySince && Date.now() - r.emptySince > 30 * 60e3) { rooms.delete(r.id); changed = true; }
    }
    if (changed) pushList();
  }, 60e3).unref();

  return {
    onDisconnect(connId) { for (const r of rooms.values()) leave(r, connId); },
    // Utilisé par le planning : crée une salle pour une réunion planifiée
    createRoom(name, user) {
      const id = crypto.randomBytes(6).toString('hex');
      rooms.set(id, { id, name: String(name).slice(0, 60), created_by: user.id, creator_name: user.display_name, created_at: Date.now(), peers: new Map(), emptySince: Date.now() });
      pushList();
      return id;
    },
    exists: id => rooms.has(id),
    REACTIONS,
  };
};
