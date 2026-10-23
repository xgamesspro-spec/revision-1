'use strict';
/* Réunions vidéo : caméra, micro, partage d'écran, main levée, réactions, chat.
   Connexions WebRTC directes entre les navigateurs (maillage), signalisation via le serveur. */

const REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '😮', '❓'];
const meet = {
  room: null,        // { id, name, created_by }
  connId: null,      // connexion avec laquelle on a rejoint
  ice: null,
  local: null,       // MediaStream micro + caméra
  screen: null,      // MediaStream partage d'écran
  state: { mic: true, cam: true, screen: false, hand: false },
  peers: new Map(),  // connId -> peer
  chat: [],
  unreadChat: 0,
  panel: null,       // 'chat' | 'people' | null
  audioCtx: null,
  levelTimer: null,
  preview: null,     // flux de prévisualisation avant d'entrer
};

const canShareScreen = () => !!navigator.mediaDevices?.getDisplayMedia;

// ---------- Liste des réunions ----------
async function viewMeetings() {
  setTitle('🎥 Réunions', 'Visio entre élèves : caméra, micro, partage d’écran');
  const list = await api('GET', '/api/meetings');
  state.meetings = list;
  setContent(`
    ${!window.isSecureContext ? `<div class="card" style="border-color:var(--gold);margin-bottom:16px">⚠️ <b>La caméra, le micro et le partage d'écran ne marchent qu'en HTTPS.</b>
      <div class="small muted">Demande à l'admin de la plateforme d'activer le HTTPS (voir le README, section HTTPS).</div></div>` : ''}
    <form id="new-meeting" class="card row" style="margin-bottom:20px">
      <input type="text" name="name" maxlength="60" placeholder="Nom de la réunion (ex. : Révision subnetting)" style="flex:1;min-width:200px">
      <button class="btn primary">🎥 Lancer une réunion</button>
    </form>
    <div class="section-title" style="margin-top:0">En cours</div>
    <div id="meeting-list"></div>`);
  renderMeetingList();
  $('#new-meeting').onsubmit = async e => {
    e.preventDefault();
    try {
      const { id } = await api('POST', '/api/meetings', { name: e.target.name.value });
      location.hash = `#/reunion/${id}`;
    } catch (err) { toast(err.message); }
  };
}

function renderMeetingList() {
  const box = $('#meeting-list');
  if (!box) return;
  const list = state.meetings || [];
  box.innerHTML = list.length ? `<div class="grid grid-2">${list.map(m => `
    <div class="card">
      <div class="row"><h3 style="margin:0">${esc(m.name)}</h3><span class="spacer"></span>
        ${m.count ? `<span class="pill ok">● ${m.count} en ligne</span>` : '<span class="pill">vide</span>'}</div>
      <div class="small muted" style="margin:6px 0 12px">Lancée par ${esc(m.creator_name)} · ${fmtDate(m.created_at)}</div>
      ${m.people.length ? `<div class="small" style="margin-bottom:12px">${m.people.map(esc).join(', ')}</div>` : ''}
      <div class="row">
        <a class="btn primary" href="#/reunion/${m.id}">Rejoindre</a>
        <button class="btn" data-copy-link="${m.id}">🔗 Copier le lien</button>
        ${m.created_by === state.user.id || state.user.role === 'admin' ? `<button class="btn danger" data-end-meeting="${m.id}">Terminer</button>` : ''}
      </div>
    </div>`).join('')}</div>` : '<div class="card empty">Aucune réunion en cours. Lance-en une !</div>';
  $$('[data-copy-link]', box).forEach(b => b.onclick = () => {
    navigator.clipboard?.writeText(`${location.origin}/#/reunion/${b.dataset.copyLink}`); toast('Lien copié');
  });
  $$('[data-end-meeting]', box).forEach(b => b.onclick = async () => {
    if (!confirm('Terminer la réunion pour tout le monde ?')) return;
    await api('DELETE', `/api/meetings/${b.dataset.endMeeting}`).catch(e => toast(e.message));
  });
}

