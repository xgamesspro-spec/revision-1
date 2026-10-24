'use strict';
/* Classe SIO — application monopage (sans framework) */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

const state = {
  user: null,
  channels: [],
  online: new Set(),
  unread: {},
  route: null,
  view: {},       // données de la vue courante
  es: null,
};

// ---------- Utilitaires ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) { state.user = null; render(); }
  if (res.status === 403 && data.gate && state.user && !state.gating) {
    state.gating = true;
    api('GET', '/api/me').then(d => { state.user = d.user; render(); }).finally(() => { state.gating = false; });
  }
  if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
  return data;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function colorFor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}
const avatar = (name) => `<div class="avatar" style="background:${colorFor(name)}">${esc(String(name).charAt(0).toUpperCase())}</div>`;
function fmtDate(ts, withTime = true) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay && withTime) return `aujourd'hui à ${time}`;
  const date = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  return withTime ? `${date} à ${time}` : date;
}
// Les liens internes (réunions…) restent dans l'onglet, les liens externes s'ouvrent à part
const linkify = s => s.replace(/(https?:\/\/[^\s<]+)/g, url =>
  url.startsWith(location.origin + '/#/') ? `<a href="${url.slice(location.origin.length + 1)}">${url}</a>` : `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);

// Mini-Markdown (le texte est toujours échappé d'abord)
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
       .replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1<i>$2</i>')
       .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = mentionify(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}
function md(src) {
  const lines = esc(src).split('\n');
  let out = '', i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      let code = ''; i++;
      while (i < lines.length && !/^```/.test(lines[i])) code += lines[i++] + '\n';
      out += `<pre><code>${code}</code></pre>`; i++; continue;
    }
    if (/^\|/.test(l) && /^\|[\s|:-]+\|?\s*$/.test(lines[i + 1] || '')) {
      const cells = r => r.replace(/^\||\|\s*$/g, '').split('|').map(c => inline(c.trim()));
      out += '<table><thead><tr>' + cells(l).map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && /^\|/.test(lines[i])) out += '<tr>' + cells(lines[i++]).map(c => `<td>${c}</td>`).join('') + '</tr>';
      out += '</tbody></table>'; continue;
    }
    let m;
    if ((m = l.match(/^(#{1,3}) (.*)/))) { const n = Math.max(2, m[1].length); out += `<h${n}>${inline(m[2])}</h${n}>`; i++; continue; }
    if (/^&gt; ?/.test(l)) {
      let q = '';
      while (i < lines.length && /^&gt; ?/.test(lines[i])) q += lines[i++].replace(/^&gt; ?/, '') + ' ';
      out += `<blockquote>${inline(q)}</blockquote>`; continue;
    }
    if (/^\s*[-*] /.test(l)) {
      out += '<ul>';
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) out += `<li>${inline(lines[i++].replace(/^\s*[-*] /, ''))}</li>`;
      out += '</ul>'; continue;
    }
    if (/^\d+\. /.test(l)) {
      out += '<ol>';
      while (i < lines.length && /^\d+\. /.test(lines[i])) out += `<li>${inline(lines[i++].replace(/^\d+\. /, ''))}</li>`;
      out += '</ol>'; continue;
    }
    if (!l.trim()) { i++; continue; }
    let p = '';
    while (i < lines.length && lines[i].trim() && !/^(```|\||#{1,3} |&gt;|\s*[-*] |\d+\. )/.test(lines[i])) p += lines[i++] + '\n';
    if (!p) { p = lines[i++]; }
    out += `<p>${inline(p.trim()).replace(/\n/g, '<br>')}</p>`;
  }
  return `<div class="md">${out}</div>`;
}
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- Temps réel ----------
function connectStream() {
  if (state.es) state.es.close();
  const es = new EventSource('/api/stream');
  state.es = es;
  es.addEventListener('hello', e => {
    const { connId } = JSON.parse(e.data);
    const changed = state.connId && state.connId !== connId;
    state.connId = connId;
    if (changed && meet.room) meetingReconnect();
  });
  es.addEventListener('notif', e => onNotif(JSON.parse(e.data)));
  es.addEventListener('meetings', e => {
    state.meetings = JSON.parse(e.data);
    renderSidebar();
    if (state.route?.name === 'reunions') renderMeetingList();
  });
  ['rtc_joined', 'rtc_left', 'rtc_signal', 'rtc_state', 'rtc_chat', 'rtc_react', 'rtc_closed']
    .forEach(t => es.addEventListener(t, e => onMeetingEvent(t, JSON.parse(e.data))));
  es.addEventListener('presence', e => {
    state.online = new Set(JSON.parse(e.data));
    if (state.route?.name === 'salon') renderMembers();
  });
  es.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (state.route?.name === 'salon' && +state.route.id === m.channel_id && state.view.kind === 'chat') {
      if (!state.view.messages.some(x => x.id === m.id)) { state.view.messages.push(m); renderMessages(true); }
    } else if (m.user_id !== state.user?.id) {
      state.unread[m.channel_id] = (state.unread[m.channel_id] || 0) + 1;
      renderSidebar();
    }
  });
  es.addEventListener('message_deleted', e => {
    const d = JSON.parse(e.data);
    if (state.view.messages) { state.view.messages = state.view.messages.filter(m => m.id !== d.id); renderMessages(); }
  });
  es.addEventListener('topic', e => {
    const d = JSON.parse(e.data);
    const r = state.route;
    if (r?.name === 'salon' && +r.id === d.channel_id && state.view.kind === 'forum') loadView();
    if (r?.name === 'sujet' && +r.id === d.topic_id) loadView();
  });
  es.addEventListener('channels', async () => { state.channels = await api('GET', '/api/channels'); renderSidebar(); });
}

// ---------- Routage ----------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(query || ''));
  const name = parts[0] || 'accueil';
  return { name, id: parts[1], q };
}
window.addEventListener('hashchange', () => {
  $('.shell')?.classList.remove('nav-open');
  if (!state.user) return renderAuth();
  if (state.user.must_change || state.user.needs_profile) return;
  route();
});

async function boot() {
  try { state.setup = await api('GET', '/api/setup'); } catch { state.setup = { filieres: [] }; }
  try {
    const { user } = await api('GET', '/api/me');
    state.user = user;
  } catch { state.user = null; }
  render();
}

function render() {
  if (!state.user || state.user.must_change || state.user.needs_profile) {
    if (state.es) { state.es.close(); state.es = null; }
    if (meet.room) leaveMeeting({ silent: true });
    return state.user ? renderGate() : renderAuth();
  }
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar"></aside>
      <main class="main">
        <header class="topbar"><button class="menu-btn" data-action="menu" aria-label="Menu">☰</button><div id="topbar-title"></div></header>
        <div class="content" id="content"></div>
      </main>
    </div>`;
  api('GET', '/api/channels').then(c => { state.channels = c; renderSidebar(); });
  api('GET', '/api/meetings').then(m => { state.meetings = m; renderSidebar(); }).catch(() => {});
  api('GET', '/api/meetings/config').then(c => { state.meetConfig = c; }).catch(() => {});
  api('GET', '/api/notifications').then(d => setUnread(d.unread)).catch(() => {});
  swRegistration();
  connectStream();
  route();
}

function route() {
  if (!state.user) return;
  state.route = parseRoute();
  if (state.route.name !== 'reunion' || state.route.id !== meet.room?.id) {
    if (meet.room) leaveMeeting();
  }
  if (state.route.name !== 'reunion') stopPreview();
  if (state.route.name === 'salon') delete state.unread[state.route.id];
  renderSidebar();
  loadView();
}

function setTitle(title, sub = '', actionsHtml = '') {
  $('#topbar-title').innerHTML = `<h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}`;
  $('#topbar-actions')?.remove();
  if (actionsHtml) $('#topbar-title').insertAdjacentHTML('afterend', `<div id="topbar-actions" class="topbar-actions">${actionsHtml}</div>`);
}
function setContent(html, { full = false } = {}) {
  const c = $('#content');
  c.style.padding = full ? '0' : '';
  c.style.overflow = full ? 'hidden' : '';
  c.innerHTML = full ? html : `<div class="wrap">${html}</div>`;
}

// ---------- Sidebar ----------
function renderSidebar() {
  const sb = $('#sidebar');
  if (!sb) return;
  const r = state.route || {};
  const link = (href, ico, label, active, badge) =>
    `<a class="nav-link ${active ? 'active' : ''}" href="${href}"><span class="ico">${ico}</span><span>${esc(label)}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</a>`;
  const isAdmin = state.user.role === 'admin';
  // Salons de la filière de l'élève en premier ; un modérateur voit tout, regroupé par filière
  const mine = state.channels.filter(c => c.filiere && c.filiere === state.user.filiere);
  const others = state.channels.filter(c => c.filiere && c.filiere !== state.user.filiere);
  const shared = state.channels.filter(c => !c.filiere);
  const chLink = c => c.kind === 'forum'
    ? link(`#/salon/${c.id}`, '💬', c.name, (r.name === 'salon' && +r.id === c.id) || (r.name === 'sujet' && state.view.topic?.channel_id === c.id))
    : link(`#/salon/${c.id}`, '#', c.name, r.name === 'salon' && +r.id === c.id, state.unread[c.id]);
  const groups = {};
  others.forEach(c => (groups[c.filiere_nom] ||= []).push(c));
  sb.innerHTML = `
    <div class="brand"><div class="logo">S</div><div>Classe SIO<small>CFA CEVEDOM</small></div></div>
    <div class="side-scroll">
      ${link('#/', '🏠', 'Accueil', r.name === 'accueil')}
      ${link('#/revisions', '📖', 'Révisions', r.name === 'revisions')}
      ${link('#/reunions', '🎥', 'Réunions', r.name === 'reunions' || r.name === 'reunion', (state.meetings || []).filter(m => m.count).length ? `<span class="live">● ${(state.meetings || []).filter(m => m.count).length}</span>` : '')}
      <a class="nav-link ${r.name === 'notifications' ? 'active' : ''}" href="#/notifications"><span class="ico">🔔</span><span>Notifications</span><span class="badge" id="notif-badge" ${state.unreadNotifs ? '' : 'hidden'}>${state.unreadNotifs > 99 ? '99+' : state.unreadNotifs || ''}</span></a>
      ${link('#/actus', '📰', 'Actus', r.name === 'actus')}
      ${link('#/infos', '🎓', 'CFA & examens', r.name === 'infos')}
      ${isAdmin ? link('#/admin', '🛠️', 'Modération', r.name === 'admin') : ''}
      ${mine.length ? `<div class="side-title">Ma filière · ${esc(state.user.filiere_nom || '')}</div>${mine.map(chLink).join('')}` : ''}
      <div class="side-title">Salons de tout le CFA</div>
      ${shared.filter(c => c.kind === 'chat').map(chLink).join('')}
      <div class="side-title">Forums de tout le CFA</div>
      ${shared.filter(c => c.kind === 'forum').map(chLink).join('')}
      ${Object.entries(groups).map(([nom, list]) => `<div class="side-title">${esc(nom)} <span class="pill" style="font-size:10px">modo</span></div>${list.map(chLink).join('')}`).join('')}
    </div>
    <div class="me-bar">
      ${avatar(state.user.display_name)}
      <div class="who"><b>${esc(state.user.display_name)}</b><span>${state.user.role === 'admin' ? 'Modérateur' : 'Élève'}</span></div>
      <a class="icon-btn" href="#/compte" title="Mon compte">⚙️</a>
      <button class="icon-btn" data-action="logout" title="Se déconnecter">⏻</button>
    </div>`;
}

// ---------- Délégation des clics ----------
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const handler = actions[a];
  if (handler) { e.preventDefault(); try { await handler(el, e); } catch (err) { toast(err.message); } }
});
const actions = {
  menu: () => $('.shell').classList.toggle('nav-open'),
  logout: async () => { await leaveMeeting({ silent: true }); await api('POST', '/api/logout'); state.user = null; location.hash = ''; render(); },
};

// ---------- Vues ----------
async function loadView() {
  const r = state.route;
  const views = { notifications: viewNotifications, accueil: viewHome, revisions: r.id ? viewSubject : viewSubjects, salon: viewChannel, sujet: viewTopic, reunions: viewMeetings, reunion: viewMeeting, actus: viewNews, infos: viewInfos, admin: viewAdmin, compte: viewAccount };
  const fn = views[r.name] || viewHome;
  try { await fn(r); } catch (err) { setContent(`<div class="empty">${esc(err.message)}</div>`); }
}

// Accueil
async function viewHome() {
  setTitle(`Salut ${esc(state.user.display_name)} 👋`, 'Ton tableau de bord');
  const d = await api('GET', '/api/dashboard');
  const days = Math.ceil((new Date(d.infos.examens.debut + 'T00:00:00') - new Date()) / 864e5);
  const u = state.user;
  const prompt = await pushPromptHtml();
  setContent(`
    ${prompt}
    ${u.expire_bientot ? `<div class="card" style="border-color:var(--gold);margin-bottom:16px">⏳ <b>Ton compte sera supprimé le ${new Date(u.expires_at).toLocaleDateString('fr-FR', { dateStyle: 'long' })}</b> (fin de ta formation + ${state.setup?.grace_days ?? 60} jours).
      <div class="small muted">Tu continues tes études ? Mets à jour ta filière dans <a href="#/compte">Mon compte</a>. Pense à copier les fiches que tu veux garder.</div></div>` : ''}
    <div class="grid grid-3">
      <div class="card countdown">
        <div class="small" style="opacity:.8">Premières épreuves écrites (${esc(d.infos.examens.session)})</div>
        <div class="stat">${days > 0 ? `J-${days}` : 'C’est parti !'}</div>
        <div class="small" style="opacity:.8">${new Date(d.infos.examens.debut + 'T12:00:00').toLocaleDateString('fr-FR', { dateStyle: 'long' })}</div>
      </div>
      <a class="card subject-card" href="#/revisions">
        <div class="muted small">Cartes à réviser</div>
        <div class="stat">${d.cartes_a_revoir}</div>
        <div class="small muted">sur ${d.cartes_total} cartes au total</div>
      </a>
      <a class="card subject-card" href="#/actus">
        <div class="muted small">Veille</div>
        <div class="stat">📰</div>
        <div class="small muted">Actus cyber, réseau, RGPD, Guyane, BTS</div>
      </a>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Derniers sujets du forum</h3>
        ${d.sujets.length ? d.sujets.map(t => `<a class="topic-row" style="padding:10px 0" href="#/sujet/${t.id}">
            <div style="flex:1">${esc(t.title)}<div class="small muted">💬 ${esc(t.channel)}</div></div>
            ${t.solved ? '<span class="pill ok">Résolu</span>' : ''}</a>`).join('') : '<p class="muted">Aucun sujet pour l’instant. Lance la discussion !</p>'}
      </div>
      <div class="card">
        <h3>Mes derniers quiz</h3>
        ${d.quiz.length ? d.quiz.map(q => `<div class="row" style="padding:6px 0"><span>${esc(q.subject)}</span><span class="spacer"></span>
            <span class="pill ${q.score / q.total >= .7 ? 'ok' : 'gold'}">${q.score}/${q.total}</span></div>`).join('') : '<p class="muted">Pas encore de quiz. <a href="#/revisions">Commencer</a></p>'}
      </div>
    </div>`);
  bindPushPrompt();
}

// Liste des matières
async function viewSubjects() {
  setTitle('Révisions', 'Fiches, cartes mémoire et quiz');
  const subjects = await api('GET', '/api/subjects');
  const groups = [...new Set(subjects.map(s => s.groupe))];
  setContent(groups.map(g => `
    <div class="section-title">${esc(g)}</div>
    <div class="grid grid-3">
      ${subjects.filter(s => s.groupe === g).map(s => `
        <a class="card subject-card" href="#/revisions/${s.id}">
          <div class="emoji">${s.icone}</div>
          <h3 style="margin-top:8px">${esc(s.nom)}</h3>
          <div class="small muted">${esc(s.description)}</div>
          <div class="row small muted" style="margin-top:10px">
            <span>📄 ${s.fiches}</span><span>🃏 ${s.cartes}</span><span>❓ ${s.quiz}</span>
            ${s.meilleur_quiz != null ? `<span class="spacer"></span><span class="pill ${s.meilleur_quiz >= .7 ? 'ok' : 'gold'}">Quiz ${Math.round(s.meilleur_quiz * 100)}%</span>` : ''}
          </div>
          <div class="progress" title="Cartes maîtrisées"><div style="width:${s.cartes ? Math.round(s.maitrise / s.cartes * 100) : 0}%"></div></div>
        </a>`).join('')}
    </div>`).join(''));
}

// Une matière
async function viewSubject(r) {
  const s = await api('GET', `/api/subjects/${r.id}`);
  state.view = { subject: s };
  const tab = r.q.tab || 'fiches';
  setTitle(`${s.icone} ${esc(s.nom)}`, esc(s.description));
  const tabs = [['fiches', 'Fiches'], ['cartes', 'Cartes mémoire'], ['quiz', 'Quiz'], ['classe', `Fiches de la classe (${s.communaute.length})`]];
  setContent(`
    <div class="row" style="margin-bottom:8px"><a href="#/revisions" class="small">← Toutes les matières</a></div>
    <div class="tabs">${tabs.map(([k, l]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/revisions/${s.id}?tab=${k}">${l}</a>`).join('')}</div>
    <div id="tab-body"></div>`);
  ({ fiches: tabFiches, cartes: tabCards, quiz: tabQuiz, classe: tabCommunity }[tab] || tabFiches)(s);
}

function tabFiches(s) {
  $('#tab-body').innerHTML = s.fiches.length ? s.fiches.map((f, i) => `
    <details class="card fiche" ${i === 0 ? 'open' : ''}>
      <summary>${esc(f.titre)}</summary>
      <div class="body">${md(f.contenu)}</div>
    </details>`).join('') : '<div class="empty">Pas encore de fiche.</div>';
}

function tabCards(s) {
  const prog = Object.fromEntries(s.progression.map(p => [p.card_key, p]));
  const now = Date.now();
  const all = s.cartes.map((c, i) => ({ ...c, key: `${s.id}:${i}`, p: prog[`${s.id}:${i}`] }));
  const due = shuffle(all.filter(c => !c.p || c.p.due <= now));
  const mastered = all.filter(c => c.p && c.p.box >= 4).length;
  let idx = 0, ok = 0;
  const body = $('#tab-body');
  const show = () => {
    if (!due.length) {
      body.innerHTML = `<div class="card empty">✅ Rien à revoir pour l'instant dans cette matière.<br><span class="small">${mastered}/${all.length} cartes maîtrisées. Reviens plus tard : les cartes reviennent à 1, 3, 7, 14, 30 puis 60 jours.</span>
        <div style="margin-top:14px"><button class="btn" id="all-cards">Réviser toutes les cartes quand même</button></div></div>`;
      $('#all-cards').onclick = () => { due.push(...shuffle(all)); show(); };
      return;
    }
    if (idx >= due.length) {
      body.innerHTML = `<div class="card empty"><div class="stat">${ok}/${due.length}</div>Session terminée !<div style="margin-top:14px"><a class="btn primary" href="#/revisions/${s.id}?tab=quiz">Passer au quiz</a></div></div>`;
      return;
    }
    const c = due[idx];
    body.innerHTML = `
      <div class="row small muted" style="justify-content:center;margin-bottom:12px">Carte ${idx + 1} / ${due.length} · ${mastered} maîtrisées</div>
      <div class="flash" id="flash"><div class="flash-inner">
        <div class="flash-face">${esc(c.recto)}<span class="hint">Clique pour retourner</span></div>
        <div class="flash-face back">${esc(c.verso)}</div>
      </div></div>
      <div class="row" style="justify-content:center;margin-top:18px">
        <button class="btn" id="c-no" disabled>😕 À revoir</button>
        <button class="btn primary" id="c-yes" disabled>👍 Je savais</button>
      </div>`;
    const flash = $('#flash');
    flash.onclick = () => { flash.classList.toggle('flipped'); $('#c-no').disabled = $('#c-yes').disabled = false; };
    const answer = async good => {
      try { await api('POST', '/api/cards/review', { key: c.key, ok: good }); } catch (e) { toast(e.message); }
      if (good) ok++;
      idx++; show();
    };
    $('#c-no').onclick = () => answer(false);
    $('#c-yes').onclick = () => answer(true);
  };
  show();
}

function tabQuiz(s) {
  const qs = shuffle(s.quiz);
  let idx = 0, score = 0;
  const body = $('#tab-body');
  if (!qs.length) { body.innerHTML = '<div class="empty">Pas de quiz pour cette matière.</div>'; return; }
  const show = () => {
    if (idx >= qs.length) {
      api('POST', '/api/quiz-results', { subject: s.id, score, total: qs.length }).catch(() => {});
      const pct = Math.round(score / qs.length * 100);
      body.innerHTML = `<div class="card empty"><div class="stat">${score}/${qs.length}</div>
        <p>${pct >= 80 ? 'Excellent 🔥' : pct >= 60 ? 'Pas mal, encore un effort 💪' : 'Relis les fiches et retente 📖'}</p>
        <div class="row" style="justify-content:center"><button class="btn primary" id="q-again">Recommencer</button><a class="btn" href="#/revisions/${s.id}?tab=fiches">Revoir les fiches</a></div></div>`;
      $('#q-again').onclick = () => tabQuiz(s);
      return;
    }
    const q = qs[idx];
    const order = shuffle(q.choix.map((c, i) => ({ c, i })));
    body.innerHTML = `
      <div class="card" style="max-width:640px;margin:0 auto">
        <div class="row small muted"><span>Question ${idx + 1} / ${qs.length}</span><span class="spacer"></span><span>Score : ${score}</span></div>
        <div class="progress"><div style="width:${idx / qs.length * 100}%"></div></div>
        <h3 style="margin:18px 0 10px">${esc(q.q)}</h3>
        ${order.map(o => `<button class="quiz-choice" data-i="${o.i}">${esc(o.c)}</button>`).join('')}
        <div id="q-after"></div>
      </div>`;
    $$('.quiz-choice', body).forEach(b => b.onclick = () => {
      const chosen = +b.dataset.i;
      const good = chosen === q.reponse;
      if (good) score++;
      $$('.quiz-choice', body).forEach(x => {
        x.disabled = true;
        if (+x.dataset.i === q.reponse) x.classList.add('good');
        else if (x === b) x.classList.add('bad');
      });
      $('#q-after').innerHTML = `<div class="explain"><b>${good ? '✅ Bonne réponse' : '❌ Raté'}</b> — ${esc(q.explication || '')}</div>
        <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" id="q-next">${idx + 1 < qs.length ? 'Suivante →' : 'Voir le score'}</button></div>`;
      $('#q-next').onclick = () => { idx++; show(); };
      $('#q-next').focus();
    });
  };
  show();
}

