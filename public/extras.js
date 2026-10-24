'use strict';
/* Pièces jointes, mentions (@identifiant) et notifications (dans l'appli + push). */

// ============ Pièces jointes ============
const FILE_ICONS = { pdf: '📕', docx: '📘', odt: '📘', xlsx: '📗', ods: '📗', pptx: '📙', odp: '📙', pkt: '🖧', pka: '🖧', txt: '📄', md: '📄', csv: '📊', log: '📄', json: '🧾', py: '🐍', sh: '⌨️', ps1: '⌨️' };
const fmtSize = n => n < 1024 ? `${n} o` : n < 1048576 ? `${(n / 1024).toFixed(0)} Ko` : `${(n / 1048576).toFixed(1)} Mo`;

async function uploadConfig() {
  if (!state.uploadCfg) state.uploadCfg = await api('GET', '/api/uploads/config').catch(() => ({ max_mb: 10, allowed: [], max_per_post: 5 }));
  return state.uploadCfg;
}

function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    // Toujours en binaire brut : le serveur détecte le vrai type lui-même
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name || 'image.png'));
    xhr.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Erreur ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Envoi impossible (réseau)'));
    xhr.send(file);
  });
}

// Zone de pièces jointes liée à un formulaire : bouton 📎, glisser-déposer, coller une capture
class AttachBox {
  constructor({ button, list, dropZone, pasteTarget }) {
    this.items = [];
    this.list = list;
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.hidden = true;
    button.after(input);
    uploadConfig().then(c => { input.accept = c.allowed.map(e => '.' + e).join(','); });
    button.addEventListener('click', e => { e.preventDefault(); input.click(); });
    input.addEventListener('change', () => { this.add([...input.files]); input.value = ''; });
    if (dropZone) {
      dropZone.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); dropZone.classList.add('dragging'); } });
      dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragging'); });
      dropZone.addEventListener('drop', e => { if (e.dataTransfer?.files.length) { e.preventDefault(); dropZone.classList.remove('dragging'); this.add([...e.dataTransfer.files]); } });
    }
    pasteTarget?.addEventListener('paste', e => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); this.add(files); }
    });
  }
  async add(files) {
    const cfg = await uploadConfig();
    for (const f of files) {
      if (this.items.length >= cfg.max_per_post) { toast(`${cfg.max_per_post} pièces jointes maximum`); break; }
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (f.name.includes('.') && !cfg.allowed.includes(ext)) { toast(`.${ext} : type non autorisé`); continue; }
      if (f.size > cfg.max_mb * 1048576) { toast(`${f.name} : ${cfg.max_mb} Mo maximum`); continue; }
      const it = { name: f.name || 'capture.png', size: f.size, progress: 0, id: null, error: null };
      this.items.push(it);
      this.render();
      uploadFile(f, p => { it.progress = p; this.render(); })
        .then(a => { it.id = a.id; it.is_image = a.is_image; this.render(); })
        .catch(err => { it.error = err.message; this.render(); toast(`${it.name} : ${err.message}`); });
    }
  }
  render() {
    this.list.hidden = !this.items.length;
    this.list.innerHTML = this.items.map((it, i) => `
      <span class="att-chip ${it.error ? 'err' : it.id ? 'done' : ''}" title="${esc(it.error || it.name)}">
        ${it.id && it.is_image ? `<img src="/api/files/${it.id}" alt="">` : `<span>${it.error ? '⚠️' : FILE_ICONS[it.name.split('.').pop().toLowerCase()] || '📎'}</span>`}
        <span class="att-name">${esc(it.name)}</span>
        ${!it.id && !it.error ? `<span class="att-prog" style="--p:${Math.round(it.progress * 100)}%"></span>` : `<span class="muted">${fmtSize(it.size)}</span>`}
        <button type="button" data-rm="${i}" aria-label="Retirer">✕</button>
      </span>`).join('');
    this.list.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { this.items.splice(+b.dataset.rm, 1); this.render(); });
  }
  busy() { return this.items.some(it => !it.id && !it.error); }
  ids() { return this.items.filter(it => it.id).map(it => it.id); }
  clear() { this.items = []; this.render(); }
}

// Champ texte + barre d'outils de pièces jointes, à insérer dans un formulaire
const attachUi = () => `
  <div class="att-list" hidden></div>
  <div class="att-bar"><button type="button" class="btn sm att-btn" title="Joindre un fichier (ou glisse-dépose, ou colle une capture)">📎 Joindre</button>
  <span class="small muted">Images, PDF, Office, Packet Tracer… — tu peux aussi coller une capture (Ctrl+V)</span></div>`;
function bindAttach(form, textarea) {
  return new AttachBox({ button: form.querySelector('.att-btn'), list: form.querySelector('.att-list'), dropZone: form, pasteTarget: textarea });
}