// ---------- Salle : écran d'accueil (prévisualisation) ----------
async function viewMeeting(r) {
  if (meet.room?.id === r.id) return renderRoom(); // déjà dedans
  const info = await api('GET', `/api/meetings/${r.id}`);
  setTitle(`🎥 ${esc(info.name)}`, `${info.count} participant(s) · lancée par ${esc(info.creator_name)}`);
  setContent(`
    <div class="row" style="margin-bottom:12px"><a href="#/reunions" class="small">← Toutes les réunions</a></div>
    <div class="grid grid-2" style="align-items:start">
      <div class="prejoin-video"><video id="pre-video" autoplay playsinline muted></video><div id="pre-msg" class="pre-msg">Activation de la caméra…</div></div>
      <div class="card">
        <h2>Prêt à rejoindre ?</h2>
        <p class="muted small">${info.count ? `Déjà là : ${info.people.map(esc).join(', ')}` : 'Personne pour le moment, tu seras le premier.'}</p>
        ${!window.isSecureContext ? '<p class="error">⚠️ Page non sécurisée (HTTP) : caméra, micro et partage d’écran bloqués par le navigateur. Tu pourras seulement voir et écouter les autres.</p>' : ''}
        <label class="toggle"><input type="checkbox" id="pre-mic" checked> 🎤 Micro activé</label>
        <label class="toggle"><input type="checkbox" id="pre-cam" checked> 📷 Caméra activée</label>
        <button class="btn primary" id="join-btn" style="width:100%;margin-top:14px">Rejoindre la réunion</button>
        <p class="small muted" style="margin-bottom:0">Conseil : mets un casque pour éviter l'écho. Jusqu'à ${state.meetConfig?.max || 10} personnes par réunion.</p>
      </div>
    </div>`);
  // Prévisualisation
  stopPreview();
  try {
    meet.preview = await getLocalMedia(true, true);
    if (meet.preview) {
      $('#pre-video').srcObject = meet.preview;
      $('#pre-msg').style.display = meet.preview.getVideoTracks().length ? 'none' : '';
      if (!meet.preview.getVideoTracks().length) $('#pre-msg').textContent = 'Pas de caméra détectée — tu rejoindras en audio.';
    }
  } catch { $('#pre-msg').textContent = 'Caméra / micro indisponibles.'; }
  $('#pre-cam').onchange = e => meet.preview?.getVideoTracks().forEach(t => t.enabled = e.target.checked);
  $('#join-btn').onclick = async () => {
    $('#join-btn').disabled = true;
    try {
      await joinMeeting(r.id, { mic: $('#pre-mic').checked, cam: $('#pre-cam').checked });
    } catch (err) { toast(err.message); $('#join-btn').disabled = false; }
  };
}

async function getLocalMedia(audio, video) {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  const tries = [
    { audio, video: video ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } : false },
    { audio, video: false },
    { audio: false, video: video ? true : false },
  ];
  for (const c of tries) {
    if (!c.audio && !c.video) continue;
    try { return await navigator.mediaDevices.getUserMedia(c); } catch { /* on essaie la suite */ }
  }
  return null;
}
function stopPreview() {
  if (meet.preview && meet.preview !== meet.local) meet.preview.getTracks().forEach(t => t.stop());
  meet.preview = null;
}

async function waitConnId() {
  for (let i = 0; i < 50 && !state.connId; i++) await new Promise(r => setTimeout(r, 100));
  if (!state.connId) throw new Error('Connexion temps réel indisponible, recharge la page');
  return state.connId;
}

// ---------- Rejoindre / quitter ----------
async function joinMeeting(id, { mic, cam }) {
  const connId = await waitConnId();
  meet.local = meet.preview || await getLocalMedia(true, true);
  meet.preview = null;
  const hasA = !!meet.local?.getAudioTracks().length, hasV = !!meet.local?.getVideoTracks().length;
  meet.state = { mic: mic && hasA, cam: cam && hasV, screen: false, hand: false };
  meet.local?.getAudioTracks().forEach(t => t.enabled = meet.state.mic);
  meet.local?.getVideoTracks().forEach(t => t.enabled = meet.state.cam);
  const res = await api('POST', `/api/meetings/${id}/join`, { connId, state: meet.state });
  meet.room = res.room;
  meet.connId = connId;
  meet.ice = res.iceServers;
  meet.chat = [];
  meet.unreadChat = 0;
  meet.peers.clear();
  renderRoom();
  // C'est le nouvel arrivant qui appelle tous ceux déjà présents
  for (const p of res.peers) {
    const peer = addPeer(p);
    await createPeerConnection(peer, true);
  }
  startLevels();
}