function tabCommunity(s) {
  const body = $('#tab-body');
  body.innerHTML = `
    <details class="card fiche" style="border-style:dashed">
      <summary>➕ Ajouter une fiche pour la classe</summary>
      <form id="fiche-form" class="body">
        <label>Titre</label><input type="text" name="title" maxlength="120" required>
        <label>Contenu <span class="muted small">(Markdown simple : **gras**, *italique*, ## titre, - liste, \`code\`, tableaux)</span></label>
        <textarea name="content" rows="10" required></textarea>
        <div class="row" style="margin-top:10px"><button class="btn primary">Publier</button></div>
      </form>
    </details>
    ${s.communaute.length ? s.communaute.map(f => `
      <details class="card fiche">
        <summary>${esc(f.title)} <span class="small muted" style="font-weight:400">— ${esc(f.display_name)}, ${fmtDate(f.created_at, false)}</span></summary>
        <div class="body">${md(f.content)}
          ${f.user_id === state.user.id || state.user.role === 'admin' ? `<button class="btn sm danger" data-del-fiche="${f.id}">Supprimer</button>` : ''}
        </div>
      </details>`).join('') : '<div class="empty">Aucune fiche partagée. Sois le premier !</div>'}`;
  $('#fiche-form').onsubmit = async e => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    try { await api('POST', '/api/fiches', { ...b, subject: s.id }); toast('Fiche publiée'); viewSubject(state.route); }
    catch (err) { toast(err.message); }
  };
  $$('[data-del-fiche]', body).forEach(b => b.onclick = async () => {
    if (!confirm('Supprimer cette fiche ?')) return;
    await api('DELETE', `/api/fiches/${b.dataset.delFiche}`); viewSubject(state.route);
  });
}

