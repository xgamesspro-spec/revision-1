'use strict';
/* Planning : vue mois / liste, rythme d'alternance, congés & absences, rappels, abonnement agenda. */

const TYPE_STYLE = {
  examen: { ico: '🎓', c: '#c2413b' }, rendu: { ico: '📝', c: '#d99a1e' }, reunion: { ico: '🎥', c: '#0f9b8e' },
  cours: { ico: '📚', c: '#3b6fd4' }, conge: { ico: '🌴', c: '#2e8b57' }, absence: { ico: '🚫', c: '#8a5cd1' },
  perso: { ico: '👤', c: '#7a7f86' }, autre: { ico: '📌', c: '#5d6f68' },
};
const DAYS_FR = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const isStaffUser = () => ['admin', 'prof'].includes(state.user?.role);
const pad2 = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hhmm = t => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const wd = d => ((d.getDay() + 6) % 7) + 1; // 1 = lundi … 7 = dimanche
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const plan = { cursor: null, view: 'mois', hidden: new Set(), data: null, selected: null, seq: 0 };
const monthKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
// Changer de mois : passe par l'adresse (#/planning?m=2027-05) pour que « retour » et le rechargement marchent
function gotoMonth(y, m) {
  const d = new Date(y, m, 1);
  const hash = `#/planning?m=${monthKey(d)}`;
  plan.selected = null;
  if (location.hash === hash) { plan.cursor = d; viewPlanning({ q: {} }); } else location.hash = hash;
}
const shiftMonth = n => gotoMonth(plan.cursor.getFullYear(), plan.cursor.getMonth() + n);
document.addEventListener('keydown', e => {
  if (state.route?.name !== 'planning' || e.target.closest('input, textarea, select') || document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); shiftMonth(-1); }
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); shiftMonth(1); }
  if (e.key === 't' || e.key === 'T') { const n = new Date(); gotoMonth(n.getFullYear(), n.getMonth()); }
});

// Sélecteur de mois : année ‹ › + 12 mois
function openMonthPicker(anchor) {
  $('.month-picker')?.remove();
  let year = plan.cursor.getFullYear();
  const p = document.createElement('div');
  p.className = 'month-picker';
  const draw = () => {
    const now = new Date();
    p.innerHTML = `<div class="row" style="justify-content:space-between"><button class="btn sm" data-y="-1">‹</button><b>${year}</b><button class="btn sm" data-y="1">›</button></div>
      <div class="mp-grid">${MONTHS_FR.map((m, i) => `<button class="${i === plan.cursor.getMonth() && year === plan.cursor.getFullYear() ? 'on' : ''} ${i === now.getMonth() && year === now.getFullYear() ? 'today' : ''}" data-m="${i}">${m.slice(0, 4)}${m.length > 4 ? '.' : ''}</button>`).join('')}</div>`;
    p.querySelectorAll('[data-y]').forEach(b => b.onclick = e => { e.stopPropagation(); year += +b.dataset.y; draw(); });
    p.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { p.remove(); gotoMonth(year, +b.dataset.m); });
  };
  draw();
  document.body.appendChild(p);
  const r = anchor.getBoundingClientRect();
  p.style.top = `${r.bottom + 6 + scrollY}px`;
  p.style.left = `${Math.max(8, Math.min(innerWidth - p.offsetWidth - 8, r.left + r.width / 2 - p.offsetWidth / 2))}px`;
  setTimeout(() => document.addEventListener('click', function close(e) { if (!p.contains(e.target)) { p.remove(); document.removeEventListener('click', close); } }), 0);
}