function renderAttachments(list) {
  if (!list?.length) return '';
  const imgs = list.filter(a => a.is_image), files = list.filter(a => !a.is_image);
  return `<div class="atts">
    ${imgs.map(a => `<a class="att-img" href="/api/files/${a.id}" target="_blank" rel="noopener"><img src="/api/files/${a.id}" alt="${esc(a.name)}" loading="lazy" ${a.width ? `width="${a.width}" height="${a.height}"` : ''}></a>`).join('')}
    ${files.map(a => `<a class="att-file" href="/api/files/${a.id}?dl=1" download="${esc(a.name)}">
      <span class="att-ico">${FILE_ICONS[a.ext] || '📎'}</span><span><b>${esc(a.name)}</b><br><span class="small muted">${a.ext.toUpperCase()} · ${fmtSize(a.size)}</span></span></a>`).join('')}
  </div>`;
}

// ============ Mentions ============
function mentionify(html) {
  const me = state.user?.username?.toLowerCase();
  return html.replace(/(^|[^\w@&;/])@([a-zA-Z0-9_.-]{3,24})/g, (m, pre, name) => {
    const clean = name.replace(/\.+$/, '');
    const rest = name.slice(clean.length);
    return `${pre}<span class="mention${clean.toLowerCase() === me ? ' me' : ''}">@${clean}</span>${rest}`;
  });
}

async function membersCache() {
  if (!state.membersAt || Date.now() - state.membersAt > 60e3) {
    state.membersList = await api('GET', '/api/members').catch(() => state.membersList || []);
    state.membersAt = Date.now();
  }
  return state.membersList;
}

// Autocomplétion @ dans une zone de texte
function bindMentions(textarea) {
  const wrap = document.createElement('div');
  wrap.className = 'mention-box';
  wrap.hidden = true;
  textarea.parentNode.style.position ||= 'relative';
  textarea.after(wrap);
  let items = [], sel = 0, start = -1;
  const close = () => { wrap.hidden = true; items = []; };
  const pick = i => {
    const u = items[i];
    if (!u) return;
    const v = textarea.value, caret = textarea.selectionStart;
    textarea.value = v.slice(0, start) + '@' + u.username + ' ' + v.slice(caret);
    const pos = start + u.username.length + 2;
    textarea.setSelectionRange(pos, pos);
    close();
    textarea.focus();
  };
  textarea.addEventListener('input', async () => {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const m = before.match(/(^|\s)@([a-zA-Z0-9_.-]{0,24})$/);
    if (!m) return close();
    start = before.length - m[2].length - 1;
    const q = m[2].toLowerCase();
    const all = await membersCache();
    items = all.filter(u => u.id !== state.user.id && (u.username.toLowerCase().startsWith(q) || u.display_name.toLowerCase().includes(q))).slice(0, 6);
    sel = 0;
    if (!items.length) return close();
    wrap.innerHTML = items.map((u, i) => `<div class="mention-item ${i === sel ? 'sel' : ''}" data-i="${i}">${avatar(u.display_name)}<b>${esc(u.display_name)}</b><span class="muted">@${esc(u.username)}</span>${u.filiere_nom ? `<span class="pill">${esc(u.filiere_nom)}</span>` : ''}</div>`).join('');
    wrap.hidden = false;
    wrap.querySelectorAll('.mention-item').forEach(el => el.onmousedown = e => { e.preventDefault(); pick(+el.dataset.i); });
  });
  // En phase de capture pour passer avant « Entrée = envoyer »
  textarea.addEventListener('keydown', e => {
    if (wrap.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      wrap.querySelectorAll('.mention-item').forEach((el, i) => el.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault(); e.stopImmediatePropagation(); pick(sel);
    } else if (e.key === 'Escape') { close(); }
  }, true);
  textarea.addEventListener('blur', () => setTimeout(close, 150));
}

// ============ Notifications ============
function setUnread(n) {
  state.unreadNotifs = n;
  const base = 'Classe CEVEDOM';
  document.title = n ? `(${n}) ${base}` : base;
  const b = $('#notif-badge');
  if (b) { b.textContent = n > 99 ? '99+' : n; b.hidden = !n; }
  navigator.setAppBadge && (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}
function onNotif({ notif, unread }) {
  setUnread(unread);
  beep('notif');
  // Pas de toast si on est déjà sur la page concernée
  if (location.hash !== notif.link) toastLink(notif);
  if (state.route?.name === 'notifications') viewNotifications();
}
function toastLink(n) {
  const t = document.createElement('a');
  t.className = 'toast toast-notif';
  t.href = n.link || '#/notifications';
  t.innerHTML = `<b>🔔 ${esc(n.title)}</b>${n.body ? `<br><span>${esc(n.body)}</span>` : ''}`;
  t.onclick = () => { api('POST', '/api/notifications/read', { ids: [n.id] }).then(d => setUnread(d.unread)).catch(() => {}); t.remove(); stackToasts(); };
  // 3 notifications affichées au maximum, empilées (la plus récente en haut)
  const old = $$('.toast-notif');
  if (old.length >= 3) old[0].remove();
  document.body.appendChild(t);
  stackToasts();
  setTimeout(() => { t.remove(); stackToasts(); }, 6000);
}
function stackToasts() {
  let top = 16;
  $$('.toast-notif').reverse().forEach(el => { el.style.top = `${top}px`; top += el.offsetHeight + 8; });
}

// ---- Push (Push API + service worker) ----
const pushSupported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function b64urlToBytes(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function swRegistration() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}
async function pushStatus() {
  if (!window.isSecureContext) return { state: 'insecure' };
  if (!pushSupported()) return { state: isIOS() && !isStandalone() ? 'ios-install' : 'unsupported' };
  if (Notification.permission === 'denied') return { state: 'denied' };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return { state: sub ? 'on' : 'off', sub };
}
// À appeler uniquement après un clic (bonne pratique web.dev / exigence Safari)
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications bloquées par le navigateur' : 'Permission non accordée');
  const reg = await swRegistration();
  if (!reg) throw new Error('Service worker indisponible');
  await navigator.serviceWorker.ready;
  const { publicKey } = await api('GET', '/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) });
  await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
}
async function disablePush() {
  const { sub } = await pushStatus();
  if (sub) {
    await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'navigate') location.hash = e.data.link || '#/notifications';
  });
}