// ---------- Salons ----------
async function viewChannel(r) {
  let ch = state.channels.find(c => c.id === +r.id);
  if (!ch) { state.channels = await api('GET', '/api/channels'); ch = state.channels.find(c => c.id === +r.id); }
  if (!ch) throw new Error('Salon introuvable');
  state.view = { kind: ch.kind, channel: ch };
  return ch.kind === 'forum' ? viewForum(ch) : viewChat(ch);
}

async function viewChat(ch) {
  setTitle(`# ${esc(ch.name)}`, esc(ch.description), '<button class="btn sm primary" id="start-meet">🎥 Lancer une réunion</button>');
  $('#start-meet').onclick = async () => {
    try {
      const { id } = await api('POST', '/api/meetings', { name: `Réunion #${ch.name}` });
      await api('POST', `/api/channels/${ch.id}/messages`, { content: `📹 ${state.user.display_name} a lancé une réunion, rejoins-nous : ${location.origin}/#/reunion/${id}` });
      location.hash = `#/reunion/${id}`;
    } catch (err) { toast(err.message); }
  };
  state.view.messages = await api('GET', `/api/channels/${ch.id}/messages`);
  state.view.hasMore = state.view.messages.length === 50;
  setContent(`
    <div class="chat">
      <div class="chat-body">
        <div class="messages" id="messages"></div>
        <aside class="members" id="members"></aside>
      </div>
      <div class="composer">
        <form id="msg-form">
          <div class="att-list" hidden></div>
          <div class="composer-row">
            <button type="button" class="btn att-btn" title="Joindre un fichier — tu peux aussi glisser-déposer ou coller une capture">📎</button>
            <div class="composer-input"><textarea id="msg-input" placeholder="Écrire dans #${esc(ch.name)} — @ pour mentionner, Entrée pour envoyer" maxlength="2000"></textarea></div>
            <button class="btn primary">Envoyer</button>
          </div>
        </form>
      </div>
    </div>`, { full: true });
  renderMessages(true);
  renderMembers();
  const input = $('#msg-input');
  const box = bindAttach($('#msg-form'), input);
  bindMentions(input);
  const send = async () => {
    const content = input.value.trim();
    if (box.busy()) return toast('Attends la fin de l’envoi des fichiers');
    const attachments = box.ids();
    if (!content && !attachments.length) return;
    input.value = '';
    try {
      const m = await api('POST', `/api/channels/${ch.id}/messages`, { content, attachments });
      box.clear();
      if (!state.view.messages.some(x => x.id === m.id)) { state.view.messages.push(m); renderMessages(true); }
    } catch (err) { toast(err.message); input.value = content; }
  };
  $('#msg-form').onsubmit = e => { e.preventDefault(); send(); };
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  input.focus();
}