async function leaveMeeting({ silent = false, closed = false } = {}) {
  if (!meet.room) return;
  const id = meet.room.id, connId = meet.connId;
  for (const p of meet.peers.values()) closePeer(p);
  meet.peers.clear();
  meet.local?.getTracks().forEach(t => t.stop());
  meet.screen?.getTracks().forEach(t => t.stop());
  meet.local = meet.screen = null;
  meet.room = null;
  clearInterval(meet.levelTimer);
  if (!closed) api('POST', `/api/meetings/${id}/leave`, { connId }).catch(() => {});
  if (!silent) toast(closed ? 'La réunion a été terminée' : 'Tu as quitté la réunion');
  renderSidebar();
}

// La connexion temps réel a été recréée (coupure réseau) : on rejoint à nouveau
async function meetingReconnect() {
  if (!meet.room) return;
  const id = meet.room.id;
  for (const p of meet.peers.values()) closePeer(p);
  meet.peers.clear();
  try {
    const res = await api('POST', `/api/meetings/${id}/join`, { connId: state.connId, state: meet.state });
    meet.connId = state.connId;
    renderRoom();
    for (const p of res.peers) await createPeerConnection(addPeer(p), true);
  } catch (err) { toast(err.message); leaveMeeting({ silent: true }); location.hash = '#/reunions'; }
}

// ---------- WebRTC ----------
function addPeer(info) {
  let peer = meet.peers.get(info.connId);
  if (!peer) {
    peer = { ...info, pc: null, tx: null, pending: [], camStream: null, screenStream: null, el: null, screenEl: null };
    meet.peers.set(info.connId, peer);
  } else Object.assign(peer, { display_name: info.display_name, state: info.state });
  return peer;
}

function signal(to, data) {
  if (!meet.room) return;
  api('POST', `/api/meetings/${meet.room.id}/signal`, { connId: meet.connId, to, data }).catch(() => {});
}

