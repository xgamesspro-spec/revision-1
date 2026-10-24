'use strict';
/* Interface vivante : thème, sons, confettis, +XP, recherche rapide (Ctrl+K), raccourcis, rafraîchissement en direct. */

// ---------- Préférences de cet appareil (thème, sons, animations) ----------
const fxPrefs = (() => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('fxPrefs') || '{}'); } catch { /* stockage indisponible */ }
  return { theme: 'auto', sound: false, motion: true, ...p };
})();
function saveFxPrefs() { try { localStorage.setItem('fxPrefs', JSON.stringify(fxPrefs)); } catch { /* ignoré */ } applyFxPrefs(); }
function applyFxPrefs() {
  const h = document.documentElement;
  if (fxPrefs.theme === 'auto') delete h.dataset.theme; else h.dataset.theme = fxPrefs.theme;
  h.classList.toggle('no-motion', !fxPrefs.motion);
}
applyFxPrefs();
const motionOk = () => fxPrefs.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Sons (générés, aucun fichier à télécharger) ----------
let audioCtx;
function beep(kind = 'pop') {
  if (!fxPrefs.sound) return;
  try {
    audioCtx ||= new AudioContext();
    const notes = { pop: [[660, .06]], message: [[520, .07], [780, .09]], ok: [[660, .08], [880, .12]], ko: [[300, .15]], levelup: [[523, .1], [659, .1], [784, .1], [1047, .2]], notif: [[880, .08], [660, .1]] }[kind] || [[600, .06]];
    let t = audioCtx.currentTime;
    for (const [f, d] of notes) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + d + .02);
      t += d * .9;
    }
  } catch { /* son indisponible */ }
}

// ---------- Confettis ----------
function confetti(n = 120) {
  if (!motionOk()) return;
  const cv = document.createElement('canvas');
  cv.className = 'confetti';
  cv.width = innerWidth; cv.height = innerHeight;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const colors = ['#14b8a6', '#d99a1e', '#3b6fd4', '#c2413b', '#2e8b57', '#8a5cd1'];
  const ps = Array.from({ length: n }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight / 3, vx: (Math.random() - .5) * 14, vy: -Math.random() * 12 - 4,
    r: 4 + Math.random() * 5, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6, va: (Math.random() - .5) * .3,
  }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of ps) {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
    }
    if (++frames < 150) requestAnimationFrame(tick); else cv.remove();
  })();
}

// ---------- +XP flottant, niveau, badges ----------
function onXp(d) {
  if (d.gained) {
    const el = document.createElement('div');
    el.className = 'xp-float';
    el.textContent = `+${d.gained} XP`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
    beep('pop');
  }
  if (d.level_up) {
    confetti(180); beep('levelup');
    showDialog(`<div style="text-align:center"><div style="font-size:56px">⭐</div><h2 style="margin:6px 0">Niveau ${d.level} !</h2>
      <p>Tu es maintenant <b>${esc(d.title)}</b>. Continue comme ça 💪</p></div>`);
  }
  for (const b of d.badges || []) {
    setTimeout(() => {
      const t = document.createElement('div');
      t.className = 'toast toast-badge';
      t.innerHTML = `<span style="font-size:28px">${b.ico}</span><span><b>Badge débloqué : ${esc(b.nom)}</b><br><span class="small">${esc(b.desc)}</span></span>`;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 4500);
      if (!d.level_up) confetti(60);
    }, 400);
  }
  state.progress = { ...(state.progress || {}), xp: d.xp, level: d.level, title: d.title, from: d.from, to: d.to, streak: { ...(state.progress?.streak || {}), current: d.streak } };
  renderMiniXp();
}
// Petit indicateur de niveau dans la barre latérale
function renderMiniXp() {
  const box = document.getElementById('mini-xp');
  const p = state.progress;
  if (!box || !p || p.plays === false) { if (box) box.hidden = true; return; }
  box.hidden = false;
  const pct = Math.max(0, Math.min(100, Math.round((p.xp - p.from) / Math.max(1, p.to - p.from) * 100)));
  box.innerHTML = `<a href="#/progression" title="${p.xp} XP — ${esc(p.title)}"><span>⭐ Niv. ${p.level}</span><span class="mini-bar"><span style="width:${pct}%"></span></span><span>🔥 ${p.streak?.current || 0}</span></a>`;
}