function renderMessages(scrollBottom = false) {
  const box = $('#messages');
  if (!box) return;
  const msgs = state.view.messages || [];
  let prev = null;
  const html = msgs.map(m => {
    const cont = prev && prev.user_id === m.user_id && m.created_at - prev.created_at < 5 * 60e3;
    prev = m;
    const canDel = m.user_id === state.user.id || state.user.role === 'admin';
    const forMe = new RegExp(`(^|[^\\w@])@${state.user.username.replace(/[.]/g, '\\.')}(?![\\w-])`, 'i').test(m.content || '');
    return `<div class="msg ${cont ? 'cont' : ''} ${forMe ? 'for-me' : ''}">
      ${avatar(m.display_name)}
      <div style="flex:1;min-width:0">
        ${cont ? '' : `<div class="meta"><b>${esc(m.display_name)}</b>${m.role === 'admin' ? '<span class="pill accent">modo</span> ' : ''}<span class="muted">${fmtDate(m.created_at)}</span></div>`}
        ${m.content ? `<div class="text">${linkify(mentionify(esc(m.content)))}</div>` : ''}
        ${renderAttachments(m.attachments)}
      </div>
      ${canDel ? `<button class="btn sm danger del" data-del-msg="${m.id}" title="Supprimer">✕</button>` : ''}
    </div>`;
  }).join('');
  box.innerHTML = (state.view.hasMore ? `<div style="text-align:center;margin-bottom:10px"><button class="btn sm" id="more">Charger les messages précédents</button></div>` : '')
    + (msgs.length ? html : `<div class="empty">Aucun message. Dis bonjour à la classe 👋</div>`);
  $$('[data-del-msg]', box).forEach(b => b.onclick = async () => {
    if (!confirm('Supprimer ce message ?')) return;
    await api('DELETE', `/api/messages/${b.dataset.delMsg}`).catch(e => toast(e.message));
  });
  $('#more')?.addEventListener('click', async () => {
    const older = await api('GET', `/api/channels/${state.view.channel.id}/messages?before=${msgs[0].id}`);
    state.view.hasMore = older.length === 50;
    state.view.messages = [...older, ...state.view.messages];
    const h = box.scrollHeight;
    renderMessages();
    box.scrollTop = box.scrollHeight - h;
  });
  if (scrollBottom) {
    box.scrollTop = box.scrollHeight;
    $$('img', box).forEach(img => !img.complete && img.addEventListener('load', () => { box.scrollTop = box.scrollHeight; }, { once: true }));
  }
}

