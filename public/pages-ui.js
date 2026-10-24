'use strict';
/* Boîte à idées (élèves / formateurs séparés) et guide d'utilisation par rôle. */

// ---------- Boîte à idées ----------
const IDEA_STATUS_CLASS = { nouvelle: '', etudiee: 'accent', prevue: 'gold', faite: 'ok', refusee: '' };
const ideasState = { sort: 'top', status: '', box: null };

async function viewIdeas(r) {
  const isAdmin = state.user.role === 'admin';
  if (r.q.box) ideasState.box = r.q.box;
  const qs = new URLSearchParams({ sort: ideasState.sort, ...(ideasState.status ? { status: ideasState.status } : {}), ...(ideasState.box ? { box: ideasState.box } : {}) });
  const d = await api('GET', `/api/ideas?${qs}`);
  ideasState.box = d.box;
  const boxName = d.box === 'profs' ? 'des formateurs' : 'des élèves';
  setTitle('💡 Boîte à idées', isAdmin ? 'Les propositions des élèves et des formateurs' : `Ce que tu aimerais voir dans Classe CEVEDOM — boîte ${boxName}`);
  setContent(`
    ${isAdmin ? `<div class="tabs">${d.boxes.map(b => `<a class="tab ${b === d.box ? 'active' : ''}" href="#/idees?box=${b}">${b === 'profs' ? '👨‍🏫 Formateurs' : '🎓 Élèves'}</a>`).join('')}</div>` : ''}
    <div class="grid idea-layout">
      <div>
        <div class="row" style="margin-bottom:12px">
          <div class="seg"><button data-sort="top" class="${ideasState.sort === 'top' ? 'on' : ''}">🔥 Populaires</button><button data-sort="new" class="${ideasState.sort === 'new' ? 'on' : ''}">🆕 Récentes</button></div>
          <select id="idea-status" style="width:auto"><option value="">Tous les statuts</option>${Object.entries(d.statuses).map(([k, v]) => `<option value="${k}" ${ideasState.status === k ? 'selected' : ''}>${v} (${d.counts[k]})</option>`).join('')}</select>
        </div>
        <div id="idea-list">${d.items.length ? d.items.map(ideaCard).join('') : '<div class="card empty">Aucune idée pour l’instant. Lance la première ! 💡</div>'}</div>
      </div>
      <form class="card idea-form" id="idea-form">
        <h3 style="margin-top:0">✍️ Proposer une idée</h3>
        <p class="small muted">${d.box === 'profs' ? 'Visible par les formateurs et les modérateurs seulement.' : 'Visible par les élèves et les modérateurs seulement (pas par les formateurs).'}</p>
        <label>Ton idée en une phrase</label><input type="text" name="title" maxlength="120" required placeholder="Ex. : Pouvoir épingler un message dans un salon">
        <label>Explique (optionnel)</label><textarea name="content" rows="4" maxlength="3000" placeholder="À quoi ça servirait ? Comment tu l’imagines ?"></textarea>
        <label>Catégorie</label><select name="category">${d.categories.map(c => `<option>${esc(c)}</option>`).join('')}</select>
        <label class="toggle"><input type="checkbox" name="anonymous"> Poster en anonyme <span class="small muted">(seuls les modérateurs verront ton nom)</span></label>
        <button class="btn primary" style="margin-top:10px">Envoyer l’idée</button>
      </form>
    </div>`);
  $$('[data-sort]').forEach(b => b.onclick = () => { ideasState.sort = b.dataset.sort; viewIdeas({ q: {} }); });
  $('#idea-status').onchange = e => { ideasState.status = e.target.value; viewIdeas({ q: {} }); };
  $('#idea-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('POST', '/api/ideas', { title: f.title.value, content: f.content.value, category: f.category.value, anonymous: f.anonymous.checked, box: d.box });
      f.reset(); toast('Merci pour ton idée 💡'); confetti(40); viewIdeas({ q: {} });
    } catch (err) { toast(err.message); }
  };
  bindIdeaActions(d);
}