const PUSH_TEXT = {
  insecure: '⚠️ Le site n’est pas en HTTPS : les notifications sur l’appareil sont impossibles (voir README).',
  'ios-install': '📱 Sur iPhone/iPad (iOS 16.4+) : touche <b>Partager → « Sur l’écran d’accueil »</b>, ouvre Classe CEVEDOM depuis l’écran d’accueil, puis reviens ici.',
  unsupported: 'Ce navigateur ne gère pas les notifications push.',
  denied: '🔕 Notifications bloquées. Pour les réactiver : clique sur le cadenas à gauche de l’adresse → Notifications → Autoriser, puis recharge la page.',
  off: 'Reçois une notification sur cet appareil quand on te mentionne ou qu’on répond à tes sujets, même appli fermée.',
  on: '✅ Notifications activées sur cet appareil.',
};

async function pushCardHtml() {
  const st = await pushStatus();
  return `<p class="small">${PUSH_TEXT[st.state]}</p>
    <div class="row">
      ${st.state === 'off' ? '<button class="btn primary" id="push-on">🔔 Activer sur cet appareil</button>' : ''}
      ${st.state === 'on' ? '<button class="btn" id="push-test">Envoyer un test</button><button class="btn danger" id="push-off">Désactiver sur cet appareil</button>' : ''}
    </div>`;
}
function bindPushCard(refresh) {
  $('#push-on')?.addEventListener('click', async () => {
    try { await enablePush(); toast('Notifications activées'); } catch (e) { toast(e.message); }
    refresh();
  });
  $('#push-off')?.addEventListener('click', async () => { await disablePush(); toast('Notifications désactivées sur cet appareil'); refresh(); });
  $('#push-test')?.addEventListener('click', async () => {
    try { await api('POST', '/api/push/test'); toast('Test envoyé (il s’affiche si l’appli est fermée ou en arrière-plan)'); } catch (e) { toast(e.message); }
  });
}