async function renderMembers() {
  const box = $('#members');
  if (!box) return;
  const members = await api('GET', '/api/members').catch(() => []);
  members.forEach(m => m.online = state.online.has(m.id));
  members.sort((a, b) => b.online - a.online || a.display_name.localeCompare(b.display_name));
  const on = members.filter(m => m.online).length;
  box.innerHTML = `<div class="side-title" style="color:var(--muted);margin:0 0 8px">En ligne — ${on}</div>` +
    members.map(m => `<div class="member" style="${m.online ? '' : 'opacity:.55'}"><span class="dot ${m.online ? 'on' : ''}"></span>${esc(m.display_name)}${m.role === 'admin' ? ' <span class="pill accent">modo</span>' : m.filiere_nom ? ` <span class="pill">${esc(m.filiere_nom)}</span>` : ''}</div>`).join('');
}

// ---------- Forum ----------
async function viewForum(ch) {
  setTitle(`💬 ${esc(ch.name)}`, esc(ch.description));
  const topics = await api('GET', `/api/channels/${ch.id}/topics`);
  setContent(`
    <details class="card fiche" style="margin-bottom:16px">
      <summary>➕ Nouveau sujet</summary>
      <form id="topic-form" class="body">
        <label>Titre</label><input type="text" name="title" maxlength="120" required placeholder="Ex. : Je ne comprends pas le calcul du broadcast en /27">
        <label>Message</label><div class="composer-input"><textarea name="content" rows="6" required placeholder="Explique ce que tu as essayé, colle ta config… (@ pour mentionner quelqu’un)"></textarea></div>
        ${attachUi()}
        <div class="row" style="margin-top:10px"><button class="btn primary">Publier</button></div>
      </form>
    </details>
    <div class="card" style="padding:0">
      ${topics.length ? topics.map(t => `
        <a class="topic-row" href="#/sujet/${t.id}">
          ${avatar(t.display_name)}
          <div style="flex:1;min-width:0">
            <div><b>${t.pinned ? '📌 ' : ''}${esc(t.title)}</b></div>
            <div class="small muted">${esc(t.display_name)} · ${fmtDate(t.created_at, false)} · dernière activité ${fmtDate(t.last_activity)}</div>
          </div>
          ${t.solved ? '<span class="pill ok">Résolu</span>' : ''}
          ${t.files ? `<span class="pill">📎 ${t.files}</span>` : ''}
          <span class="pill">💬 ${t.replies}</span>
        </a>`).join('') : '<div class="empty">Aucun sujet. Lance la discussion !</div>'}
    </div>`);
  const tf = $('#topic-form');
  const tbox = bindAttach(tf, tf.content);
  bindMentions(tf.content);
  tf.onsubmit = async e => {
    e.preventDefault();
    if (tbox.busy()) return toast('Attends la fin de l’envoi des fichiers');
    try {
      const { id } = await api('POST', `/api/channels/${ch.id}/topics`, { ...Object.fromEntries(new FormData(tf)), attachments: tbox.ids() });
      location.hash = `#/sujet/${id}`;
    } catch (err) { toast(err.message); }
  };
}