function ideaCard(i) {
  const isAdmin = state.user.role === 'admin';
  return `<div class="card idea-card fade-in" data-idea="${i.id}">
    <button class="vote ${i.voted ? 'on' : ''}" data-vote="${i.id}" title="${i.voted ? 'Retirer mon vote' : 'Je soutiens cette idée'}"><span>▲</span><b>${i.votes}</b></button>
    <div style="flex:1;min-width:0">
      <div class="row" style="gap:6px"><b class="idea-title">${esc(i.title)}</b><span class="pill ${IDEA_STATUS_CLASS[i.status]}">${esc(i.status_nom)}</span><span class="pill">${esc(i.category)}</span></div>
      ${i.content ? `<div class="small" style="margin-top:4px">${md(i.content)}</div>` : ''}
      <div class="small muted">${esc(i.author)}${i.anonymous && isAdmin ? ' <span class="pill">anonyme pour les autres</span>' : ''} · ${fmtDate(i.created_at)}</div>
      ${i.admin_reply ? `<div class="explain small"><b>Réponse de l’équipe :</b> ${esc(i.admin_reply)}</div>` : ''}
      ${isAdmin ? `<form class="row idea-admin" data-admin="${i.id}" style="margin-top:8px;flex-wrap:nowrap">
          <select name="status" style="width:auto">${Object.entries({ nouvelle: '🆕 Nouvelle', etudiee: '🔍 À l’étude', prevue: '📅 Prévue', faite: '✅ Faite', refusee: '❌ Pas retenue' }).map(([k, v]) => `<option value="${k}" ${i.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <input type="text" name="admin_reply" maxlength="2000" placeholder="Réponse à l’auteur (optionnel)" value="${esc(i.admin_reply)}">
          <button class="btn sm primary">OK</button></form>` : ''}
      ${i.can_delete ? `<button class="btn sm danger" data-del-idea="${i.id}" style="margin-top:6px">Supprimer</button>` : ''}
    </div></div>`;
}
function bindIdeaActions() {
  $$('[data-vote]').forEach(b => b.onclick = async () => {
    try {
      const i = await api('POST', `/api/ideas/${b.dataset.vote}/vote`);
      b.classList.toggle('on', i.voted); b.querySelector('b').textContent = i.votes;
      if (i.voted) beep('pop');
    } catch (err) { toast(err.message); }
  });
  $$('[data-admin]').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    try { await api('PATCH', `/api/ideas/${f.dataset.admin}`, { status: f.status.value, admin_reply: f.admin_reply.value }); toast('Réponse envoyée à l’auteur'); viewIdeas({ q: {} }); }
    catch (err) { toast(err.message); }
  });
  $$('[data-del-idea]').forEach(b => b.onclick = async () => {
    if (!confirm('Supprimer cette idée ?')) return;
    await api('DELETE', `/api/ideas/${b.dataset.delIdea}`); viewIdeas({ q: {} });
  });
}

// ---------- Guide d'utilisation ----------
async function viewGuide(r) {
  state.guide ||= await api('GET', '/api/guide');
  const g = state.guide;
  const roles = Object.keys(g.roles);
  const role = roles.includes(r.q.role) ? r.q.role : state.user.role;
  const R = g.roles[role];
  const term = (r.q.q || '').toLowerCase();
  setTitle('❓ Guide d’utilisation', 'Ce que tu peux faire, comment, et ce qui n’est pas possible');
  const match = s => !term || norm(s).includes(norm(term));
  const sections = R.sections.map(s => ({
    ...s,
    peut: s.peut.filter(x => match(x.quoi + ' ' + x.comment + ' ' + s.titre)),
    peutpas: s.peutpas.filter(x => match(x.quoi + ' ' + x.pourquoi + ' ' + s.titre)),
  })).filter(s => s.peut.length || s.peutpas.length);
  setContent(`
    <p class="muted">${esc(g.intro)}</p>
    <div class="row" style="margin-bottom:14px">
      <div class="seg">${roles.map(k => `<a class="${k === role ? 'on' : ''}" href="#/guide?role=${k}">${g.roles[k].ico} ${esc(g.roles[k].nom)}${k === state.user.role ? ' (toi)' : ''}</a>`).join('')}</div>
      <span class="spacer"></span>
      <input type="text" id="guide-q" placeholder="🔎 Chercher (ex. absence, fichier, mot de passe…)" value="${esc(r.q.q || '')}" style="max-width:320px">
    </div>
    <div class="guide-toc">${sections.map((s, i) => `<a href="#" data-goto="g${i}">${s.ico} ${esc(s.titre)}</a>`).join('')}</div>
    ${sections.map((s, i) => `<div class="card guide-sec" id="g${i}">
      <h2>${s.ico} ${esc(s.titre)}</h2>
      ${s.peut.length ? `<h3 class="can">✅ Tu peux</h3><div class="guide-list">${s.peut.map(x => `<details class="guide-item"><summary>${esc(x.quoi)}</summary><div class="small">👉 ${esc(x.comment)}</div></details>`).join('')}</div>` : ''}
      ${s.peutpas.length ? `<h3 class="cant">🚫 Tu ne peux pas</h3><div class="guide-list">${s.peutpas.map(x => `<div class="guide-no"><b>${esc(x.quoi)}</b><div class="small muted">Pourquoi : ${esc(x.pourquoi)}</div></div>`).join('')}</div>` : ''}
    </div>`).join('') || '<div class="card empty">Rien trouvé pour cette recherche.</div>'}
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h2>⌨️ Raccourcis</h2><table class="keys">${g.raccourcis.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</table></div>
      <div class="card"><h2>🙋 Questions fréquentes</h2>${g.faq.map(([q, a]) => `<details class="guide-item"><summary>${esc(q)}</summary><div class="small">${esc(a)}</div></details>`).join('')}</div>
    </div>
    <div class="card" style="margin-top:16px;text-align:center">Il manque quelque chose ? <a href="#/idees">💡 Propose-le dans la boîte à idées</a></div>`);
  let tmo;
  $('#guide-q').oninput = e => {
    clearTimeout(tmo);
    tmo = setTimeout(() => {
      const v = e.target.value;
      history.replaceState(null, '', `#/guide?role=${role}${v ? `&q=${encodeURIComponent(v)}` : ''}`);
      state.loadingHash = location.hash;
      viewGuide({ q: { role, q: v } }).then(() => { const i = $('#guide-q'); i.focus(); i.setSelectionRange(v.length, v.length); });
    }, 250);
  };
  $$('[data-goto]').forEach(a => a.onclick = e => { e.preventDefault(); document.getElementById(a.dataset.goto)?.scrollIntoView({ behavior: motionOk() ? 'smooth' : 'auto' }); });
  if (term) $$('.guide-item').forEach(d => { d.open = true; });
}