function evDays(e) {
  const out = [];
  for (let d = startOfDay(new Date(e.occ_start)); d <= new Date(e.occ_end); d = addDays(d, 1)) { out.push(isoDay(d)); if (out.length > 40) break; }
  return out;
}
function evTime(e) {
  if (e.all_day) {
    const a = new Date(e.occ_start), b = new Date(e.occ_end);
    return isoDay(a) === isoDay(b) ? 'Toute la journée' : `Du ${a.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} au ${b.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
  }
  return `${hhmm(e.occ_start)}${e.occ_end > e.occ_start ? ' – ' + hhmm(e.occ_end) : ''}`;
}
const evLabel = e => `${TYPE_STYLE[e.type]?.ico || '📌'} ${e.author ? `${esc(e.author)} — ` : ''}${esc(e.title)}`;

async function viewPlanning(r) {
  const staff = isStaffUser();
  if (r.q.date) { plan.cursor = new Date(+r.q.date); plan.selected = isoDay(new Date(+r.q.date)); }
  const mq = /^(\d{4})-(\d{2})$/.exec(r.q.m || '');
  if (mq) plan.cursor = new Date(+mq[1], +mq[2] - 1, 1);
  if (!plan.cursor || isNaN(plan.cursor)) plan.cursor = new Date();
  const first = new Date(plan.cursor.getFullYear(), plan.cursor.getMonth(), 1);
  const gridStart = addDays(first, -(wd(first) - 1));
  // Vue mois : la grille de 6 semaines ; vue liste : tout le mois choisi
  const from = plan.view === 'mois' ? gridStart : first;
  const to = plan.view === 'mois' ? addDays(gridStart, 42) : new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const seq = ++plan.seq; // si on clique vite, on n'affiche que la dernière réponse
  const d = await api('GET', `/api/events?from=${from.getTime()}&to=${to.getTime()}`);
  if (seq !== plan.seq) return;
  plan.data = d;
  const events = d.events.filter(e => !plan.hidden.has(e.type));
  const cfaDays = (d.rythme?.effective || '').split(',').filter(Boolean).map(Number);
  setTitle('🗓️ Planning', staff ? 'Examens, cours, rendus, fermetures et absences des élèves' : 'Ton alternance, tes cours, tes rendus, tes congés et tes absences',
    '<button class="btn sm primary" id="ev-add">＋ Ajouter</button>');

  const byDay = {};
  for (const e of events) for (const k of evDays(e)) (byDay[k] ||= []).push(e);
  const todayKey = isoDay(new Date());

  const alternance = staff ? `
    <div class="card plan-side"><h3>🔁 Rythmes d'alternance</h3>
      <p class="small muted">Jours au CFA par filière : ils s'affichent dans le planning des élèves.</p>
      <button class="btn sm" id="rythme-staff">Régler les rythmes</button></div>`
    : `
    <div class="card plan-side"><h3>🔁 Mon alternance</h3>
      ${cfaDays.length ? `<p class="small"><span class="tag-cfa">CFA</span> ${cfaDays.map(n => DAYS_FR[n]).join(', ')}<br>
        <span class="tag-ent">Entreprise</span> ${[1, 2, 3, 4, 5].filter(n => !cfaDays.includes(n)).map(n => DAYS_FR[n]).join(', ') || '—'}</p>
        <p class="small muted">${d.rythme.mine != null ? 'Rythme personnalisé.' : 'Rythme de ta filière.'}</p>`
      : '<p class="small">Indique tes jours au CFA pour voir ton alternance dans le planning.</p>'}
      <button class="btn sm" id="rythme-me">${cfaDays.length ? 'Modifier' : 'Indiquer mes jours de CFA'}</button></div>
    ${d.conges ? `<div class="card plan-side"><h3>🌴 Mes congés</h3>
      <p class="small">Congés payés posés : <b>${d.conges.cp} j ouvrables</b><br>Congé révision examen : <b>${d.conges.examen} / 5 j</b></p>
      <details class="small muted"><summary style="cursor:pointer">Les règles</summary>
        <ul style="padding-left:18px;margin:6px 0">
          <li>2,5 jours ouvrables par mois travaillé, soit 30 par an (période du ${esc(d.conges.periode)}).</li>
          <li>Jours ouvrables = du lundi au samedi (hors jours fériés).</li>
          <li>C'est ton employeur qui fixe les dates : tu proposes, il valide.</li>
          <li>Le temps au CFA est du temps de travail : en principe les congés se prennent sur les périodes en entreprise.</li>
          <li>+ 5 jours ouvrables de congé pour préparer ton examen.</li>
        </ul>
        Sources : <a href="https://www.service-public.gouv.fr/particuliers/vosdroits/F2258" target="_blank" rel="noopener">service-public.fr</a>, <a href="https://www.cidj.com/etudes-formations-alternance/alternance/contrat-d-apprentissage-droits-et-avantages-de-l-apprenti" target="_blank" rel="noopener">CIDJ</a>, <a href="https://www.centre-inffo.fr/helpie_faq/toggle-title-18" target="_blank" rel="noopener">Centre Inffo</a>.
      </details></div>` : ''}`;

  const chips = Object.entries(d.types).map(([k, nom]) => `<button class="chip ${plan.hidden.has(k) ? 'off' : ''}" data-type="${k}" style="--c:${TYPE_STYLE[k]?.c}">${TYPE_STYLE[k]?.ico} ${esc(nom)}</button>`).join('');
  const head = `
    <div class="row plan-toolbar">
      <button class="btn nav-arrow" id="pl-prev" title="Mois précédent (←)">‹</button>
      <button class="plan-month" id="pl-month" title="Choisir un mois">${MONTHS_FR[plan.cursor.getMonth()]} ${plan.cursor.getFullYear()} ▾</button>
      <button class="btn nav-arrow" id="pl-next" title="Mois suivant (→)">›</button>
      <button class="btn sm" id="pl-today" title="Revenir à aujourd’hui (T)">Aujourd'hui</button>
      <span class="spacer"></span>
      <div class="seg"><button class="${plan.view === 'mois' ? 'on' : ''}" data-view="mois">Mois</button><button class="${plan.view === 'liste' ? 'on' : ''}" data-view="liste">Liste</button></div>
      <button class="btn sm" id="pl-feed">📲 Dans mon agenda</button>
    </div>
    <div class="row chips">${chips}</div>`;

  let body;
  if (plan.view === 'mois') {
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const day = addDays(gridStart, i), k = isoDay(day), n = wd(day);
      const evs = byDay[k] || [];
      const alt = !staff && cfaDays.length && n <= 5 ? (cfaDays.includes(n) ? 'cfa' : 'ent') : '';
      cells.push(`<div class="cal-cell ${day.getMonth() !== plan.cursor.getMonth() ? 'out' : ''} ${k === todayKey ? 'today' : ''} ${k === plan.selected ? 'sel' : ''} ${alt}" data-day="${k}">
        <div class="cal-num"><span>${day.getDate()}</span>${alt === 'cfa' ? '<span class="tag-cfa">CFA</span>' : alt === 'ent' ? '<span class="tag-ent">Entr.</span>' : ''}</div>
        ${evs.slice(0, 3).map(e => `<div class="cal-ev" style="--c:${TYPE_STYLE[e.type]?.c}" data-ev="${e.id}" data-occ="${e.occ_start}" title="${esc(e.title)}">${e.all_day ? '' : `<b>${hhmm(e.occ_start)}</b> `}${evLabel(e)}</div>`).join('')}
        ${evs.length > 3 ? `<div class="small muted">+ ${evs.length - 3} autre(s)</div>` : ''}
      </div>`);
    }
    body = `<div class="cal-grid">${[1, 2, 3, 4, 5, 6, 7].map(n => `<div class="cal-head">${DAYS_FR[n]}</div>`).join('')}${cells.join('')}</div>
      <div id="day-panel"></div>`;
  } else {
    const mk = monthKey(plan.cursor);
    const keys = Object.keys(byDay).filter(k => k.startsWith(mk)).sort();
    body = keys.length ? keys.map(k => `<div class="list-day ${k === todayKey ? 'today' : ''} ${k < todayKey ? 'past' : ''}"><div class="list-date">${new Date(k + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}${k === todayKey ? ' · aujourd’hui' : ''}</div>
      ${byDay[k].map(e => evRow(e)).join('')}</div>`).join('') : `<div class="card empty">Rien de prévu en ${MONTHS_FR[plan.cursor.getMonth()]}.</div>`;
  }

  setContent(`<div class="plan-layout"><div class="plan-main">${head}<div class="plan-body ${plan.anim || ''}">${body}</div></div><div class="plan-aside">${alternance}</div></div>`);
  plan.anim = '';
  if (plan.view === 'mois' && plan.selected) renderDayPanel(plan.selected, byDay);

  $('#ev-add').onclick = () => openEventForm({ date: plan.selected || todayKey });
  $('#pl-prev').onclick = () => { plan.anim = 'slide-right'; shiftMonth(-1); };
  $('#pl-next').onclick = () => { plan.anim = 'slide-left'; shiftMonth(1); };
  $('#pl-month').onclick = e => { e.stopPropagation(); openMonthPicker(e.currentTarget); };
  $('#pl-today').onclick = () => { const n = new Date(); gotoMonth(n.getFullYear(), n.getMonth()); plan.selected = todayKey; };
  const pb = $('.plan-body');
  if (pb) onSwipe(pb, () => { plan.anim = 'slide-left'; shiftMonth(1); }, () => { plan.anim = 'slide-right'; shiftMonth(-1); });
  $$('[data-view]').forEach(b => b.onclick = () => { plan.view = b.dataset.view; viewPlanning({ q: {} }); });
  $$('.chip[data-type]').forEach(b => b.onclick = () => { plan.hidden.has(b.dataset.type) ? plan.hidden.delete(b.dataset.type) : plan.hidden.add(b.dataset.type); viewPlanning({ q: {} }); });
  $$('.cal-cell').forEach(c => c.onclick = e => {
    if (e.target.closest('.cal-ev')) return;
    plan.selected = c.dataset.day;
    $$('.cal-cell.sel').forEach(x => x.classList.remove('sel'));
    c.classList.add('sel');
    renderDayPanel(c.dataset.day, byDay);
  });
  bindEventClicks();
  $('#pl-feed').onclick = openFeedDialog;
  $('#rythme-me')?.addEventListener('click', () => openRythmeDialog(d.rythme));
  $('#rythme-staff')?.addEventListener('click', openRythmeStaffDialog);
}

function evRow(e) {
  return `<div class="ev-row" data-ev="${e.id}" data-occ="${e.occ_start}" style="--c:${TYPE_STYLE[e.type]?.c}">
    <span class="ev-time">${evTime(e)}</span>
    <span class="ev-title">${evLabel(e)}${e.detail_nom ? ` <span class="pill">${esc(e.detail_nom)}</span>` : ''}${e.filiere_nom ? ` <span class="pill">${esc(e.filiere_nom)}</span>` : ''}${e.visibility === 'cfa' ? ' <span class="pill">Tout le CFA</span>' : ''}</span>
    ${e.type === 'reunion' && state.user.role !== 'prof' ? `<button class="btn sm primary" data-join="${e.id}">Rejoindre</button>` : ''}
  </div>`;
}
function bindEventClicks() {
  $$('[data-ev]').forEach(el => el.addEventListener('click', ev => {
    if (ev.target.closest('[data-join]')) return;
    ev.stopPropagation();
    const e = plan.data.events.find(x => x.id === +el.dataset.ev && x.occ_start === +el.dataset.occ);
    if (e) openEventDetail(e);
  }));
  $$('[data-join]').forEach(b => b.onclick = async ev => {
    ev.stopPropagation();
    try { const { id } = await api('POST', `/api/events/${b.dataset.join}/meeting`); location.hash = `#/reunion/${id}`; } catch (err) { toast(err.message); }
  });
}
function renderDayPanel(k, byDay) {
  const box = $('#day-panel');
  if (!box) return;
  const evs = byDay[k] || [];
  box.innerHTML = `<div class="card" style="margin-top:12px">
    <div class="row"><h3 style="margin:0">${new Date(k + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</h3><span class="spacer"></span>
      <button class="btn sm" id="day-add">＋ Ajouter ce jour</button></div>
    ${evs.length ? evs.map(evRow).join('') : '<p class="muted small">Rien ce jour-là.</p>'}</div>`;
  $('#day-add').onclick = () => openEventForm({ date: k });
  bindEventClicks();
}