async function viewTopic(r) {
  const t = await api('GET', `/api/topics/${r.id}`);
  state.view = { topic: t };
  renderSidebar();
  const mine = t.user_id === state.user.id, isAdmin = state.user.role === 'admin';
  setTitle(`${t.pinned ? '📌 ' : ''}${esc(t.title)}`, `💬 ${esc(t.channel_name)}`);
  const post = (name, role, date, content, del, atts) => `
    <div class="post">${avatar(name)}<div class="body">
      <div class="small"><b style="font-size:15px">${esc(name)}</b> ${role === 'admin' ? '<span class="pill accent">modo</span>' : ''} <span class="muted">${fmtDate(date)}</span> ${del || ''}</div>
      ${content ? md(content) : ''}
      ${renderAttachments(atts)}
    </div></div>`;
  setContent(`
    <div class="row" style="margin-bottom:12px">
      <a href="#/salon/${t.channel_id}" class="small">← Retour au forum</a><span class="spacer"></span>
      ${t.solved ? '<span class="pill ok">Résolu</span>' : ''}
      ${mine || isAdmin ? `<button class="btn sm" id="t-solve">${t.solved ? 'Marquer non résolu' : '✅ Marquer résolu'}</button>` : ''}
      ${isAdmin ? `<button class="btn sm" id="t-pin">${t.pinned ? 'Désépingler' : '📌 Épingler'}</button>` : ''}
      ${mine || isAdmin ? `<button class="btn sm danger" id="t-del">Supprimer</button>` : ''}
    </div>
    <div class="card">
      ${post(t.display_name, null, t.created_at, t.content, '', t.attachments)}
      ${t.replies.map(rp => post(rp.display_name, rp.role, rp.created_at, rp.content,
        rp.user_id === state.user.id || isAdmin ? `<button class="btn sm danger" data-del-reply="${rp.id}">✕</button>` : '', rp.attachments)).join('')}
    </div>
    <form id="reply-form" class="card" style="margin-top:16px">
      <label style="margin-top:0">Ta réponse</label>
      <div class="composer-input"><textarea name="content" rows="5" placeholder="@ pour mentionner quelqu’un"></textarea></div>
      ${attachUi()}
      <div class="row" style="margin-top:10px"><button class="btn primary">Répondre</button></div>
    </form>`);
  const rf = $('#reply-form');
  const rbox = bindAttach(rf, rf.content);
  bindMentions(rf.content);
  rf.onsubmit = async e => {
    e.preventDefault();
    if (rbox.busy()) return toast('Attends la fin de l’envoi des fichiers');
    try { await api('POST', `/api/topics/${t.id}/replies`, { content: rf.content.value, attachments: rbox.ids() }); viewTopic(r); }
    catch (err) { toast(err.message); }
  };
  $('#t-solve')?.addEventListener('click', async () => { await api('PATCH', `/api/topics/${t.id}`, { solved: !t.solved }); viewTopic(r); });
  $('#t-pin')?.addEventListener('click', async () => { await api('PATCH', `/api/topics/${t.id}`, { pinned: !t.pinned }); viewTopic(r); });
  $('#t-del')?.addEventListener('click', async () => {
    if (!confirm('Supprimer ce sujet et toutes ses réponses ?')) return;
    await api('DELETE', `/api/topics/${t.id}`); location.hash = `#/salon/${t.channel_id}`;
  });
  $$('[data-del-reply]').forEach(b => b.onclick = async () => {
    if (!confirm('Supprimer cette réponse ?')) return;
    await api('DELETE', `/api/replies/${b.dataset.delReply}`); viewTopic(r);
  });
}