async function viewNotifications() {
  setTitle('🔔 Notifications', 'Mentions et réponses à tes sujets');
  const d = await api('GET', '/api/notifications');
  setUnread(d.unread);
  setContent(`
    <div class="grid grid-2" style="align-items:start">
      <div class="card" style="padding:0">
        <div class="row" style="padding:14px 16px;border-bottom:1px solid var(--border)"><b>Récentes</b><span class="spacer"></span>
          ${d.unread ? '<button class="btn sm" id="read-all">Tout marquer comme lu</button>' : ''}</div>
        ${d.items.length ? d.items.map(n => `
          <a class="notif-row ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/notifications')}" data-id="${n.id}">
            <span class="notif-ico">${{ mention: '@', reply: '💬', exercice: '📝', rappel: '🗓️', duel: '⚔️', idee: '💡' }[n.type] || '🔔'}</span>
            <span style="flex:1;min-width:0"><b>${esc(n.title)}</b>${n.body ? `<br><span class="small muted">${esc(n.body)}</span>` : ''}
              <br><span class="small muted">${fmtDate(n.created_at)}</span></span>
          </a>`).join('') : '<div class="empty">Rien pour l’instant. Tu seras prévenu quand quelqu’un écrit <b>@' + esc(state.user.username) + '</b> ou répond à tes sujets.</div>'}
      </div>
      <div>
        <div class="card"><h3>📱 Sur cet appareil</h3><div id="push-card">…</div></div>
        <div class="card" style="margin-top:16px">
          <h3>⚙️ Me prévenir quand…</h3>
          <label class="toggle"><input type="checkbox" data-pref="mention" ${d.prefs.mention ? 'checked' : ''}> quelqu’un me mentionne (@${esc(state.user.username)})</label>
          <label class="toggle"><input type="checkbox" data-pref="reply" ${d.prefs.reply ? 'checked' : ''}> quelqu’un répond à un sujet que j’ai créé ou suivi</label>
          <label class="toggle"><input type="checkbox" data-pref="exercice" ${d.prefs.exercice ? 'checked' : ''}> un exercice est publié, rendu ou corrigé</label>
          <label class="toggle"><input type="checkbox" data-pref="message" ${d.prefs.message ? 'checked' : ''}> je reçois un message d’un formateur ou d’un élève (messagerie)</label>
          <label class="toggle"><input type="checkbox" data-pref="scolarite" ${d.prefs.scolarite ? 'checked' : ''}> nouvelle note, absence relevée, travail à faire, livret signé par le tuteur</label>
          <label class="toggle"><input type="checkbox" data-pref="rappel" ${d.prefs.rappel ? 'checked' : ''}> rappel la veille d’un examen, d’un rendu ou d’une réunion</label>
          <label class="toggle"><input type="checkbox" data-pref="duel" ${d.prefs.duel ? 'checked' : ''}> quelqu’un me défie en duel, ou un duel se termine</label>
          <label class="toggle"><input type="checkbox" data-pref="idee" ${d.prefs.idee ? 'checked' : ''}> l’équipe répond à une de mes idées</label>
          ${state.user.role === 'admin' ? `<label class="toggle"><input type="checkbox" data-pref="systeme" ${d.prefs.systeme ? 'checked' : ''}> 🛠️ une erreur sur le site ou une mise à jour automatique (modérateurs)</label>` : ''}
          <label class="toggle"><input type="checkbox" data-pref="push" ${d.prefs.push ? 'checked' : ''}> envoyer aussi sur mes appareils (si l’appli est fermée)</label>
          <p class="small muted">Pour mentionner quelqu’un, tape <b>@</b> dans un message : une liste s’affiche.</p>
        </div>
      </div>
    </div>`);
  const refresh = async () => { $('#push-card').innerHTML = await pushCardHtml(); bindPushCard(refresh); };
  refresh();
  $('#read-all')?.addEventListener('click', async () => { const r = await api('POST', '/api/notifications/read', {}); setUnread(r.unread); viewNotifications(); });
  $$('.notif-row').forEach(a => a.addEventListener('click', () => {
    api('POST', '/api/notifications/read', { ids: [+a.dataset.id] }).then(r => setUnread(r.unread)).catch(() => {});
  }));
  $$('[data-pref]').forEach(c => c.onchange = () => api('POST', '/api/notifications/prefs', { [c.dataset.pref]: c.checked }).then(() => toast('Enregistré')).catch(e => toast(e.message)));
}

// Proposition douce sur l'accueil (une seule fois, après une action de l'utilisateur)
async function pushPromptHtml() {
  let dismissed = false;
  try { dismissed = localStorage.getItem('pushPromptDismissed') === '1'; } catch {}
  if (dismissed) return '';
  const st = await pushStatus().catch(() => ({ state: 'unsupported' }));
  if (st.state !== 'off' && st.state !== 'ios-install') return '';
  return `<div class="card push-prompt" id="push-prompt">
    <div class="row"><span style="font-size:26px">🔔</span><div style="flex:1;min-width:200px"><b>Être prévenu quand on te répond ?</b>
      <div class="small muted">${st.state === 'ios-install' ? PUSH_TEXT['ios-install'] : 'Une notification quand on te mentionne ou qu’on répond à tes sujets. Tu peux couper à tout moment.'}</div></div>
      ${st.state === 'off' ? '<button class="btn primary" id="pp-yes">Activer</button>' : ''}<button class="btn" id="pp-no">Plus tard</button></div></div>`;
}
function bindPushPrompt() {
  const hide = () => { try { localStorage.setItem('pushPromptDismissed', '1'); } catch {} $('#push-prompt')?.remove(); };
  $('#pp-no')?.addEventListener('click', hide);
  $('#pp-yes')?.addEventListener('click', async () => {
    try { await enablePush(); toast('Notifications activées 🔔'); } catch (e) { toast(e.message); }
    hide();
  });
}