async function createPeerConnection(peer, initiator) {
  const pc = new RTCPeerConnection({ iceServers: meet.ice || [] });
  peer.pc = pc;
  pc.onicecandidate = e => { if (e.candidate) signal(peer.connId, { candidate: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    updatePeerTile(peer);
    if (pc.connectionState === 'failed' && initiator) restartIce(peer);
  };
  if (initiator) {
    // 3 canaux fixes : son, caméra, écran (on remplace les pistes sans renégocier)
    const tx = [
      pc.addTransceiver('audio', { direction: 'sendrecv' }),
      pc.addTransceiver('video', { direction: 'sendrecv' }),
      pc.addTransceiver('video', { direction: 'sendrecv' }),
    ];
    attachTransceivers(peer, tx);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signal(peer.connId, { sdp: pc.localDescription.toJSON() });
  }
  return pc;
}

async function restartIce(peer) {
  try {
    const offer = await peer.pc.createOffer({ iceRestart: true });
    await peer.pc.setLocalDescription(offer);
    signal(peer.connId, { sdp: peer.pc.localDescription.toJSON() });
  } catch { /* ignoré */ }
}

function attachTransceivers(peer, tx) {
  peer.tx = tx;
  const [ta, tv, ts] = tx;
  ta.sender.replaceTrack(meet.local?.getAudioTracks()[0] || null);
  tv.sender.replaceTrack(meet.local?.getVideoTracks()[0] || null);
  ts.sender.replaceTrack(meet.screen?.getVideoTracks()[0] || null);
  peer.camStream = new MediaStream([ta.receiver.track, tv.receiver.track]);
  peer.screenStream = new MediaStream([ts.receiver.track]);
  ensurePeerTiles(peer);
}

async function onSignal({ from, data }) {
  const peer = meet.peers.get(from);
  if (!peer) return;
  try {
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        if (!peer.pc) await createPeerConnection(peer, false);
        await peer.pc.setRemoteDescription(data.sdp);
        if (!peer.tx) {
          const tx = peer.pc.getTransceivers();
          tx.forEach(t => t.direction = 'sendrecv');
          attachTransceivers(peer, tx);
        }
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        signal(from, { sdp: peer.pc.localDescription.toJSON() });
      } else if (peer.pc) {
        await peer.pc.setRemoteDescription(data.sdp);
      }
      for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
    } else if (data.candidate) {
      if (peer.pc?.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pending.push(data.candidate);
    }
  } catch (err) { console.warn('WebRTC', err); }
}

function closePeer(peer) {
  try { peer.pc?.close(); } catch {}
  peer.el?.remove();
  peer.screenEl?.remove();
}

// ---------- Événements temps réel ----------
function onMeetingEvent(type, d) {
  if (!meet.room || d.room !== meet.room.id) return;
  if (type === 'rtc_joined') {
    addPeer(d.peer);
    ensurePeerTiles(meet.peers.get(d.peer.connId));
    systemChat(`${d.peer.display_name} a rejoint la réunion`);
    layoutStage(); renderPeople();
  } else if (type === 'rtc_left') {
    const p = meet.peers.get(d.connId);
    if (p) { closePeer(p); meet.peers.delete(d.connId); systemChat(`${p.display_name} est parti`); layoutStage(); renderPeople(); }
  } else if (type === 'rtc_signal') {
    onSignal(d);
  } else if (type === 'rtc_state') {
    const p = meet.peers.get(d.connId);
    if (!p) return;
    if (d.state.hand && !p.state?.hand) toast(`✋ ${p.display_name} lève la main`);
    p.state = d.state;
    updatePeerTile(p); layoutStage(); renderPeople();
  } else if (type === 'rtc_chat') {
    meet.chat.push(d);
    if (meet.panel !== 'chat' && d.from !== meet.connId) meet.unreadChat++;
    renderChat(); renderControls();
  } else if (type === 'rtc_react') {
    showReaction(d.from === meet.connId ? 'me' : d.from, d.emoji);
  } else if (type === 'rtc_closed') {
    leaveMeeting({ closed: true });
    location.hash = '#/reunions';
  }
}
function systemChat(content) {
  meet.chat.push({ system: true, content, at: Date.now() });
  renderChat();
}

// ---------- Interface de la salle ----------
function renderRoom() {
  if (!meet.room) return;
  setTitle(`🎥 ${esc(meet.room.name)}`, 'Réunion en cours');
  setContent(`
    <div class="room">
      <div class="room-main">
        <div class="stage" id="stage">
          <div class="stage-screens" id="stage-screens"></div>
          <div class="stage-grid" id="stage-grid"></div>
        </div>
        <div class="controls" id="controls"></div>
      </div>
      <aside class="room-panel" id="room-panel" hidden>
        <div class="row panel-head"><b id="panel-title"></b><span class="spacer"></span><button class="btn sm" data-meet="panel-close">✕</button></div>
        <div id="panel-people" class="panel-body"></div>
        <div id="panel-chat" class="panel-body chat-panel">
          <div id="meet-chat" class="meet-chat"></div>
          <form id="meet-chat-form" class="row" style="flex-wrap:nowrap"><input type="text" id="meet-chat-input" maxlength="1000" placeholder="Message à la réunion…" autocomplete="off"><button class="btn primary">➤</button></form>
        </div>
      </aside>
    </div>`, { full: true });
  // Tuile locale + tuiles des autres
  meet.selfEl = makeTile('me', 'Toi', meet.local, true);
  meet.selfScreenEl = null;
  if (meet.screen) meet.selfScreenEl = makeScreenTile('me', 'Ton écran', meet.screen, true);
  for (const p of meet.peers.values()) { p.el = null; p.screenEl = null; ensurePeerTiles(p); }
  renderControls(); layoutStage(); renderPeople(); renderChat(); openPanel(meet.panel);
  $('#meet-chat-form').onsubmit = async e => {
    e.preventDefault();
    const input = $('#meet-chat-input');
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    try { await api('POST', `/api/meetings/${meet.room.id}/chat`, { connId: meet.connId, content }); }
    catch (err) { toast(err.message); input.value = content; }
  };
}

function makeTile(key, name, stream, isLocal) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.key = key;
  el.innerHTML = `
    <video autoplay playsinline ${isLocal ? 'muted' : ''}></video>
    <div class="tile-avatar">${avatar(name)}</div>
    <div class="tile-react"></div>
    <div class="tile-label"><span class="tile-mic">🔇</span><span class="tile-hand">✋</span><span class="tile-name">${esc(name)}</span><span class="tile-net"></span></div>
    <button class="tile-full" title="Plein écran">⛶</button>`;
  const v = el.querySelector('video');
  if (stream) v.srcObject = stream;
  if (isLocal) v.classList.add('mirror');
  el.querySelector('.tile-full').onclick = () => (el.requestFullscreen ? el.requestFullscreen() : null);
  return el;
}
function makeScreenTile(key, name, stream, isLocal) {
  const el = document.createElement('div');
  el.className = 'tile screen-tile';
  el.dataset.key = key + '-screen';
  el.innerHTML = `<video autoplay playsinline muted></video>
    <div class="tile-label"><span>🖥️</span><span class="tile-name">${esc(name)}</span></div>
    <button class="tile-full" title="Plein écran">⛶</button>`;
  el.querySelector('video').srcObject = stream;
  if (isLocal) el.classList.add('local-screen');
  el.querySelector('.tile-full').onclick = () => (el.requestFullscreen ? el.requestFullscreen() : null);
  return el;
}
function ensurePeerTiles(peer) {
  if (!$('#stage')) return;
  if (!peer.el) peer.el = makeTile(peer.connId, peer.display_name, peer.camStream, false);
  else if (peer.camStream && peer.el.querySelector('video').srcObject !== peer.camStream) peer.el.querySelector('video').srcObject = peer.camStream;
  if (!peer.screenEl && peer.screenStream) peer.screenEl = makeScreenTile(peer.connId, `Écran de ${peer.display_name}`, peer.screenStream, false);
  updatePeerTile(peer);
  layoutStage();
}
function updateTileState(el, st) {
  if (!el) return;
  el.classList.toggle('cam-off', !st?.cam);
  el.classList.toggle('mic-off', !st?.mic);
  el.classList.toggle('hand-up', !!st?.hand);
}
function updatePeerTile(peer) {
  updateTileState(peer.el, peer.state);
  if (peer.el) {
    const s = peer.pc?.connectionState;
    peer.el.querySelector('.tile-net').textContent = !s || s === 'connected' ? '' : s === 'failed' ? ' · connexion impossible' : ' · connexion…';
    peer.el.querySelector('video').play?.().catch(() => {});
  }
}