// ---------- Actus ----------
async function viewNews(r) {
  setTitle('Actus', 'Veille : cybersécurité, systèmes & réseaux, droit, Guyane, BTS');
  setContent('<div class="empty">Récupération des actus…</div>');
  const n = await api('GET', '/api/news');
  const cat = r.q.cat || '';
  const cats = [...new Set([...n.alaune.map(a => a.categorie), ...n.flux.map(f => f.category)])];
  const items = n.flux.filter(f => !cat || f.category === cat);
  setContent(`
    <div class="section-title" style="margin-top:0">⭐ À la une (sélection)</div>
    <div class="grid grid-2">
      ${n.alaune.filter(a => !cat || a.categorie === cat).map(a => `
        <a class="card news-item" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">
          <div class="row small"><span class="pill accent">${esc(a.categorie)}</span><span class="muted">${esc(a.source)}${a.date ? ' · ' + fmtDate(a.date, false) : ''}</span></div>
          <h3 style="margin-top:8px">${esc(a.titre)}</h3>
          <div class="small muted">${esc(a.resume)}</div>
        </a>`).join('')}
    </div>
    <div class="section-title">📡 En direct des sources</div>
    <div class="row" style="margin-bottom:12px">
      <a class="btn sm ${!cat ? 'primary' : ''}" href="#/actus">Tout</a>
      ${cats.map(c => `<a class="btn sm ${c === cat ? 'primary' : ''}" href="#/actus?cat=${encodeURIComponent(c)}">${esc(c)}</a>`).join('')}
    </div>
    ${items.length ? `<div class="card" style="padding:0">${items.map(f => `
      <a class="topic-row news-item" href="${esc(f.link)}" target="_blank" rel="noopener noreferrer">
        <div style="flex:1;min-width:0">
          <div class="row small"><span class="pill">${esc(f.category)}</span><span class="muted">${esc(f.source)}${f.date ? ' · ' + fmtDate(f.date) : ''}</span></div>
          <h3 style="margin:6px 0 2px;font-size:15px">${esc(f.title)}</h3>
          ${f.summary ? `<div class="small muted">${esc(f.summary)}</div>` : ''}
        </div>
      </a>`).join('')}</div>` : `<div class="card empty">Aucune actu récupérée pour le moment (le serveur doit avoir accès à Internet).</div>`}
    ${n.indisponibles.length ? `<p class="small muted">Sources injoignables : ${n.indisponibles.map(esc).join(', ')}</p>` : ''}`);
}