// ---------- Rafraîchissement en direct sans perdre ce qu'on tape ----------
function userIsBusy() {
  const a = document.activeElement;
  if (document.querySelector('dialog[open]')) return true;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#content')) return true;
  return [...document.querySelectorAll('#content textarea, #content input[type=text]')].some(el => el.value && !el.readOnly);
}
let pendingRefresh = null;
function softRefresh(fn, label = 'Du nouveau sur cette page') {
  const run = () => Promise.resolve().then(fn).catch(err => { if (!(err instanceof StaleView)) console.warn(err); });
  if (!userIsBusy()) { pendingRefresh = null; document.getElementById('refresh-pill')?.remove(); return run(); }
  pendingRefresh = run;
  if (document.getElementById('refresh-pill')) return;
  const b = document.createElement('button');
  b.id = 'refresh-pill'; b.className = 'refresh-pill';
  b.textContent = `🔄 ${label} — afficher`;
  b.onclick = () => { b.remove(); const f = pendingRefresh; pendingRefresh = null; f && f(); };
  document.body.appendChild(b);
}
window.addEventListener('hashchange', () => { document.getElementById('refresh-pill')?.remove(); pendingRefresh = null; });

// ---------- Recherche rapide (Ctrl+K) ----------
async function paletteItems() {
  const r = state.user?.role;
  const items = [
    ['🏠', 'Accueil', '#/'], ['🗓️', 'Planning', '#/planning'], ['📝', 'Exercices', '#/exercices'], ['📖', 'Révisions', '#/revisions'],
    ['🏆', 'Progression, défi du jour, duels', '#/progression'], ['🔔', 'Notifications', '#/notifications'], ['📰', 'Actus', '#/actus'],
    ['🎓', 'CFA & examens', '#/infos'], ['💡', 'Boîte à idées', '#/idees'], ['❓', 'Guide d’utilisation', '#/guide'], ['⚙️', 'Mon compte', '#/compte'],
  ];
  if (r !== 'prof') items.splice(4, 0, ['🎥', 'Réunions', '#/reunions']);
  if (r === 'admin') items.push(['🛠️', 'Modération', '#/admin']);
  for (const c of state.channels || []) items.push([c.kind === 'forum' ? '💬' : '#', c.name, `#/salon/${c.id}`]);
  try {
    state.subjectsCache ||= await api('GET', '/api/subjects');
    for (const s of state.subjectsCache) items.push([s.icone, `Révisions : ${s.nom}`, `#/revisions/${s.id}`]);
  } catch { /* ignoré */ }
  return items;
}
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
async function openPalette() {
  if (!state.user || document.querySelector('.palette')) return;
  const items = await paletteItems();
  const d = document.createElement('dialog');
  d.className = 'card dialog palette';
  d.innerHTML = `<input type="text" placeholder="Aller à… (page, salon, matière)" id="pal-q" autocomplete="off"><div class="pal-list" id="pal-list"></div>
    <div class="small muted" style="margin-top:8px">↑ ↓ pour choisir · Entrée pour ouvrir · Échap pour fermer</div>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  const q = d.querySelector('#pal-q'), list = d.querySelector('#pal-list');
  let sel = 0, shown = items;
  const draw = () => {
    const t = norm(q.value.trim());
    shown = items.filter(i => !t || norm(i[1]).includes(t)).slice(0, 12);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((i, k) => `<a class="pal-item ${k === sel ? 'sel' : ''}" href="${i[2]}"><span>${i[0]}</span>${esc(i[1])}</a>`).join('') || '<div class="muted small">Aucun résultat</div>';
    list.querySelectorAll('a').forEach(a => a.onclick = () => d.close());
  };
  q.oninput = () => { sel = 0; draw(); };
  q.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % Math.max(1, shown.length); draw(); }
    if (e.key === 'Enter' && shown[sel]) { location.hash = shown[sel][2]; d.close(); }
  };
  draw();
}
function openShortcuts() {
  showDialog(`<h3 style="margin-top:0">⌨️ Raccourcis clavier</h3><table class="keys">
    ${[['Ctrl + K', 'Recherche rapide'], ['?', 'Cette aide'], ['Entrée / Maj + Entrée', 'Envoyer / aller à la ligne'], ['↑ (zone vide)', 'Modifier ton dernier message'],
      ['Échap', 'Annuler réponse / modification, fermer'], ['← / →', 'Mois précédent / suivant (planning)'], ['1 à 4', 'Choisir une réponse (quiz, défi, duel)'],
      ['M / V', 'Micro / caméra (réunion)']].map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>`);
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (!typing && e.key === '?' && !document.querySelector('dialog[open]')) { e.preventDefault(); openShortcuts(); }
});

// ---------- Retour visuel au clic ----------
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.btn, .quiz-choice, .ctl, .chip, .react-pill');
  if (!b || !motionOk()) return;
  b.classList.remove('pressed'); void b.offsetWidth; b.classList.add('pressed');
  setTimeout(() => b.classList.remove('pressed'), 250);
});

// ---------- Glisser (mobile) ----------
function onSwipe(el, left, right) {
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? left : right)();
    x0 = null;
  }, { passive: true });
}