function layoutStage() {
  const grid = $('#stage-grid'), screens = $('#stage-screens');
  if (!grid) return;
  updateTileState(meet.selfEl, meet.state);
  const tiles = [meet.selfEl, ...[...meet.peers.values()].map(p => p.el)].filter(Boolean);
  const screenTiles = [];
  if (meet.state.screen && meet.selfScreenEl) screenTiles.push(meet.selfScreenEl);
  for (const p of meet.peers.values()) if (p.state?.screen && p.screenEl) screenTiles.push(p.screenEl);
  // Ajoute/retire sans recréer (sinon les vidéos se coupent)
  const sync = (box, els) => {
    [...box.children].forEach(c => { if (!els.includes(c)) c.remove(); });
    els.forEach(e => { if (e.parentNode !== box) box.appendChild(e); });
  };
  sync(screens, screenTiles);
  sync(grid, tiles);
  $('#stage').classList.toggle('has-screen', screenTiles.length > 0);
  const n = tiles.length;
  grid.style.setProperty('--cols', screenTiles.length ? 1 : n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4);
  [...grid.querySelectorAll('video'), ...screens.querySelectorAll('video')].forEach(v => v.play?.().catch(() => {}));
}

function renderControls() {
  const box = $('#controls');
  if (!box) return;
  const hasA = !!meet.local?.getAudioTracks().length, hasV = !!meet.local?.getVideoTracks().length;
  const st = meet.state;
  box.innerHTML = `
    <button class="ctl ${st.mic ? '' : 'off'}" data-meet="mic" ${hasA ? '' : 'disabled'} title="Micro (M)">${st.mic ? '🎤' : '🔇'}<span>Micro</span></button>
    <button class="ctl ${st.cam ? '' : 'off'}" data-meet="cam" ${hasV ? '' : 'disabled'} title="Caméra (V)">${st.cam ? '📷' : '🚫'}<span>Caméra</span></button>
    ${canShareScreen() ? `<button class="ctl ${st.screen ? 'on' : ''}" data-meet="screen" title="Partager l'écran">🖥️<span>${st.screen ? 'Arrêter' : 'Partager'}</span></button>` : ''}
    <button class="ctl ${st.hand ? 'on' : ''}" data-meet="hand" title="Lever la main">✋<span>Main</span></button>
    <div class="ctl-react">
      <button class="ctl" data-meet="react-menu" title="Réactions">😀<span>Réagir</span></button>
      <div class="react-menu" id="react-menu" hidden>${REACTIONS.map(e => `<button data-meet="react" data-emoji="${e}">${e}</button>`).join('')}</div>
    </div>
    <button class="ctl ${meet.panel === 'people' ? 'on' : ''}" data-meet="people" title="Participants">👥<span>${meet.peers.size + 1}</span></button>
    <button class="ctl ${meet.panel === 'chat' ? 'on' : ''}" data-meet="chat" title="Chat">💬<span>Chat</span>${meet.unreadChat ? `<i class="ctl-badge">${meet.unreadChat}</i>` : ''}</button>
    <button class="ctl" data-meet="copy" title="Copier le lien">🔗<span>Lien</span></button>
    <button class="ctl leave" data-meet="leave" title="Quitter">📞<span>Quitter</span></button>`;
}