// ---------- Détail d'un événement ----------
function openEventDetail(e) {
  const exLink = (e.description || '').match(/#\/exercices\/\d+/);
  const d = showDialog(`
    <div class="row"><span class="pill" style="background:${TYPE_STYLE[e.type]?.c}22;color:${TYPE_STYLE[e.type]?.c}">${TYPE_STYLE[e.type]?.ico} ${esc(e.type_nom)}</span>
      ${e.detail_nom ? `<span class="pill">${esc(e.detail_nom)}</span>` : ''}${e.filiere_nom ? `<span class="pill">${esc(e.filiere_nom)}</span>` : ''}
      ${e.visibility === 'cfa' ? '<span class="pill">Tout le CFA</span>' : e.visibility === 'perso' ? '<span class="pill">🔒 Perso</span>' : ''}</div>
    <h3 style="margin:10px 0 4px">${esc(e.title)}</h3>
    ${e.author ? `<p class="small">Élève : <b>${esc(e.author)}</b></p>` : ''}
    <p class="small muted" style="margin-top:0">${new Date(e.occ_start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${evTime(e)}
      ${e.repeat_days ? `<br>🔁 Chaque ${e.repeat_days.split(',').map(n => DAYS_FR[n]).join(', ')} jusqu'au ${new Date(e.repeat_until).toLocaleDateString('fr-FR')}` : ''}</p>
    ${e.location ? `<p class="small">📍 ${esc(e.location)}</p>` : ''}
    ${e.description ? md(e.description.replace(/#\/exercices\/\d+/, '')) : ''}
    ${renderAttachments(e.attachments)}
    <div class="row" style="margin-top:10px">
      ${exLink ? `<a class="btn sm primary" href="${exLink[0]}" data-close>📝 Voir l'exercice</a>` : ''}
      ${e.type === 'reunion' && state.user.role !== 'prof' ? `<button class="btn sm primary" id="ed-join">🎥 Rejoindre la réunion</button>` : ''}
      ${e.can_edit && !exLink ? '<button class="btn sm" id="ed-edit">Modifier</button><button class="btn sm danger" id="ed-del">Supprimer</button>' : ''}
    </div>`);
  d.querySelector('#ed-join')?.addEventListener('click', async () => {
    try { const { id } = await api('POST', `/api/events/${e.id}/meeting`); d.close(); location.hash = `#/reunion/${id}`; } catch (err) { toast(err.message); }
  });
  d.querySelector('#ed-edit')?.addEventListener('click', () => { d.close(); openEventForm({ event: e }); });
  d.querySelector('#ed-del')?.addEventListener('click', async () => {
    if (!confirm(e.repeat_days ? 'Supprimer toute la série ?' : 'Supprimer cet événement ?')) return;
    try { await api('DELETE', `/api/events/${e.id}`); d.close(); viewPlanning({ q: {} }); } catch (err) { toast(err.message); }
  });
  d.querySelectorAll('[data-close]').forEach(a => a.addEventListener('click', () => d.close()));
}

// ---------- Formulaire ----------
function openEventForm({ date, event }) {
  const staff = isStaffUser();
  const e = event || {};
  const types = plan.data?.types || {};
  const details = plan.data?.details || {};
  const startD = e.start_at ? new Date(e.start_at) : new Date(date + 'T09:00');
  const endD = e.end_at ? new Date(e.end_at) : null;
  const visOpts = [['perso', '🔒 Moi seulement'], ['filiere', staff ? '👥 Une filière' : `👥 Ma filière (${state.user.filiere_nom || ''})`], ...(staff ? [['cfa', '🏫 Tout le CFA']] : [])];
  const d = showDialog(`
    <h3 style="margin-top:0">${event ? 'Modifier' : 'Ajouter au planning'}</h3>
    <form id="ev-form">
      <div class="row" style="flex-wrap:nowrap">
        <div style="flex:1"><label style="margin-top:0">Type</label><select name="type">${Object.entries(types).map(([k, n]) => `<option value="${k}" ${(e.type || 'perso') === k ? 'selected' : ''}>${TYPE_STYLE[k]?.ico} ${esc(n)}</option>`).join('')}</select></div>
        <div style="flex:1" id="detail-wrap"></div>
      </div>
      <label>Titre</label><input type="text" name="title" maxlength="120" required value="${esc(e.title || '')}">
      <label class="toggle"><input type="checkbox" name="all_day" ${e.all_day ? 'checked' : ''}> Toute la journée</label>
      <div class="row" style="flex-wrap:nowrap">
        <div style="flex:1"><label>Date</label><input type="date" name="date" required value="${isoDay(startD)}"></div>
        <div style="flex:1" class="t-only"><label>Début</label><input type="time" name="t1" value="${hhmm(startD)}"></div>
        <div style="flex:1" class="t-only"><label>Fin</label><input type="time" name="t2" value="${endD ? hhmm(endD) : ''}"></div>
        <div style="flex:1" class="d-only"><label>Jusqu'au</label><input type="date" name="date2" value="${endD ? isoDay(endD) : ''}"></div>
      </div>
      <div id="conge-help" class="small muted"></div>
      <label>Lieu <span class="muted small">(optionnel)</span></label><input type="text" name="location" maxlength="120" value="${esc(e.location || '')}" placeholder="Salle, entreprise, visio…">
      <label>Description <span class="muted small">(optionnel)</span></label><textarea name="description" rows="3" maxlength="2000">${esc(e.description || '')}</textarea>
      <div id="vis-wrap"><label>Qui le voit ?</label>
        <div class="row" style="flex-wrap:nowrap"><select name="visibility" style="flex:1">${visOpts.map(([k, n]) => `<option value="${k}" ${(e.visibility || 'perso') === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
        ${staff ? `<select name="filiere" style="flex:1">${(state.setup?.filieres || []).map(f => `<option value="${f.id}" ${e.filiere === f.id ? 'selected' : ''}>${esc(f.nom)}</option>`).join('')}</select>` : ''}</div></div>
      <details id="rep-wrap" ${e.repeat_days ? 'open' : ''}><summary class="small" style="cursor:pointer;margin-top:12px">🔁 Répéter chaque semaine</summary>
        <div class="row" style="margin-top:6px">${[1, 2, 3, 4, 5, 6, 7].map(n => `<label class="day-box"><input type="checkbox" name="rd" value="${n}" ${(e.repeat_days || '').split(',').includes(String(n)) ? 'checked' : ''}>${DAYS_FR[n]}</label>`).join('')}</div>
        <label>Jusqu'au</label><input type="date" name="until" value="${e.repeat_until ? isoDay(new Date(e.repeat_until)) : ''}">
      </details>
      ${event ? '' : `<div id="just-wrap" hidden><label>Justificatif <span class="muted small">(optionnel — visible par toi et l'équipe du CFA)</span></label>${attachUi()}</div>`}
      <div class="error" id="ev-err"></div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn" data-cancel>Annuler</button><button class="btn primary">${event ? 'Enregistrer' : 'Ajouter'}</button></div>
    </form>`, { ok: false });
  const f = d.querySelector('#ev-form');
  const box = f.querySelector('.att-btn') ? bindAttach(f, null) : null;
  const sync = () => {
    const t = f.type.value;
    const opts = details[t];
    f.querySelector('#detail-wrap').innerHTML = opts ? `<label style="margin-top:0">Précision</label><select name="detail">${Object.entries(opts)
      .filter(([k]) => staff || k !== 'fermeture').map(([k, n]) => `<option value="${k}" ${e.detail === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : '';
    f.detail?.addEventListener('change', sync2);
    sync2();
  };
  const sync2 = () => {
    const t = f.type.value, det = f.detail?.value;
    const personal = t === 'absence' || (t === 'conge' && det !== 'fermeture');
    f.querySelector('#vis-wrap').hidden = personal;
    if (!f.title.value || f.title.dataset.auto) { const n = (details[t] || {})[det] || (t === 'conge' ? 'Congés' : ''); if (n) { f.title.value = n; f.title.dataset.auto = '1'; } }
    if (personal || (t === 'conge')) f.all_day.checked = true;
    f.querySelector('#rep-wrap').hidden = personal;
    if (f.querySelector('#just-wrap')) f.querySelector('#just-wrap').hidden = t !== 'absence';
    f.querySelector('#conge-help').innerHTML = t === 'absence'
      ? 'ℹ️ Préviens aussi ton employeur et le CFA. Une absence non justifiée peut entraîner une retenue sur salaire.'
      : t === 'conge' && det !== 'fermeture' ? 'ℹ️ Les dates de congés sont fixées par ton employeur. Pose-les de préférence sur tes périodes en entreprise.' : '';
    syncDay();
  };
  const syncDay = () => {
    const ad = f.all_day.checked;
    f.querySelectorAll('.t-only').forEach(x => x.hidden = ad);
    f.querySelectorAll('.d-only').forEach(x => x.hidden = !ad);
  };
  f.title.addEventListener('input', () => delete f.title.dataset.auto);
  f.type.onchange = sync;
  f.all_day.onchange = syncDay;
  sync();
  f.querySelector('[data-cancel]').onclick = () => d.close();
  f.onsubmit = async ev => {
    ev.preventDefault();
    const allDay = f.all_day.checked;
    const start = new Date(`${f.date.value}T${allDay ? '00:00' : f.t1.value || '09:00'}`).getTime();
    let end = null;
    if (allDay && f.date2.value) end = new Date(`${f.date2.value}T00:00`).getTime();
    if (!allDay && f.t2.value) end = new Date(`${f.date.value}T${f.t2.value}`).getTime();
    const days = [...f.querySelectorAll('[name=rd]:checked')].map(c => +c.value);
    const body = {
      title: f.title.value, type: f.type.value, detail: f.detail?.value, all_day: allDay, start_at: start, end_at: end,
      location: f.location.value, description: f.description.value, visibility: f.visibility.value, filiere: f.filiere?.value,
      repeat_days: f.querySelector('#rep-wrap').hidden ? [] : days,
      repeat_until: days.length && f.until.value ? new Date(`${f.until.value}T23:59`).getTime() : null,
      attachments: box ? box.ids() : undefined,
    };
    if (box?.busy()) return toast('Attends la fin de l’envoi du fichier');
    try {
      const r = event ? await api('PATCH', `/api/events/${e.id}`, body) : await api('POST', '/api/events', body);
      d.close();
      (r.warnings || []).forEach(w => toast('⚠️ ' + w));
      plan.cursor = new Date(start); plan.selected = isoDay(new Date(start));
      viewPlanning({ q: {} });
    } catch (err) { f.querySelector('#ev-err').textContent = err.message; }
  };
}

// ---------- Rythme d'alternance ----------
const dayBoxes = (sel, name) => [1, 2, 3, 4, 5, 6].map(n => `<label class="day-box"><input type="checkbox" name="${name}" value="${n}" ${sel.includes(n) ? 'checked' : ''}>${DAYS_FR[n]}</label>`).join('');
function openRythmeDialog(r) {
  const cur = (r.effective || '').split(',').filter(Boolean).map(Number);
  const d = showDialog(`<h3 style="margin-top:0">🔁 Mes jours au CFA</h3>
    <p class="small muted">Les autres jours de la semaine sont comptés en entreprise.</p>
    <div class="row">${dayBoxes(cur, 'cfa')}</div>
    ${r.filiere ? `<p class="small">Rythme de ta filière : ${r.filiere.split(',').map(n => DAYS_FR[n]).join(', ')}</p>` : ''}
    <div class="row" style="margin-top:10px"><button class="btn primary" id="ry-save">Enregistrer</button>${r.mine != null && r.filiere ? '<button class="btn" id="ry-reset">Reprendre le rythme de la filière</button>' : ''}</div>`);
  d.querySelector('#ry-save').onclick = async () => {
    await api('POST', '/api/rythme', { days: [...d.querySelectorAll('[name=cfa]:checked')].map(c => +c.value) });
    d.close(); viewPlanning({ q: {} });
  };
  d.querySelector('#ry-reset')?.addEventListener('click', async () => { await api('POST', '/api/rythme', { days: null }); d.close(); viewPlanning({ q: {} }); });
}
async function openRythmeStaffDialog() {
  const r = await api('GET', '/api/rythme');
  const d = showDialog(`<h3 style="margin-top:0">🔁 Jours au CFA par filière</h3>
    ${(state.setup?.filieres || []).map(f => `<div style="margin:10px 0"><b>${esc(f.nom)}</b><div class="row">${dayBoxes((r.filieres[f.id] || '').split(',').map(Number), 'f-' + f.id)}</div></div>`).join('')}
    <p class="small muted">Chaque élève peut ajuster le sien s'il a un rythme différent.</p>
    <button class="btn primary" id="rys-save">Enregistrer</button>`);
  d.querySelector('#rys-save').onclick = async () => {
    for (const f of state.setup.filieres) await api('POST', '/api/rythme/filiere', { filiere: f.id, days: [...d.querySelectorAll(`[name="f-${f.id}"]:checked`)].map(c => +c.value) });
    toast('Rythmes enregistrés'); d.close(); viewPlanning({ q: {} });
  };
}

// ---------- Abonnement agenda (iCalendar) ----------
async function openFeedDialog() {
  const { url } = await api('GET', '/api/calendar/feed');
  const webcal = url.replace(/^https?:/, 'webcal:');
  const d = showDialog(`<h3 style="margin-top:0">📲 Ton planning dans ton agenda</h3>
    <p class="small">Ton lien personnel (format iCalendar, mis à jour automatiquement) :</p>
    <div class="row" style="flex-wrap:nowrap"><input type="text" readonly value="${esc(url)}" id="feed-url"><button class="btn" id="feed-copy">Copier</button></div>
    <ul class="small" style="padding-left:18px">
      <li><b>Google Agenda</b> (sur ordinateur) : « Autres agendas » → ＋ → « À partir de l'URL » → colle le lien. <a href="https://support.google.com/calendar/answer/37100" target="_blank" rel="noopener">Aide Google</a></li>
      <li><b>iPhone</b> : <a href="${esc(webcal)}">touche ici</a>, ou Réglages → Calendrier → Comptes → Ajouter → Autre → « Calendrier avec abonnement ».</li>
      <li><b>Outlook</b> : Ajouter un calendrier → « S'abonner à partir du web ».</li>
    </ul>
    <p class="small muted">⚠️ Ce lien donne accès à ton planning (y compris tes absences et congés) : ne le partage pas. Si tu l'as partagé par erreur, régénère-le.</p>
    <button class="btn sm danger" id="feed-reset">Régénérer le lien (l'ancien ne marchera plus)</button>`);
  d.querySelector('#feed-copy').onclick = () => { navigator.clipboard?.writeText(url); toast('Lien copié'); };
  d.querySelector('#feed-reset').onclick = async () => {
    if (!confirm('Les agendas abonnés à l’ancien lien ne se mettront plus à jour. Continuer ?')) return;
    await api('POST', '/api/calendar/feed/reset'); d.close(); openFeedDialog();
  };
}