// ---------- CFA & examens ----------
async function viewInfos() {
  setTitle('CFA & examens', 'CFA CEVEDOM · BTS session 2027');
  const { cfa, examens } = await api('GET', '/api/infos');
  const today = new Date().toISOString().slice(0, 10);
  setContent(`
    <div class="grid grid-2">
      <div class="card">
        <h2>🎓 ${esc(cfa.nom)}</h2>
        <p>${esc(cfa.description)}</p>
        <p><b>Rythme :</b> ${esc(cfa.rythme)}</p>
        <h3>Horaires d'accueil</h3>
        <ul>${cfa.horaires.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
        <h3>Liens</h3>
        <ul>${cfa.sites.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.titre)}</a></li>`).join('')}</ul>
      </div>
      <div class="card">
        <h2>📅 ${esc(examens.session)}</h2>
        <div class="timeline">
          ${examens.dates.map(d => `<div class="ev ${d.date < today ? 'past' : ''}"><b>${new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR', { dateStyle: 'long' })}</b><div>${esc(d.titre)}</div></div>`).join('')}
        </div>
        <p class="small muted">${esc(examens.note)}<br>Source : <a href="${esc(examens.source.url)}" target="_blank" rel="noopener noreferrer">${esc(examens.source.titre)}</a></p>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>⚖️ Tes droits d'apprenti</h3>
      <ul>${cfa.droits_apprenti.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
      <p class="small muted">${esc(cfa.source)}</p>
    </div>`);
}

boot();