function renderPeople() {
  const box = $('#panel-people');
  if (!box) return;
  const ic = st => `${st?.mic ? '🎤' : '🔇'} ${st?.cam ? '📷' : ''} ${st?.screen ? '🖥️' : ''} ${st?.hand ? '✋' : ''}`;
  const me = { display_name: state.user.display_name + ' (toi)', state: meet.state };
  const all = [me, ...meet.peers.values()].sort((a, b) => (b.state?.hand ? 1 : 0) - (a.state?.hand ? 1 : 0));
  box.innerHTML = all.map(p => `<div class="member" style="padding:6px 0">${avatar(p.display_name)}<span style="flex:1">${esc(p.display_name)}</span><span class="small">${ic(p.state)}</span></div>`).join('');
  renderControls();
}

function renderChat() {
  const box = $('#meet-chat');
  if (!box) return;
  box.innerHTML = meet.chat.length ? meet.chat.map(m => m.system
    ? `<div class="small muted" style="text-align:center;margin:6px 0">${esc(m.content)}</div>`
    : `<div class="meet-msg"><b>${esc(m.display_name)}</b> <span class="small muted">${new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span><div>${linkify(esc(m.content))}</div></div>`).join('')
    : '<div class="small muted" style="text-align:center;margin-top:20px">Les messages ne sont visibles que pendant la réunion.</div>';
  box.scrollTop = box.scrollHeight;
}

function openPanel(name) {
  meet.panel = name;
  const panel = $('#room-panel');
  if (!panel) return;
  panel.hidden = !name;
  $('#panel-people').hidden = name !== 'people';
  $('#panel-chat').hidden = name !== 'chat';
  $('#panel-title').textContent = name === 'chat' ? 'Chat de la réunion' : 'Participants';
  if (name === 'chat') { meet.unreadChat = 0; setTimeout(() => $('#meet-chat-input')?.focus(), 50); }
  renderControls();
}

function sendState() {
  if (!meet.room) return;
  api('POST', `/api/meetings/${meet.room.id}/state`, { connId: meet.connId, state: meet.state }).catch(() => {});
  layoutStage(); renderPeople();
}

function showReaction(key, emoji) {
  const el = key === 'me' ? meet.selfEl : meet.peers.get(key)?.el;
  const box = el?.querySelector('.tile-react');
  if (!box) return;
  const s = document.createElement('span');
  s.textContent = emoji;
  s.style.left = 20 + Math.random() * 60 + '%';
  box.appendChild(s);
  setTimeout(() => s.remove(), 2600);
}

