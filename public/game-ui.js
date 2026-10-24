'use strict';
/* Progression : niveau, série 🔥, badges, défi du jour, duels, classement. */

const fmtMs = ms => ms == null ? '' : ms < 60e3 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60e3)} min ${Math.round(ms % 60e3 / 1000)} s`;

async function loadProgress() {
  try { state.progress = await api('GET', '/api/progress'); renderMiniXp(); } catch { /* ignoré */ }
  return state.progress;
}

function levelCard(p) {
  const pct = Math.max(0, Math.min(100, Math.round((p.xp - p.from) / Math.max(1, p.to - p.from) * 100)));
  return `<div class="card level-card">
    <div class="row"><div class="lvl-badge">${p.level}</div>
      <div style="flex:1;min-width:0"><div class="small" style="opacity:.8">Niveau ${p.level}</div><div style="font-size:20px;font-weight:750">${esc(p.title)}</div>
        <div class="xp-bar"><div style="width:${pct}%"></div></div>
        <div class="small" style="opacity:.85">${p.xp} XP · encore ${Math.max(0, p.to - p.xp)} XP pour le niveau ${p.level + 1}</div></div>
      <div class="streak ${p.streak.current ? 'on' : ''}" title="Jours de révision d’affilée"><span class="flame">🔥</span><b>${p.streak.current}</b><span class="small">jour${p.streak.current > 1 ? 's' : ''}</span></div>
    </div>
    ${p.streak.at_risk ? '<div class="small streak-risk">⚠️ Révise aujourd’hui pour garder ta série !</div>' : ''}
  </div>`;
}

// Petit encart sur l'accueil
async function homeGameWidget() {
  const p = await loadProgress();
  if (!p?.plays) return '';
  return `<div class="grid grid-2" style="margin-bottom:16px">
    ${levelCard(p)}
    <div class="card daily-cta ${p.daily_done ? 'done' : ''}">
      <div class="row"><span style="font-size:32px">🎯</span><div style="flex:1"><b>Défi du jour</b>
        <div class="small muted">${p.daily_done ? `Fait : ${p.daily_score}/5. Reviens demain !` : '5 questions, les mêmes pour toute la classe. Une seule tentative.'}</div></div>
        <a class="btn ${p.daily_done ? '' : 'primary'}" href="#/progression?tab=defi">${p.daily_done ? 'Classement' : 'Jouer'}</a></div>
      ${p.duels_todo ? `<div class="row" style="margin-top:10px"><span style="font-size:24px">⚔️</span><span style="flex:1"><b>${p.duels_todo} duel${p.duels_todo > 1 ? 's' : ''}</b> t’attend${p.duels_todo > 1 ? 'ent' : ''}</span><a class="btn sm" href="#/progression?tab=duels">Voir</a></div>` : ''}
    </div></div>`;
}

async function viewProgression(r) {
  const p = await loadProgress();
  const staff = ['admin', 'prof'].includes(state.user.role);
  const tab = r.q.tab || (p.plays ? 'apercu' : 'classement');
  setTitle('🏆 Progression', p.plays ? 'Gagne de l’XP en révisant, garde ta série et défie la classe' : 'Classement des élèves par filière');
  const tabs = [...(p.plays ? [['apercu', 'Aperçu'], ['defi', '🎯 Défi du jour'], ['duels', `⚔️ Duels${p.duels_todo ? ` (${p.duels_todo})` : ''}`], ['badges', '🏅 Badges']] : []), ['classement', '📊 Classement']];
  setContent(`<div class="tabs">${tabs.map(([k, l]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/progression?tab=${k}">${l}</a>`).join('')}</div><div id="game-body" class="fade-in"></div>`);
  const body = $('#game-body');
  if (tab === 'apercu') {
    body.innerHTML = `${levelCard(p)}
      <div class="grid grid-3" style="margin-top:16px">
        <div class="card"><div class="muted small">Aujourd’hui</div><div class="stat">+${p.today}</div><div class="small muted">XP</div></div>
        <div class="card"><div class="muted small">7 derniers jours</div><div class="stat">+${p.week}</div><div class="small muted">XP</div></div>
        <div class="card"><div class="muted small">Badges</div><div class="stat">${p.badges.filter(b => b.got).length}/${p.badges.length}</div><div class="small muted">débloqués</div></div>
      </div>
      <div class="card" style="margin-top:16px"><h3>Comment gagner de l’XP ?</h3>
        <div class="grid grid-2 small">
          <div>🃏 Carte mémoire : <b>+2</b> (ou +1 si à revoir)</div><div>❓ Quiz : <b>+3 par bonne réponse</b>, +15 si sans faute</div>
          <div>🎯 Défi du jour : <b>+10 par bonne réponse</b>, +20 si 5/5</div><div>⚔️ Duel : <b>+10</b> en jouant, +3 par bonne réponse, <b>+25</b> au gagnant</div>
          <div>💬 Répondre sur le forum : <b>+5</b></div><div>📝 Rendre un exercice : <b>+20</b> · 📄 Partager une fiche : <b>+15</b></div>
        </div>
        <p class="small muted">Plafond de points par jour pour chaque activité. Révise un peu chaque jour pour faire grandir ta série 🔥.</p>
        <label class="toggle small"><input type="checkbox" id="hide-rank" ${p.hide_rank ? 'checked' : ''}> Ne pas apparaître dans le classement</label>
      </div>`;
    $('#hide-rank').onchange = e => api('POST', '/api/progress/prefs', { hide_rank: e.target.checked }).then(() => toast('Enregistré'));
  } else if (tab === 'badges') {
    body.innerHTML = `<div class="badge-grid">${p.badges.map(b => `<div class="badge-card ${b.got ? 'got' : ''}" title="${esc(b.desc)}">
      <div class="b-ico">${b.got ? b.ico : '🔒'}</div><b>${esc(b.nom)}</b><div class="small muted">${esc(b.desc)}</div>
      ${b.got ? `<div class="small" style="color:var(--ok)">✓ ${fmtDate(b.at, false)}</div>` : ''}</div>`).join('')}</div>`;
  } else if (tab === 'defi') {
    await renderDaily(body);
  } else if (tab === 'duels') {
    await renderDuels(body);
  } else {
    await renderBoard(body, r.q.period || 'week', r.q.filiere || (staff ? state.setup?.filieres?.[0]?.id : ''));
  }
}

// ---------- Jeu de questions commun (défi + duel) ----------
function playQuestions(box, questions, { title, onDone }) {
  const answers = [];
  let idx = 0;
  const t0 = Date.now();
  const show = () => {
    const q = questions[idx];
    box.innerHTML = `<div class="card play-card fade-in">
      <div class="row small muted"><span>${esc(title)}</span><span class="spacer"></span><span id="play-timer">0 s</span></div>
      <div class="progress"><div style="width:${idx / questions.length * 100}%"></div></div>
      <div class="small muted" style="margin-top:14px">Question ${idx + 1} / ${questions.length} · ${esc(q.subject || '')}</div>
      <h3 style="margin:6px 0 10px">${esc(q.q)}</h3>
      ${q.choix.map((c, k) => `<button class="quiz-choice" data-i="${c.i}"><kbd>${k + 1}</kbd> ${esc(c.c)}</button>`).join('')}
    </div>`;
    $$('.quiz-choice', box).forEach(b => b.onclick = () => {
      answers[idx] = +b.dataset.i;
      b.classList.add('chosen');
      $$('.quiz-choice', box).forEach(x => x.disabled = true);
      beep('pop');
      setTimeout(() => { idx++; idx < questions.length ? show() : finish(); }, 280);
    });
  };
  const timer = setInterval(() => { const el = $('#play-timer'); if (!el) return clearInterval(timer); el.textContent = fmtMs(Date.now() - t0); }, 500);
  const key = e => {
    if (!box.isConnected) return document.removeEventListener('keydown', key);
    const n = +e.key;
    if (n >= 1 && n <= 9) $$('.quiz-choice', box)[n - 1]?.click();
  };
  document.addEventListener('keydown', key);
  const finish = async () => {
    clearInterval(timer);
    document.removeEventListener('keydown', key);
    box.innerHTML = '<div class="card empty">Correction…</div>';
    try { await onDone(answers); } catch (e) { toast(e.message); }
  };
  show();
}
function corrections(details) {
  return details.map((d, k) => `<div class="corr ${d.ok ? 'ok' : 'ko'}"><b>${k + 1}. ${esc(d.q)}</b><br>
    ${d.ok ? '✅' : '❌'} ${esc(d.bonne)}${d.explication ? `<div class="small muted">${esc(d.explication)}</div>` : ''}</div>`).join('');
}
function scoreBlock(score, total, ms, xp) {
  if (score === total) { confetti(160); beep('levelup'); } else beep(score >= total / 2 ? 'ok' : 'ko');
  return `<div class="card score-card fade-in"><div class="big-score">${score}<span>/${total}</span></div>
    <div class="muted">${ms != null ? `en ${fmtMs(ms)}` : ''}${xp ? ` · <b style="color:var(--ok)">+${xp} XP</b>` : ''}</div>
    <p>${score === total ? 'Sans faute, bravo ! 🔥' : score >= total * .6 ? 'Bien joué 💪' : 'Courage, relis les fiches 📖'}</p></div>`;
}

// ---------- Défi du jour ----------
function boardTable(board) {
  return board.length ? `<table class="board">${board.map(b => `<tr class="${b.me ? 'me' : ''}"><td>${b.rank <= 3 ? ['🥇', '🥈', '🥉'][b.rank - 1] : b.rank}</td><td>${esc(b.name)}</td><td><b>${b.score}/${b.total}</b></td><td class="muted small">${fmtMs(b.ms)}</td></tr>`).join('')}</table>`
    : '<p class="muted small">Personne n’a encore joué aujourd’hui. Sois le premier !</p>';
}
async function renderDaily(box) {
  const d = await api('GET', '/api/daily');
  if (d.done) {
    box.innerHTML = `<div class="grid grid-2" style="align-items:start">
      <div>${scoreBlock(d.score, d.total, d.ms, 0).replace('fade-in', '')}<div class="card" style="margin-top:12px"><h3>Correction</h3>${corrections(d.details)}</div></div>
      <div class="card"><h3>🏁 Classement du jour</h3>${boardTable(d.board)}<p class="small muted">Nouveau défi demain à minuit.</p></div></div>`;
    return;
  }
  if (!d.started) {
    box.innerHTML = `<div class="grid grid-2" style="align-items:start">
      <div class="card daily-start"><div style="font-size:48px">🎯</div><h2>Défi du jour</h2>
        <p>${d.count} questions tirées dans toutes les matières, <b>les mêmes pour toute la classe</b>.<br>Une seule tentative : le chrono démarre quand tu cliques.</p>
        <button class="btn primary big" id="daily-go">C’est parti !</button></div>
      <div class="card"><h3>🏁 Classement du jour</h3>${boardTable(d.board)}</div></div>`;
    $('#daily-go').onclick = () => startDaily(box);
    return;
  }
  startDaily(box); // déjà commencé (page rechargée)
}
async function startDaily(box) {
  const d = await api('GET', '/api/daily?start=1');
  if (d.done) return renderDaily(box);
  playQuestions(box, d.questions, {
    title: '🎯 Défi du jour',
    onDone: async answers => {
      const r = await api('POST', '/api/daily', { answers });
      box.innerHTML = `<div class="grid grid-2" style="align-items:start"><div>${scoreBlock(r.score, r.total, r.ms, r.xp)}
        <div class="card" style="margin-top:12px"><h3>Correction</h3>${corrections(r.details)}</div></div>
        <div class="card"><h3>🏁 Classement du jour</h3>${boardTable(r.board)}</div></div>`;
      loadProgress();
    },
  });
}

// ---------- Duels ----------
async function renderDuels(box) {
  const [duels, members, subjects] = await Promise.all([api('GET', '/api/duels'), membersCache(), state.subjectsCache || api('GET', '/api/subjects')]);
  state.subjectsCache = subjects;
  const others = members.filter(m => m.id !== state.user.id && m.role !== 'prof');
  const label = d => d.status === 'done' ? (d.won ? '<span class="pill ok">Gagné 🏆</span>' : d.won === false ? '<span class="pill" style="color:var(--danger)">Perdu</span>' : '<span class="pill">Égalité</span>')
    : d.status === 'declined' ? '<span class="pill">Refusé</span>' : d.status === 'expired' ? '<span class="pill">Expiré</span>'
    : d.played ? '<span class="pill gold">En attente de l’adversaire</span>' : '<span class="pill accent">À toi de jouer</span>';
  box.innerHTML = `<div class="grid grid-2" style="align-items:start">
    <form class="card" id="duel-form"><h3 style="margin-top:0">⚔️ Lancer un duel</h3>
      <p class="small muted">5 questions, les mêmes pour vous deux. Chacun joue quand il veut (3 jours max). Le meilleur score gagne, le plus rapide en cas d’égalité.</p>
      <label>Adversaire</label><select name="opponent_id" required><option value="">— Choisir —</option>${others.map(m => `<option value="${m.id}">${esc(m.display_name)}${m.filiere_nom ? ` (${esc(m.filiere_nom)})` : ''}${m.online ? ' 🟢' : ''}</option>`).join('')}</select>
      <label>Matière</label><select name="subject"><option value="">🎲 Toutes matières</option>${subjects.filter(s => s.quiz >= 5).map(s => `<option value="${s.id}">${s.icone} ${esc(s.nom)}</option>`).join('')}</select>
      <button class="btn primary" style="margin-top:12px">Défier</button></form>
    <div class="card"><h3 style="margin-top:0">Mes duels</h3>
      ${duels.length ? duels.map(d => `<div class="duel-row">
        <div style="flex:1;min-width:0"><b>${d.i_challenged ? 'Toi' : esc(d.opponent)}</b> vs <b>${d.i_challenged ? esc(d.opponent) : 'toi'}</b>
          <div class="small muted">${esc(d.sujet_nom)} · ${fmtDate(d.created_at)}${d.status === 'done' ? ` · ${d.my_score} – ${d.their_score}` : d.played ? ` · ton score : ${d.my_score}/5` : ''}</div></div>
        ${label(d)}
        ${d.status === 'pending' && !d.played ? `<button class="btn sm primary" data-play="${d.id}">Jouer</button>${!d.i_challenged ? `<button class="btn sm" data-decline="${d.id}">Refuser</button>` : ''}` : ''}
      </div>`).join('') : '<p class="muted small">Aucun duel pour l’instant.</p>'}</div></div>`;
  $('#duel-form').onsubmit = async e => {
    e.preventDefault();
    try { await api('POST', '/api/duels', Object.fromEntries(new FormData(e.target))); toast('Défi envoyé ⚔️'); renderDuels(box); } catch (err) { toast(err.message); }
  };
  $$('[data-decline]', box).forEach(b => b.onclick = async () => { await api('POST', `/api/duels/${b.dataset.decline}/decline`); renderDuels(box); });
  $$('[data-play]', box).forEach(b => b.onclick = async () => {
    try {
      const g = await api('GET', `/api/duels/${b.dataset.play}/play`);
      playQuestions(box, g.questions, {
        title: `⚔️ Duel contre ${g.opponent}`,
        onDone: async answers => {
          const r = await api('POST', `/api/duels/${g.id}/answers`, { answers });
          box.innerHTML = `${scoreBlock(r.score, r.total, r.ms, r.xp)}
            <div class="card" style="margin-top:12px">${r.duel.status === 'done'
              ? `<h3>${r.duel.won ? '🏆 Victoire !' : r.duel.won === false ? 'Défaite… revanche ?' : 'Égalité parfaite !'}</h3><p>${r.duel.my_score} – ${r.duel.their_score} contre ${esc(r.duel.opponent)}</p>`
              : `<p>⏳ En attente de ${esc(r.duel.opponent)}. Tu seras prévenu du résultat.</p>`}
              <h3>Correction</h3>${corrections(r.details)}<a class="btn" href="#/progression?tab=duels">Retour aux duels</a></div>`;
          loadProgress();
        },
      });
    } catch (err) { toast(err.message); }
  });
}

// ---------- Classement ----------
async function renderBoard(box, period, filiere) {
  const staff = ['admin', 'prof'].includes(state.user.role);
  const d = await api('GET', `/api/leaderboard?period=${period}${filiere ? `&filiere=${filiere}` : ''}`);
  const podium = d.list.slice(0, 3);
  box.innerHTML = `<div class="row" style="margin-bottom:12px">
      <div class="seg"><a class="${period === 'week' ? 'on' : ''}" href="#/progression?tab=classement&period=week${filiere ? `&filiere=${filiere}` : ''}">Cette semaine</a><a class="${period === 'all' ? 'on' : ''}" href="#/progression?tab=classement&period=all${filiere ? `&filiere=${filiere}` : ''}">Depuis le début</a></div>
      ${staff ? `<select id="lb-fil" style="width:auto">${state.setup.filieres.map(f => `<option value="${f.id}" ${d.filiere === f.id ? 'selected' : ''}>${esc(f.nom)}</option>`).join('')}</select>` : `<span class="pill">${esc(d.filiere_nom || '')}</span>`}
    </div>
    ${podium.length ? `<div class="podium">${[1, 0, 2].map(i => podium[i] ? `<div class="pod p${i + 1} ${podium[i].me ? 'me' : ''}"><div class="pod-ava">${avatar(podium[i].name)}</div><b>${esc(podium[i].name)}</b><span class="small">${podium[i].xp} XP</span><div class="pod-step">${['🥇', '🥈', '🥉'][i]}</div></div>` : '<div></div>').join('')}</div>` : ''}
    <div class="card" style="padding:0">${d.list.length ? `<table class="board wide">${d.list.map(e => `<tr class="${e.me ? 'me' : ''}"><td>${e.rank}</td><td>${avatar(e.name)}</td><td><b>${esc(e.name)}</b></td><td class="small">⭐ ${e.level}</td><td class="small">🔥 ${e.streak}</td><td><b>${e.xp}</b> XP</td></tr>`).join('')}</table>`
      : '<div class="empty">Pas encore de points dans cette filière.</div>'}</div>
    <p class="small muted">Seuls les élèves d’une même filière sont comparés. Chacun peut choisir de ne pas apparaître (onglet Aperçu).</p>`;
  $('#lb-fil')?.addEventListener('change', e => { location.hash = `#/progression?tab=classement&period=${period}&filiere=${e.target.value}`; });
}