// ---------- Partage d'écran ----------
async function startScreen() {
  try {
    meet.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
  } catch { return; } // annulé par l'utilisateur
  const track = meet.screen.getVideoTracks()[0];
  if ('contentHint' in track) track.contentHint = 'detail';
  track.onended = () => stopScreen();
  for (const p of meet.peers.values()) p.tx?.[2]?.sender.replaceTrack(track);
  meet.selfScreenEl = makeScreenTile('me', 'Ton écran', meet.screen, true);
  meet.state.screen = true;
  sendState();
}
function stopScreen() {
  meet.screen?.getTracks().forEach(t => t.stop());
  meet.screen = null;
  for (const p of meet.peers.values()) p.tx?.[2]?.sender.replaceTrack(null);
  meet.selfScreenEl?.remove();
  meet.selfScreenEl = null;
  meet.state.screen = false;
  sendState();
}

// ---------- Indicateur « parle » ----------
function startLevels() {
  clearInterval(meet.levelTimer);
  try { meet.audioCtx = meet.audioCtx || new AudioContext(); } catch { return; }
  const analysers = new Map();
  const getAnalyser = (key, stream) => {
    if (!stream || !stream.getAudioTracks().length) return null;
    const known = analysers.get(key);
    if (known && known.stream === stream) return known.an;
    try {
      const src = meet.audioCtx.createMediaStreamSource(stream);
      const an = meet.audioCtx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      analysers.set(key, { stream, an });
      return an;
    } catch { return null; }
  };
  const buf = new Uint8Array(512);
  const level = an => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); return m; };
  meet.levelTimer = setInterval(() => {
    if (!meet.room) return clearInterval(meet.levelTimer);
    meet.audioCtx.resume?.();
    const me = getAnalyser('me', meet.local);
    meet.selfEl?.classList.toggle('speaking', !!(me && meet.state.mic && level(me) > 12));
    for (const p of meet.peers.values()) {
      const an = getAnalyser(p.connId, p.camStream);
      p.el?.classList.toggle('speaking', !!(an && p.state?.mic && level(an) > 12));
    }
  }, 250);
}

// ---------- Boutons ----------
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-meet]');
  if (!b || !meet.room) return;
  const a = b.dataset.meet;
  if (a !== 'react-menu') $('#react-menu')?.setAttribute('hidden', '');
  if (a === 'mic') {
    meet.state.mic = !meet.state.mic;
    meet.local?.getAudioTracks().forEach(t => t.enabled = meet.state.mic);
    sendState();
  } else if (a === 'cam') {
    meet.state.cam = !meet.state.cam;
    meet.local?.getVideoTracks().forEach(t => t.enabled = meet.state.cam);
    sendState();
  } else if (a === 'screen') {
    meet.state.screen ? stopScreen() : startScreen();
  } else if (a === 'hand') {
    meet.state.hand = !meet.state.hand;
    sendState();
  } else if (a === 'react-menu') {
    const m = $('#react-menu'); m.hidden = !m.hidden;
  } else if (a === 'react') {
    showReaction('me', b.dataset.emoji);
    api('POST', `/api/meetings/${meet.room.id}/react`, { connId: meet.connId, emoji: b.dataset.emoji }).catch(() => {});
  } else if (a === 'people' || a === 'chat') {
    openPanel(meet.panel === a ? null : a);
  } else if (a === 'panel-close') {
    openPanel(null);
  } else if (a === 'copy') {
    navigator.clipboard?.writeText(`${location.origin}/#/reunion/${meet.room.id}`); toast('Lien de la réunion copié');
  } else if (a === 'leave') {
    await leaveMeeting();
    location.hash = '#/reunions';
  }
});
document.addEventListener('keydown', e => {
  if (!meet.room || e.target.closest('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'm' || e.key === 'M') $('[data-meet="mic"]')?.click();
  if (e.key === 'v' || e.key === 'V') $('[data-meet="cam"]')?.click();
});
window.addEventListener('pagehide', () => {
  if (meet.room && navigator.sendBeacon) {
    navigator.sendBeacon(`/api/meetings/${meet.room.id}/leave`, new Blob([JSON.stringify({ connId: meet.connId })], { type: 'application/json' }));
  }
});
