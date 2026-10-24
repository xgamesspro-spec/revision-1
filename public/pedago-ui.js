'use strict';
/* Vie de classe façon Pronote / Ypareo : cahier de textes, notes & moyennes, vie scolaire (appel, justificatifs),
   messagerie formateurs ↔ élèves, livret d'apprentissage avec le tuteur. Pages formation & CFA. */

const frDay = iso => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
const frLong = iso => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
const todayIso = () => isoDay(new Date());
const isStaffRole = () => ['admin', 'prof'].includes(state.user?.role);
const note20 = v => (v == null ? '—' : String(v).replace('.', ','));
const noteClass = v => (v == null ? '' : v >= 14 ? 'ok' : v >= 10 ? 'accent' : 'gold');

// ---------- Choix de la classe (tout le CFA / une filière / une formation) ----------
function classeOptions(cur = {}, { all = true } = {}) {
  const fil = state.setup?.filieres || [], forms = state.setup?.formations || [];
  const sel = v => (v === (cur.formation || (cur.filiere ? 'F:' + cur.filiere : '')) ? 'selected' : '');
  return `${all ? `<option value="" ${sel('')}>👥 Tout le CFA</option>` : ''}${fil.map(f => `<optgroup label="${esc(f.nom)}">
    <option value="F:${f.id}" ${sel('F:' + f.id)}>Tous les ${esc(f.nom)}</option>
    ${forms.filter(x => x.filiere === f.id).map(x => `<option value="${x.id}" ${sel(x.id)}>${esc(x.nom)}</option>`).join('')}</optgroup>`).join('')}`;
}
const classeValue = v => (!v ? { filiere: null, formation: null } : v.startsWith('F:') ? { filiere: v.slice(2), formation: null } : { filiere: null, formation: v });
async function subjectNames() {
  if (!state.subjectNames) state.subjectNames = (await api('GET', '/api/subjects').catch(() => [])).map(s => s.nom);
  return state.subjectNames;
}
const matiereInput = (val = '', req = false) => `<input type="text" name="matiere" maxlength="60" list="mat-list" value="${esc(val)}" ${req ? 'required' : ''} placeholder="Ex. Français, Comptabilité…">
  <datalist id="mat-list">${(state.subjectNames || []).map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;

// ===================================================================
// 📒 Cahier de textes
// ===================================================================
async function viewCahier(r) {
  await subjectNames();
  const d = await api('GET', '/api/cahier');
  const staff = d.staff;
  const tab = r.q.tab || (staff ? 'seances' : 'travail');
  setTitle('📒 Cahier de textes', staff ? 'Ce qui a été fait en séance et le travail à faire' : 'Le contenu des cours et ton travail à faire');
  const travailItem = e => `<div class="card cahier-todo ${e.fait ? 'done' : ''}" style="margin-bottom:10px">
      <div class="row">
        ${staff ? '' : `<label class="toggle" title="Marquer comme fait"><input type="checkbox" data-fait="${e.id}" ${e.fait ? 'checked' : ''}></label>`}
        <b>${esc(e.titre)}</b>${e.matiere ? `<span class="pill">${esc(e.matiere)}</span>` : ''}
        <span class="spacer"></span><span class="${e.pour_le <= todayIso() ? 'soon' : ''}">📅 pour ${frLong(e.pour_le)}</span>
        ${staff ? `<span class="pill">${esc(e.cible)}</span><span class="pill ${e.nb_fait === e.nb_eleves && e.nb_eleves ? 'ok' : ''}">${e.nb_fait}/${e.nb_eleves} fait</span>` : ''}
      </div>
      ${md(e.travail)}${renderAttachments(e.attachments)}
      <div class="small muted">${esc(e.author)} · séance du ${frDay(e.date)}</div></div>`;
  const seanceItem = e => `<div class="card" style="margin-bottom:10px">
      <div class="row"><span class="pill accent">${frDay(e.date)}</span><b>${esc(e.titre)}</b>${e.matiere ? `<span class="pill">${esc(e.matiere)}</span>` : ''}
        <span class="spacer"></span>${staff ? `<span class="pill">${esc(e.cible)}</span>` : ''}
        ${e.can_edit ? `<button class="btn sm" data-edit-cahier="${e.id}">Modifier</button><button class="btn sm danger" data-del-cahier="${e.id}">Supprimer</button>` : ''}</div>
      ${e.contenu ? md(e.contenu) : '<p class="muted small">Pas de contenu détaillé.</p>'}
      ${e.travail ? `<div class="explain small"><b>À faire${e.pour_le ? ` pour ${frLong(e.pour_le)}` : ''} :</b> ${md(e.travail)}</div>` : ''}
      ${renderAttachments(e.attachments)}
      <div class="small muted">${esc(e.author)}</div></div>`;
  const todo = d.travail.filter(e => staff || !e.fait);
  setContent(`
    ${staff ? `<details class="card fiche" ${d.seances.length ? '' : 'open'}><summary>➕ Remplir le cahier de textes</summary>
      <form id="cahier-form" class="body">${cahierFields({ date: todayIso() })}
        <div class="row" style="margin-top:12px"><button class="btn primary">Enregistrer</button><span class="small muted">S'il y a du travail à faire, les élèves concernés sont prévenus.</span></div></form></details>` : ''}
    <div class="tabs" style="margin-top:12px">
      <a class="tab ${tab === 'travail' ? 'active' : ''}" href="#/cahier?tab=travail">📌 Travail à faire (${todo.length})</a>
      <a class="tab ${tab === 'seances' ? 'active' : ''}" href="#/cahier?tab=seances">📚 Séances (${d.seances.length})</a>
      ${staff ? '' : `<a class="tab ${tab === 'fait' ? 'active' : ''}" href="#/cahier?tab=fait">✅ Déjà fait (${d.travail.filter(e => e.fait).length})</a>`}
    </div>
    ${tab === 'seances' ? (d.seances.length ? d.seances.map(seanceItem).join('') : '<div class="card empty">Rien dans le cahier de textes pour les 3 dernières semaines.</div>')
      : tab === 'fait' ? (d.travail.filter(e => e.fait).map(travailItem).join('') || '<div class="card empty">Rien de coché pour l’instant.</div>')
      : (todo.length ? todo.map(travailItem).join('') : `<div class="card empty">${staff ? 'Aucun travail à faire en cours.' : 'Rien à faire pour l’instant 🎉'}</div>`)}
    <dialog class="card dialog wide" id="cahier-dlg"><h3 style="margin-top:0">Modifier la séance</h3><form id="cahier-edit"></form></dialog>`);
  if (staff) bindCahierForm($('#cahier-form'), null);
  $$('[data-fait]').forEach(c => c.onchange = async () => {
    await api('POST', `/api/cahier/${c.dataset.fait}/fait`, { done: c.checked });
    if (c.checked) { beep('ok'); toast('Bien joué ✅'); }
    viewCahier(r);
  });
  $$('[data-del-cahier]').forEach(b => b.onclick = async () => {
    if (!confirm('Supprimer cette séance du cahier de textes ?')) return;
    await api('DELETE', `/api/cahier/${b.dataset.delCahier}`); viewCahier(r);
  });
  $$('[data-edit-cahier]').forEach(b => b.onclick = () => {
    const e = [...d.seances, ...d.travail].find(x => x.id === +b.dataset.editCahier);
    const f = $('#cahier-edit');
    f.innerHTML = `${cahierFields(e)}<div class="row" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn" onclick="this.closest('dialog').close()">Annuler</button><button class="btn primary">Enregistrer</button></div>`;
    bindCahierForm(f, e);
    $('#cahier-dlg').showModal();
  });
}
function cahierFields(e) {
  return `
    <div class="row" style="flex-wrap:wrap">
      <div style="flex:1;min-width:140px"><label>Date de la séance</label><input type="date" name="date" required value="${esc(e.date || todayIso())}"></div>
      <div style="flex:2;min-width:180px"><label>Matière</label>${matiereInput(e.matiere)}</div>
      <div style="flex:2;min-width:200px"><label>Classe</label><select name="classe">${classeOptions(e)}</select></div>
    </div>
    <label>Titre de la séance</label><input type="text" name="titre" maxlength="120" required value="${esc(e.titre || '')}" placeholder="Ex. : Les Incoterms 2020 — partie 1">
    <label>Ce qui a été fait <span class="muted small">(Markdown)</span></label><textarea name="contenu" rows="4" maxlength="20000">${esc(e.contenu || '')}</textarea>
    <div class="row" style="flex-wrap:wrap;align-items:flex-start">
      <div style="flex:3;min-width:220px"><label>Travail à faire <span class="muted small">(optionnel)</span></label><textarea name="travail" rows="3" maxlength="5000" placeholder="Ex. : Exercices 3 et 4 page 52">${esc(e.travail || '')}</textarea></div>
      <div style="flex:1;min-width:150px"><label>Pour le</label><input type="date" name="pour_le" value="${esc(e.pour_le || '')}"></div>
    </div>
    ${attachUi()}`;
}
function bindCahierForm(f, e) {
  const box = bindAttach(f, f.contenu);
  f.onsubmit = async ev => {
    ev.preventDefault();
    if (box.busy()) return toast('Attends la fin de l’envoi des fichiers');
    const body = { date: f.date.value, matiere: f.matiere.value, titre: f.titre.value, contenu: f.contenu.value, travail: f.travail.value, pour_le: f.pour_le.value || null, ...classeValue(f.classe.value), attachments: box.ids() };
    try {
      if (e) await api('PATCH', `/api/cahier/${e.id}`, body); else await api('POST', '/api/cahier', body);
      toast('Cahier de textes mis à jour'); f.closest('dialog')?.close(); viewCahier(state.route);
    } catch (err) { toast(err.message); }
  };
}

// ===================================================================
// 📊 Notes et moyennes
// ===================================================================
async function viewNotes(r) {
  if (isStaffRole()) return r.id ? viewNotesSaisie(r) : viewNotesStaff(r);
  const [rel, ev] = await Promise.all([api('GET', '/api/releve'), api('GET', '/api/evaluations')]);
  setTitle('📊 Mes notes', 'Tes notes, tes moyennes et la moyenne de la classe');
  const last = ev.items.filter(x => x.ma_note).slice(0, 5);
  setContent(releveHtml(rel, { last }));
}
function releveHtml(rel, { last = [] } = {}) {
  const codeNom = c => rel.codes?.[c] || c;
  return `
    <div class="grid grid-3" style="margin-bottom:16px">
      <div class="card countdown"><div class="small" style="opacity:.8">Moyenne générale</div><div class="stat">${rel.generale != null ? note20(rel.generale) + '<span style="font-size:18px">/20</span>' : '—'}</div>
        <div class="small" style="opacity:.8">moyenne des moyennes par matière</div></div>
      <div class="card"><div class="muted small">Matières notées</div><div class="stat">${rel.matieres.length}</div></div>
      <div class="card"><div class="muted small">Notes au total</div><div class="stat">${rel.matieres.reduce((a, m) => a + m.notes.length, 0)}</div></div>
    </div>
    ${last.length ? `<div class="card" style="margin-bottom:16px"><h3 style="margin-top:0">🆕 Dernières notes</h3>${last.map(x => `<div class="row" style="padding:5px 0">
      <span class="pill">${esc(x.matiere)}</span><span>${esc(x.titre)}</span><span class="spacer"></span>
      <b>${x.ma_note.code ? esc(codeNom(x.ma_note.code)) : `${note20(x.ma_note.valeur)}/${x.bareme}`}</b></div>`).join('')}</div>` : ''}
    ${rel.matieres.length ? `<div class="grid grid-2">${rel.matieres.map(m => `<div class="card">
      <div class="row"><h3 style="margin:0">${esc(m.matiere)}</h3><span class="spacer"></span><span class="pill ${noteClass(m.moyenne)}" style="font-size:15px">${m.moyenne != null ? note20(m.moyenne) + '/20' : '—'}</span></div>
      <table class="tbl"><thead><tr><th>Évaluation</th><th>Note</th><th>Coef</th><th>Classe</th></tr></thead><tbody>
      ${m.notes.map(n => `<tr><td>${esc(n.titre)}<div class="small muted">${frDay(n.date)}${n.appreciation ? ` · ${esc(n.appreciation)}` : ''}</div></td>
        <td><b>${n.code ? esc(codeNom(n.code)) : `${note20(n.valeur)}/${n.bareme}`}</b>${n.bareme !== 20 && n.sur20 != null ? `<div class="small muted">${note20(n.sur20)}/20</div>` : ''}</td>
        <td>${n.coef}</td><td class="small muted">${n.classe != null ? note20(n.classe) : '—'}</td></tr>`).join('')}</tbody></table></div>`).join('')}</div>`
      : '<div class="card empty">Pas encore de note publiée.</div>'}`;
}
async function viewNotesStaff(r) {
  await subjectNames();
  const d = await api('GET', '/api/evaluations');
  setTitle('📊 Notes', 'Crée une évaluation, saisis les notes, publie-les aux élèves');
  setContent(`
    <div class="grid grid-2" style="align-items:start">
      <form class="card" id="eval-form"><h3 style="margin-top:0">➕ Nouvelle évaluation</h3>
        <label>Titre</label><input type="text" name="titre" maxlength="120" required placeholder="Ex. : Contrôle n°2 — TVA">
        <div class="row" style="flex-wrap:nowrap"><div style="flex:2"><label>Matière</label>${matiereInput('', true)}</div><div style="flex:1"><label>Date</label><input type="date" name="date" value="${todayIso()}"></div></div>
        <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label>Barème (sur)</label><input type="number" name="bareme" value="20" min="1" max="1000" step="any"></div>
          <div style="flex:1"><label>Coefficient</label><input type="number" name="coef" value="1" min="0" max="100" step="any"></div></div>
        <label>Classe</label><select name="classe" required>${classeOptions({}, { all: false })}</select>
        <label>Commentaire <span class="muted small">(optionnel)</span></label><input type="text" name="commentaire" maxlength="2000">
        <button class="btn primary" style="margin-top:10px">Créer et saisir les notes</button></form>
      <div class="card"><h3 style="margin-top:0">🔎 Relevé d'un élève</h3><p class="small muted">Moyennes par matière et générale d'un apprenti.</p>
        <select id="rel-eleve"><option value="">— Choisir un élève —</option></select><div id="rel-box"></div></div>
    </div>
    <div class="card" style="padding:0;margin-top:16px">${d.items.length ? d.items.map(x => `<a class="topic-row" href="#/notes/${x.id}">
      <span class="notif-ico">📊</span><div style="flex:1;min-width:0"><b>${esc(x.titre)}</b> <span class="pill">${esc(x.matiere)}</span> <span class="pill">${esc(x.cible)}</span>
      <div class="small muted">${frDay(x.date)} · sur ${x.bareme} · coef ${x.coef} · ${esc(x.author)}${x.stats.moyenne != null ? ` · moyenne ${note20(x.stats.moyenne)}` : ''}</div></div>
      <span class="pill">${x.saisies}/${x.eleves} saisies</span>${x.publiee ? '<span class="pill ok">Publiée</span>' : '<span class="pill gold">Brouillon</span>'}</a>`).join('')
      : '<div class="empty">Aucune évaluation pour l’instant.</div>'}</div>`);
  $('#eval-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      const { id } = await api('POST', '/api/evaluations', { titre: f.titre.value, matiere: f.matiere.value, date: f.date.value, bareme: f.bareme.value, coef: f.coef.value, commentaire: f.commentaire.value, ...classeValue(f.classe.value) });
      location.hash = `#/notes/${id}`;
    } catch (err) { toast(err.message); }
  };
  const contacts = await api('GET', '/api/contacts');
  const sel = $('#rel-eleve');
  if (!sel) return;
  sel.innerHTML += contacts.filter(c => c.role === 'eleve').map(c => `<option value="${c.id}">${esc(c.display_name)} — ${esc(c.cible)}</option>`).join('');
  sel.onchange = async () => {
    if (!sel.value) { $('#rel-box').innerHTML = ''; return; }
    const rel = await api('GET', `/api/releve?user_id=${sel.value}`);
    $('#rel-box').innerHTML = `<div style="margin-top:12px">${rel.generale != null ? `<p>Moyenne générale : <b>${note20(rel.generale)}/20</b></p>` : '<p class="muted small">Pas encore de note publiée.</p>'}
      ${rel.matieres.map(m => `<div class="row small" style="padding:3px 0"><span>${esc(m.matiere)}</span><span class="spacer"></span><b>${m.moyenne != null ? note20(m.moyenne) : '—'}</b></div>`).join('')}</div>`;
  };
}
async function viewNotesSaisie(r) {
  const d = await api('GET', `/api/evaluations/${r.id}`);
  const ev = d.evaluation;
  setTitle(`📊 ${esc(ev.titre)}`, `${esc(ev.matiere)} · ${esc(ev.cible)} · ${frDay(ev.date)} · sur ${ev.bareme} · coef ${ev.coef}`);
  setContent(`<div class="row" style="margin-bottom:12px"><a href="#/notes" class="small">← Toutes les évaluations</a><span class="spacer"></span>
      ${ev.publiee ? '<span class="pill ok">Publiée : les élèves voient leur note</span>' : '<span class="pill gold">Brouillon : invisible pour les élèves</span>'}
      ${ev.can_edit ? '<button class="btn sm danger" id="eval-del">Supprimer</button>' : ''}</div>
    <form class="card" id="notes-form">
      <table class="tbl"><thead><tr><th>Élève</th><th>Note /${ev.bareme}</th><th>ou</th><th>Appréciation</th></tr></thead><tbody>
      ${d.eleves.map(s => `<tr data-uid="${s.id}"><td>${avatar(s.display_name)} ${esc(s.display_name)}</td>
        <td><input type="text" inputmode="decimal" name="v" value="${s.note?.valeur != null ? String(s.note.valeur).replace('.', ',') : ''}" style="width:80px" ${ev.can_edit ? '' : 'disabled'}></td>
        <td><select name="c" style="width:auto" ${ev.can_edit ? '' : 'disabled'}><option value="">—</option>${Object.entries(d.codes).map(([k, v]) => `<option value="${k}" ${s.note?.code === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><input type="text" name="a" maxlength="500" value="${esc(s.note?.appreciation || '')}" ${ev.can_edit ? '' : 'disabled'}></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun élève dans cette classe.</td></tr>'}
      </tbody></table>
      ${ev.can_edit ? `<div class="row" style="margin-top:12px"><button class="btn" name="save">💾 Enregistrer</button>${ev.publiee ? '' : '<button class="btn primary" name="pub">📣 Enregistrer et publier</button>'}
        <span class="small muted">Statistiques de classe affichées aux élèves à partir de 3 notes. ${ev.stats.moyenne != null ? `Moyenne : <b>${note20(ev.stats.moyenne)}</b> · min ${note20(ev.stats.min)} · max ${note20(ev.stats.max)}` : ''}</span></div>` : ''}
    </form>`);
  const f = $('#notes-form');
  f.querySelectorAll('input[name=v]').forEach(i => i.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); i.closest('tr').nextElementSibling?.querySelector('input[name=v]')?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); i.closest('tr').previousElementSibling?.querySelector('input[name=v]')?.focus(); }
  }));
  f.onsubmit = async e => {
    e.preventDefault();
    const publier = e.submitter?.name === 'pub';
    const notes = [...f.querySelectorAll('tr[data-uid]')].map(tr => ({ user_id: +tr.dataset.uid, valeur: tr.querySelector('[name=v]').value.trim(), code: tr.querySelector('[name=c]').value, appreciation: tr.querySelector('[name=a]').value }));
    try { await api('PUT', `/api/evaluations/${ev.id}/notes`, { notes, publier }); toast(publier ? 'Notes publiées 📣' : 'Notes enregistrées'); viewNotesSaisie(r); }
    catch (err) { toast(err.message); }
  };
  $('#eval-del')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cette évaluation et toutes ses notes ?')) return;
    await api('DELETE', `/api/evaluations/${ev.id}`); location.hash = '#/notes';
  });
}

// ===================================================================
// 🗂️ Vie scolaire : appel, absences, justificatifs
// ===================================================================
async function viewVieScolaire(r) {
  if (isStaffRole()) return r.id === 'appel' && r.q.id ? viewAppel(r) : viewVieScolaireStaff(r);
  const d = await api('GET', '/api/viescolaire');
  setTitle('🗂️ Vie scolaire', 'Tes absences et retards relevés au CFA, et tes justificatifs');
  const rs = d.resume;
  const aJustifier = d.evenements.filter(e => !e.justif_id || e.justif_statut === 'refusee');
  const st = e => e.justifiee ? '<span class="pill ok">Justifiée</span>' : e.justif_statut === 'attente' ? '<span class="pill accent">Justificatif envoyé</span>' : e.justif_statut === 'refusee' ? '<span class="pill" style="color:var(--danger)">Justificatif refusé</span>' : '<span class="pill gold">À justifier</span>';
  setContent(`
    <div class="grid grid-3" style="margin-bottom:16px">
      <div class="card"><div class="muted small">Absences</div><div class="stat">${rs.absences}</div><div class="small muted">dont ${rs.absences_non_justifiees} non justifiée(s)</div></div>
      <div class="card"><div class="muted small">Retards</div><div class="stat">${rs.retards}</div><div class="small muted">dont ${rs.retards_non_justifies} non justifié(s)</div></div>
      <div class="card ${rs.a_justifier ? 'alt-banner' : ''}"><div class="muted small">À justifier</div><div class="stat">${rs.a_justifier}</div><div class="small muted">${rs.a_justifier ? 'Envoie ton justificatif ci-dessous' : 'Tout est en ordre 👍'}</div></div>
    </div>
    <p class="small muted">💡 Une absence au CFA est une absence au travail : préviens aussi ton entreprise. Tu peux prévenir à l’avance en ajoutant une absence dans ton <a href="#/planning">planning</a>.</p>
    <form class="card" id="justif-form" style="padding:0">
      ${d.evenements.length ? d.evenements.map(e => `<label class="topic-row" style="cursor:${(!e.justif_id || e.justif_statut === 'refusee') ? 'pointer' : 'default'}">
        ${(!e.justif_id || e.justif_statut === 'refusee') ? `<input type="checkbox" name="appel" value="${e.appel_id}">` : '<span style="width:16px"></span>'}
        <span class="notif-ico">${e.statut === 'absent' ? '🚩' : '⏰'}</span>
        <div style="flex:1"><b>${e.statut === 'absent' ? 'Absence' : `Retard${e.minutes ? ` de ${e.minutes} min` : ''}`}</b> · ${frLong(e.date)} · ${esc(e.creneau_nom)}
          <div class="small muted">${e.matiere ? esc(e.matiere) + ' · ' : ''}appel fait par ${esc(e.formateur)}</div></div>${st(e)}</label>`).join('')
        : '<div class="empty">Aucune absence ni retard relevé. Bravo 👏</div>'}
      ${aJustifier.length ? `<div style="padding:14px 16px;border-top:1px solid var(--border)">
        <h3 style="margin-top:0">📎 Justifier les absences cochées</h3>
        <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label>Motif</label><select name="motif" required><option value="">— Choisir —</option>${Object.entries(d.motifs).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
          <div style="flex:2"><label>Précision <span class="muted small">(pas de détail médical)</span></label><input type="text" name="commentaire" maxlength="1000" placeholder="Ex. : bus en panne, convocation à la préfecture…"></div></div>
        <textarea name="dummy" hidden></textarea>${attachUi()}
        <button class="btn primary" style="margin-top:10px">Envoyer le justificatif</button></div>` : ''}
    </form>
    ${d.justifs.length ? `<h3 style="margin-top:20px">Mes justificatifs</h3><div class="card" style="padding:0">${d.justifs.map(j => `<div class="topic-row" style="cursor:default">
      <span class="notif-ico">📄</span><div style="flex:1"><b>${esc(j.motif_nom)}</b>${j.commentaire ? ` — ${esc(j.commentaire)}` : ''}<div class="small muted">Envoyé ${fmtDate(j.created_at)}${j.reponse ? ` · Réponse : ${esc(j.reponse)}` : ''}</div>${renderAttachments(j.attachments)}</div>
      <span class="pill ${j.statut === 'acceptee' ? 'ok' : j.statut === 'refusee' ? '' : 'accent'}">${esc(j.statut_nom)}</span></div>`).join('')}</div>` : ''}`);
  const f = $('#justif-form');
  if (!f.motif) return;
  const box = bindAttach(f, f.dummy);
  f.onsubmit = async e => {
    e.preventDefault();
    if (box.busy()) return toast('Attends la fin de l’envoi des fichiers');
    const appels = [...f.querySelectorAll('input[name=appel]:checked')].map(c => +c.value);
    if (!appels.length) return toast('Coche au moins une absence ou un retard');
    try { await api('POST', '/api/justifs', { appels, motif: f.motif.value, commentaire: f.commentaire.value, attachments: box.ids() }); toast('Justificatif envoyé ✅'); viewVieScolaire(r); }
    catch (err) { toast(err.message); }
  };
}
async function viewVieScolaireStaff(r) {
  await subjectNames();
  const d = await api('GET', '/api/appels');
  setTitle('🗂️ Vie scolaire', 'Feuille d’appel, justificatifs à traiter, synthèse des absences');
  setContent(`
    <div class="grid grid-2" style="align-items:start">
      <form class="card" id="appel-new"><h3 style="margin-top:0">✅ Faire l'appel</h3>
        <label>Classe</label><select name="classe" required>${classeOptions({}, { all: false })}</select>
        <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label>Date</label><input type="date" name="date" value="${todayIso()}"></div>
          <div style="flex:1"><label>Créneau</label><select name="creneau">${Object.entries(d.creneaux).map(([k, v]) => `<option value="${k}" ${k === (new Date().getHours() < 13 ? 'matin' : 'aprem') ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
        <label>Matière <span class="muted small">(optionnel)</span></label>${matiereInput()}
        <button class="btn primary" style="margin-top:10px">Ouvrir la feuille d'appel</button></form>
      <div class="card"><h3 style="margin-top:0">📥 Justificatifs à traiter (${d.justifs.length})</h3>
        ${d.justifs.length ? d.justifs.map(j => `<div class="sub-item"><div class="row"><b>${esc(j.eleve)}</b><span class="pill">${esc(j.motif_nom)}</span><span class="spacer"></span><span class="small muted">${fmtDate(j.created_at)}</span></div>
          ${j.commentaire ? `<div class="small">${esc(j.commentaire)}</div>` : ''}
          <div class="small muted">${j.lignes.map(l => `${l.statut === 'absent' ? '🚩' : '⏰'} ${frDay(l.date)} ${esc(l.creneau_nom)}${l.matiere ? ` (${esc(l.matiere)})` : ''}`).join(' · ')}</div>
          ${renderAttachments(j.attachments)}
          <form class="row justif-traite" data-j="${j.id}" style="flex-wrap:nowrap;margin-top:6px"><input type="text" name="reponse" maxlength="1000" placeholder="Réponse (optionnel)">
            <button class="btn sm primary" name="acceptee">Accepter</button><button class="btn sm danger" name="refusee">Refuser</button></form></div>`).join('')
          : '<p class="muted small">Rien à traiter 👍</p>'}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="row"><h3 style="margin:0">📈 Synthèse par élève</h3><span class="spacer"></span><select id="syn-classe" style="width:auto">${classeOptions({}, { all: true })}</select></div><div id="syn-box"></div></div>
    <h3 style="margin-top:20px">Derniers appels</h3>
    <div class="card" style="padding:0">${d.appels.length ? d.appels.map(a => `<a class="topic-row" href="#/viescolaire/appel?id=${a.id}"><span class="notif-ico">✅</span>
      <div style="flex:1"><b>${frLong(a.date)} · ${esc(d.creneaux[a.creneau])}</b> <span class="pill">${esc(a.cible)}</span>${a.matiere ? ` <span class="pill">${esc(a.matiere)}</span>` : ''}<div class="small muted">${esc(a.author)}</div></div>
      ${a.absents ? `<span class="pill" style="color:var(--danger)">${a.absents} absent(s)</span>` : ''}${a.retards ? `<span class="pill gold">${a.retards} retard(s)</span>` : ''}${!a.absents && !a.retards ? '<span class="pill ok">Tous présents</span>' : ''}</a>`).join('')
      : '<div class="empty">Aucun appel pour l’instant.</div>'}</div>`);
  $('#appel-new').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      const { id, existant } = await api('POST', '/api/appels', { date: f.date.value, creneau: f.creneau.value, matiere: f.matiere.value, ...classeValue(f.classe.value) });
      if (existant) toast('Cet appel existe déjà : tu peux le modifier');
      location.hash = `#/viescolaire/appel?id=${id}`;
    } catch (err) { toast(err.message); }
  };
  $$('.justif-traite').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    try { await api('POST', `/api/justifs/${f.dataset.j}`, { statut: e.submitter?.name, reponse: f.reponse.value }); toast('Réponse envoyée à l’élève'); viewVieScolaireStaff(r); }
    catch (err) { toast(err.message); }
  });
  const syn = async () => {
    const t = classeValue($('#syn-classe').value);
    const rows = await api('GET', `/api/viescolaire/synthese?${new URLSearchParams(Object.entries(t).filter(([, v]) => v))}`);
    $('#syn-box').innerHTML = rows.length ? `<table class="tbl"><thead><tr><th>Élève</th><th>Absences</th><th>Non justifiées</th><th>Retards</th></tr></thead><tbody>
      ${rows.map(s => `<tr><td>${esc(s.display_name)}</td><td>${s.absences}</td><td>${s.absences_non_justifiees ? `<b style="color:var(--danger)">${s.absences_non_justifiees}</b>` : 0}</td><td>${s.retards}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Aucun élève.</p>';
  };
  $('#syn-classe').onchange = syn;
  syn();
}
async function viewAppel(r) {
  const d = await api('GET', `/api/appels/${r.q.id}`);
  const a = d.appel;
  setTitle('✅ Feuille d’appel', `${esc(a.cible)} · ${frLong(a.date)} · ${esc(d.creneaux[a.creneau])}${a.matiere ? ` · ${esc(a.matiere)}` : ''}`);
  setContent(`<div class="row" style="margin-bottom:12px"><a href="#/viescolaire" class="small">← Vie scolaire</a><span class="spacer"></span>
      <button class="btn sm" id="all-present">Tout le monde présent</button><button class="btn sm danger" id="appel-del">Supprimer l'appel</button></div>
    <form class="card" id="appel-form" style="padding:0">
      ${d.eleves.map(s => `<div class="topic-row appel-row" data-uid="${s.id}" style="cursor:default">${avatar(s.display_name)}<b style="flex:1">${esc(s.display_name)}</b>
        <div class="seg">${Object.entries(d.statuts).map(([k, v]) => `<button type="button" data-st="${k}" class="${s.statut === k ? 'on' : ''}">${{ present: '✅', absent: '🚩', retard: '⏰' }[k]} ${v}</button>`).join('')}</div>
        <input type="number" name="min" min="0" max="600" placeholder="min" value="${s.minutes ?? ''}" style="width:80px" ${s.statut === 'retard' ? '' : 'hidden'}></div>`).join('')}
      <div style="padding:14px 16px"><button class="btn primary">Enregistrer l'appel</button> <span class="small muted">Les absents et retardataires sont prévenus pour envoyer un justificatif.</span></div>
    </form>`);
  const setSt = (row, st) => { row.querySelectorAll('[data-st]').forEach(b => b.classList.toggle('on', b.dataset.st === st)); row.querySelector('[name=min]').hidden = st !== 'retard'; };
  $$('.appel-row').forEach(row => row.querySelectorAll('[data-st]').forEach(b => b.onclick = () => setSt(row, b.dataset.st)));
  $('#all-present').onclick = () => $$('.appel-row').forEach(row => setSt(row, 'present'));
  $('#appel-form').onsubmit = async e => {
    e.preventDefault();
    const eleves = $$('.appel-row').map(row => ({ id: +row.dataset.uid, statut: row.querySelector('[data-st].on')?.dataset.st || 'present', minutes: row.querySelector('[name=min]').value }));
    try { await api('PUT', `/api/appels/${a.id}`, { eleves }); toast('Appel enregistré ✅'); location.hash = '#/viescolaire'; }
    catch (err) { toast(err.message); }
  };
  $('#appel-del').onclick = async () => {
    if (!confirm('Supprimer cet appel ?')) return;
    await api('DELETE', `/api/appels/${a.id}`); location.hash = '#/viescolaire';
  };
}

// ===================================================================
// ✉️ Messagerie formateurs ↔ élèves
// ===================================================================
async function viewMessages(r) {
  if (r.id) return viewConversation(r);
  const list = await api('GET', '/api/convs');
  const staff = isStaffRole();
  setTitle('✉️ Messagerie', staff ? 'Écris à un élève, à plusieurs ou à toute une classe' : 'Écris à tes formateurs et à l’équipe du CFA (pour parler entre élèves, utilise les salons)');
  setContent(`<div class="row" style="margin-bottom:12px"><button class="btn primary" id="conv-new">✍️ Nouveau message</button></div>
    <div class="card" style="padding:0">${list.length ? list.map(c => `<a class="topic-row" href="#/messages/${c.id}">
      ${avatar(c.avec[0] || '?')}<div style="flex:1;min-width:0"><div><b>${esc(c.sujet)}</b>${c.unread ? ` <span class="badge">${c.unread}</span>` : ''}${c.reponses ? '' : ' <span class="pill">info</span>'}</div>
      <div class="small muted">avec ${esc(c.avec.join(', '))}${c.nb > c.avec.length ? ` et ${c.nb - c.avec.length} autre(s)` : ''}</div>
      ${c.dernier ? `<div class="small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.dernier.auteur)} : ${esc(c.dernier.extrait)}</div>` : ''}</div>
      <span class="small muted">${fmtDate(c.last_at)}</span></a>`).join('') : '<div class="empty">Aucun message pour l’instant.</div>'}</div>`);
  $('#conv-new').onclick = () => openNewConv();
}
async function openNewConv(preset = {}) {
  const contacts = await api('GET', '/api/contacts');
  const staff = isStaffRole();
  const d = showDialog(`<h3 style="margin-top:0">✍️ Nouveau message</h3><form id="conv-form">
    ${staff ? `<label>À toute une classe <span class="muted small">(optionnel)</span></label><select name="classe"><option value="">— Non —</option>${classeOptions({}, { all: false })}</select>` : ''}
    <label>${staff ? 'Et / ou à des personnes' : 'À'}</label><input type="text" id="conv-q" placeholder="🔎 Chercher un nom…" autocomplete="off">
    <div class="conv-contacts" id="conv-list">${contacts.map(c => `<label class="toggle small" data-name="${esc(norm(c.display_name))}"><input type="checkbox" name="to" value="${c.id}" ${preset.to === c.id ? 'checked' : ''}> ${esc(c.display_name)} <span class="pill">${esc(c.role_nom)}${c.cible ? ' · ' + esc(c.cible) : ''}</span></label>`).join('') || '<p class="muted small">Personne à contacter.</p>'}</div>
    <label>Sujet</label><input type="text" name="sujet" maxlength="120" required value="${esc(preset.sujet || '')}">
    <label>Message</label><textarea name="message" rows="5" maxlength="5000" required></textarea>
    ${staff ? '<label class="toggle"><input type="checkbox" name="reponses" checked> Les élèves peuvent répondre</label>' : ''}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Envoyer</button></div></form>`, { ok: false });
  const f = d.querySelector('#conv-form');
  d.querySelector('[data-close]').onclick = () => d.close();
  d.querySelector('#conv-q').oninput = e => { const t = norm(e.target.value); d.querySelectorAll('#conv-list label').forEach(l => { l.hidden = t && !l.dataset.name.includes(t); }); };
  f.onsubmit = async e => {
    e.preventDefault();
    const to = [...f.querySelectorAll('input[name=to]:checked')].map(c => +c.value);
    const body = { sujet: f.sujet.value, message: f.message.value, to };
    if (staff) { if (f.classe.value) body.classe = classeValue(f.classe.value); body.reponses = f.reponses.checked; }
    try { const { id } = await api('POST', '/api/convs', body); d.close(); toast('Message envoyé ✉️'); location.hash = `#/messages/${id}`; }
    catch (err) { toast(err.message); }
  };
}
async function viewConversation(r) {
  const c = await api('GET', `/api/convs/${r.id}`);
  setTitle(`✉️ ${esc(c.sujet)}`, c.membres.map(m => `${esc(m.display_name)} (${esc(m.role_nom)})`).join(', ') + (c.autres_eleves ? ` et ${c.autres_eleves} autre(s) élève(s)` : ''));
  setContent(`<div class="row" style="margin-bottom:12px"><a href="#/messages" class="small">← Tous les messages</a><span class="spacer"></span><button class="btn sm" id="conv-leave">Retirer de ma liste</button></div>
    ${c.autres_eleves ? '<p class="small muted">🔒 Message envoyé à un groupe : ta réponse n’est lue que par les formateurs, pas par les autres élèves.</p>' : ''}
    <div class="card conv-thread">${c.messages.map(m => `<div class="conv-msg ${m.mine ? 'mine' : ''}"><div class="small muted">${esc(m.auteur)} · ${fmtDate(m.at)}</div>${md(m.content)}</div>`).join('')}</div>
    ${c.can_reply ? `<form class="card" id="conv-reply" style="margin-top:12px"><textarea name="content" rows="3" maxlength="5000" placeholder="Ta réponse… (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)" required></textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary">Envoyer</button></div></form>` : '<p class="muted small" style="margin-top:12px">ℹ️ Message d’information : les réponses sont fermées.</p>'}`);
  const th = $('.conv-thread'); th.scrollTop = th.scrollHeight;
  const f = $('#conv-reply');
  if (f) {
    f.content.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
    f.onsubmit = async e => {
      e.preventDefault();
      try { await api('POST', `/api/convs/${c.id}/messages`, { content: f.content.value }); beep('message'); viewConversation(r); }
      catch (err) { toast(err.message); }
    };
  }
  $('#conv-leave').onclick = async () => { if (!confirm('Retirer cette discussion de ta liste ?')) return; await api('POST', `/api/convs/${c.id}/leave`); location.hash = '#/messages'; };
  refreshMsgBadge();
}
async function refreshMsgBadge() {
  try { state.unreadMsgs = (await api('GET', '/api/convs-unread')).unread; renderSidebar(); } catch { /* ignoré */ }
}

// ===================================================================
// 📘 Livret d'apprentissage (apprenti, formateur, tuteur)
// ===================================================================
function evalsHtml(p, l) {
  const keys = Object.keys(p.tuteur_evals || {});
  if (!keys.length) return '';
  return `<div class="livret-evals">${Object.entries(l.criteres).filter(([k]) => p.tuteur_evals[k]).map(([k, v]) => `<span class="pill ${{ A: 'ok', EC: 'accent', NA: 'gold' }[p.tuteur_evals[k]]}">${esc(v)} : ${esc(l.niveaux[p.tuteur_evals[k]])}</span>`).join(' ')}</div>`;
}
function periodeHtml(p, l, { staff = false, moi = false } = {}) {
  return `<div class="card livret-periode" style="margin-bottom:12px">
    <div class="row"><b>${esc(p.titre)}</b>${p.debut ? `<span class="small muted">${frDay(p.debut)} → ${frDay(p.fin)}</span>` : ''}<span class="spacer"></span>
      ${p.signee ? `<span class="pill ok">✍️ Signé par ${esc(p.tuteur_nom)}</span>` : p.tuteur_appreciation ? '<span class="pill accent">Commenté, pas encore signé</span>' : '<span class="pill gold">En attente du tuteur</span>'}
      ${moi && !p.signee ? `<button class="btn sm" data-edit-p="${p.id}">Modifier</button><button class="btn sm danger" data-del-p="${p.id}">Supprimer</button>` : ''}</div>
    ${p.activites ? `<h4>🛠️ Ce que j'ai fait en entreprise</h4>${md(p.activites)}` : ''}
    ${p.appris ? `<h4>🎓 Ce que j'ai appris</h4>${md(p.appris)}` : ''}
    ${p.difficultes ? `<h4>🤔 Difficultés / questions</h4>${md(p.difficultes)}` : ''}
    ${p.tuteur_appreciation ? `<div class="explain"><b>Avis du tuteur${p.tuteur_nom ? ` (${esc(p.tuteur_nom)})` : ''} :</b>${md(p.tuteur_appreciation)}${evalsHtml(p, l)}</div>` : ''}
    ${p.formateur_remarque ? `<div class="explain" style="border-left-color:var(--gold)"><b>Remarque du CFA${p.formateur ? ` (${esc(p.formateur)})` : ''} :</b>${md(p.formateur_remarque)}</div>` : ''}
    ${staff ? `<form class="row remarque-form" data-p="${p.id}" style="flex-wrap:nowrap;margin-top:8px"><input type="text" name="r" maxlength="4000" placeholder="Remarque du CFA" value="${esc(p.formateur_remarque || '')}"><button class="btn sm primary">Enregistrer</button></form>` : ''}
  </div>`;
}
const periodeFields = (p = {}) => `
  <label>Titre de la période</label><input type="text" name="titre" maxlength="120" required value="${esc(p.titre || '')}" placeholder="Ex. : Semaines du 3 au 21 novembre">
  <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label>Du</label><input type="date" name="debut" value="${esc(p.debut || '')}"></div><div style="flex:1"><label>Au</label><input type="date" name="fin" value="${esc(p.fin || '')}"></div></div>
  <label>Ce que j'ai fait en entreprise <span class="muted small">(missions, outils, avec qui — sans info confidentielle)</span></label><textarea name="activites" rows="4" maxlength="8000">${esc(p.activites || '')}</textarea>
  <label>Ce que j'ai appris</label><textarea name="appris" rows="2" maxlength="4000">${esc(p.appris || '')}</textarea>
  <label>Difficultés / questions pour le CFA ou le tuteur</label><textarea name="difficultes" rows="2" maxlength="4000">${esc(p.difficultes || '')}</textarea>`;
const periodeBody = f => ({ titre: f.titre.value, debut: f.debut.value || null, fin: f.fin.value || null, activites: f.activites.value, appris: f.appris.value, difficultes: f.difficultes.value });

async function viewLivret(r) {
  const staff = isStaffRole();
  if (staff && !r.q.eleve) return viewLivretChoix();
  const l = await api('GET', `/api/livret${staff ? `?user_id=${r.q.eleve}` : ''}`);
  const a = l.apprenti;
  setTitle('📘 Livret d’apprentissage', staff ? `${esc(a.display_name)} · ${esc(a.formation || a.filiere || '')}` : 'Ce que tu fais en entreprise, l’avis de ton tuteur et les remarques du CFA');
  setContent(`
    ${staff ? '<div class="row" style="margin-bottom:12px"><a href="#/livret" class="small">← Choisir un autre apprenti</a></div>' : ''}
    <div class="grid grid-2" style="align-items:start">
      <div>
        ${l.moi ? `<details class="card fiche" ${l.periodes.length ? '' : 'open'}><summary>➕ Ajouter une période en entreprise</summary>
          <form class="body" id="periode-form">${periodeFields()}<button class="btn primary" style="margin-top:10px">Ajouter au livret</button></form></details>` : ''}
        <h3>🗓️ Périodes en entreprise (${l.periodes.length})</h3>
        ${l.periodes.length ? l.periodes.map(p => periodeHtml(p, l, { staff, moi: l.moi })).join('') : '<div class="card empty">Aucune période pour l’instant.</div>'}
      </div>
      <div>
        <div class="card"><h3 style="margin-top:0">🤝 Mon tuteur / maître d'apprentissage</h3>
          <p class="small muted">Crée un lien personnel pour ton tuteur : sans compte, il pourra lire ton livret, donner son avis et signer chaque période. Il ne voit <b>que ton livret</b> (jamais les salons, le forum ni les autres élèves).</p>
          ${l.tuteurs.map(t => `<div class="row small" style="padding:4px 0"><b>${esc(t.nom)}</b>${t.entreprise ? ` · ${esc(t.entreprise)}` : ''}<span class="spacer"></span>
            <span class="muted">${t.last_seen ? `vu ${fmtDate(t.last_seen)}` : 'jamais ouvert'}</span><button class="btn sm danger" data-revoke="${t.id}">Désactiver</button></div>
            <div class="small muted">${t.voir_absences ? '✔ voit tes absences' : '✖ ne voit pas tes absences'} · ${t.voir_notes ? '✔ voit tes notes' : '✖ ne voit pas tes notes'}</div>`).join('') || '<p class="small">Pas encore de lien tuteur.</p>'}
          <form id="tuteur-form" style="margin-top:10px">
            <div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label>Nom du tuteur</label><input type="text" name="nom" maxlength="80" required></div><div style="flex:1"><label>Entreprise</label><input type="text" name="entreprise" maxlength="120"></div></div>
            <label class="toggle small"><input type="checkbox" name="voir_absences" checked> Il peut voir mes absences et retards au CFA</label>
            <label class="toggle small"><input type="checkbox" name="voir_notes"> Il peut voir mes notes et moyennes</label>
            <button class="btn" style="margin-top:8px">🔗 Créer le lien tuteur</button></form>
        </div>
        ${l.absences ? `<div class="card" style="margin-top:16px"><h3 style="margin-top:0">🗂️ Assiduité au CFA</h3><p>${l.absences.absences} absence(s) dont ${l.absences.absences_non_justifiees} non justifiée(s) · ${l.absences.retards} retard(s)</p><a class="small" href="#/viescolaire">Voir le détail</a></div>` : ''}
        <div class="card" style="margin-top:16px"><h3 style="margin-top:0">🚗 Visites et points de suivi du CFA</h3>
          ${l.visites.map(v => `<div class="sub-item"><div class="row"><b>${esc(v.type_nom)}</b><span class="small muted">${frLong(v.date)} · ${esc(v.auteur)}</span><span class="spacer"></span>${staff ? `<button class="btn sm danger" data-del-v="${v.id}">✕</button>` : ''}</div>${v.compte_rendu ? md(v.compte_rendu) : ''}</div>`).join('') || '<p class="small muted">Aucune visite notée.</p>'}
          ${staff ? `<form id="visite-form" style="margin-top:10px"><div class="row" style="flex-wrap:nowrap"><div style="flex:1"><label>Date</label><input type="date" name="date" value="${todayIso()}"></div>
            <div style="flex:1"><label>Type</label><select name="type">${Object.entries(l.types_visite).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div></div>
            <label>Compte rendu</label><textarea name="cr" rows="3" maxlength="6000"></textarea><button class="btn primary" style="margin-top:8px">Ajouter</button></form>` : ''}
        </div>
      </div>
    </div>
    <dialog class="card dialog wide" id="periode-dlg"><h3 style="margin-top:0">Modifier la période</h3><form id="periode-edit"></form></dialog>`);
  const reload = () => viewLivret(r);
  $('#periode-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('POST', '/api/livret/periodes', periodeBody(e.target)); toast('Période ajoutée 📘'); reload(); } catch (err) { toast(err.message); }
  });
  $$('[data-edit-p]').forEach(b => b.onclick = () => {
    const p = l.periodes.find(x => x.id === +b.dataset.editP);
    const f = $('#periode-edit');
    f.innerHTML = `${periodeFields(p)}<div class="row" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn" onclick="this.closest('dialog').close()">Annuler</button><button class="btn primary">Enregistrer</button></div>`;
    f.onsubmit = async e => { e.preventDefault(); try { await api('PATCH', `/api/livret/periodes/${p.id}`, periodeBody(f)); $('#periode-dlg').close(); reload(); } catch (err) { toast(err.message); } };
    $('#periode-dlg').showModal();
  });
  $$('[data-del-p]').forEach(b => b.onclick = async () => { if (!confirm('Supprimer cette période ?')) return; await api('DELETE', `/api/livret/periodes/${b.dataset.delP}`); reload(); });
  $$('.remarque-form').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    try { await api('PATCH', `/api/livret/periodes/${f.dataset.p}`, { formateur_remarque: f.r.value }); toast('Remarque enregistrée'); } catch (err) { toast(err.message); }
  });
  $('#tuteur-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      const { token } = await api('POST', '/api/livret/tuteurs', { user_id: staff ? a.id : undefined, nom: f.nom.value, entreprise: f.entreprise.value, voir_absences: f.voir_absences.checked, voir_notes: f.voir_notes.checked });
      const url = `${location.origin}/#/tuteur/${token}`;
      const dlg = showDialog(`<h3 style="margin-top:0">🔗 Lien pour ${esc(f.nom.value)}</h3>
        <p class="small">Envoie ce lien à ton tuteur (mail, WhatsApp…). <b>Il ne sera plus affiché ensuite</b> : copie-le maintenant. Tu peux le désactiver à tout moment.</p>
        <input type="text" readonly value="${esc(url)}" id="tut-url"><div class="row" style="margin-top:10px"><button class="btn primary" id="tut-copy">📋 Copier</button>
        <a class="btn" href="mailto:?subject=${encodeURIComponent('Livret d’apprentissage')}&body=${encodeURIComponent(`Bonjour,\n\nVoici le lien vers mon livret d'apprentissage du CFA CEVEDOM, pour donner votre avis et signer mes périodes en entreprise :\n${url}\n\nMerci !`)}">✉️ Par mail</a></div>`);
      dlg.querySelector('#tut-copy').onclick = () => navigator.clipboard?.writeText(url).then(() => toast('Lien copié')).catch(() => dlg.querySelector('#tut-url').select());
      dlg.addEventListener('close', reload);
    } catch (err) { toast(err.message); }
  };
  $$('[data-revoke]').forEach(b => b.onclick = async () => { if (!confirm('Désactiver ce lien ? Le tuteur n’aura plus accès au livret.')) return; await api('DELETE', `/api/livret/tuteurs/${b.dataset.revoke}`); reload(); });
  $('#visite-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try { await api('POST', '/api/livret/visites', { user_id: a.id, date: f.date.value, type: f.type.value, compte_rendu: f.cr.value }); toast('Visite ajoutée'); reload(); } catch (err) { toast(err.message); }
  });
  $$('[data-del-v]').forEach(b => b.onclick = async () => { if (!confirm('Supprimer cette visite ?')) return; await api('DELETE', `/api/livret/visites/${b.dataset.delV}`); reload(); });
}
async function viewLivretChoix() {
  const contacts = (await api('GET', '/api/contacts')).filter(c => c.role === 'eleve');
  setTitle('📘 Livrets d’apprentissage', 'Choisis un apprenti pour lire son livret, ajouter une remarque ou une visite');
  setContent(`<input type="text" id="lv-q" placeholder="🔎 Chercher un apprenti…" style="max-width:360px;margin-bottom:12px">
    <div class="card" style="padding:0" id="lv-list">${contacts.map(c => `<a class="topic-row" href="#/livret?eleve=${c.id}" data-name="${esc(norm(c.display_name + ' ' + (c.cible || '')))}">${avatar(c.display_name)}<div style="flex:1"><b>${esc(c.display_name)}</b><div class="small muted">${esc(c.cible || '')}</div></div></a>`).join('') || '<div class="empty">Aucun apprenti.</div>'}</div>`);
  $('#lv-q').oninput = e => { const t = norm(e.target.value); $$('#lv-list [data-name]').forEach(a => { a.hidden = t && !a.dataset.name.includes(t); }); };
}

// ---------- Page du tuteur (sans compte) ----------
async function renderTuteur(token) {
  app.innerHTML = '<div class="tuteur-page"><div class="wrap" id="tut"><div class="empty">Chargement…</div></div></div>';
  const box = $('#tut');
  let l;
  try {
    const res = await fetch('/api/tuteur/livret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    l = await res.json();
    if (!res.ok) throw new Error(l.error || 'Lien invalide');
  } catch (err) { box.innerHTML = `<div class="card empty">🔒 ${esc(err.message)}</div>`; return; }
  const a = l.apprenti;
  const niv = (k, cur) => Object.entries(l.niveaux).map(([n, v]) => `<label class="toggle small"><input type="radio" name="e_${k}" value="${n}" ${cur === n ? 'checked' : ''}> ${esc(v)}</label>`).join('');
  box.innerHTML = `
    <div class="brand" style="color:var(--text);padding:0 0 10px"><div class="logo" style="color:#fff">C</div><div>Classe CEVEDOM<small style="color:var(--muted)">Espace tuteur</small></div></div>
    <h1 style="margin:0">📘 Livret d’apprentissage de ${esc(a.display_name)}</h1>
    <p class="muted">${esc(a.formation || a.filiere || '')} · Bonjour ${esc(l.tuteur.nom)}${l.tuteur.entreprise ? ` (${esc(l.tuteur.entreprise)})` : ''} : lisez chaque période, donnez votre avis puis signez.</p>
    ${l.absences ? `<div class="card" style="margin-bottom:16px"><h3 style="margin-top:0">🗂️ Assiduité au CFA</h3><p>${l.absences.absences} absence(s) dont <b>${l.absences.absences_non_justifiees} non justifiée(s)</b> · ${l.absences.retards} retard(s)</p>
      ${(l.absences_detail || []).length ? `<table class="tbl"><tbody>${l.absences_detail.map(e => `<tr><td>${e.statut === 'absent' ? '🚩 Absence' : '⏰ Retard'}</td><td>${frLong(e.date)} · ${esc(e.creneau_nom)}</td><td>${e.justifiee ? '<span class="pill ok">Justifiée</span>' : '<span class="pill gold">Non justifiée</span>'}</td></tr>`).join('')}</tbody></table>` : ''}</div>` : ''}
    ${l.releve ? `<div class="card" style="margin-bottom:16px"><h3 style="margin-top:0">📊 Résultats au CFA</h3>${l.releve.generale != null ? `<p>Moyenne générale : <b>${note20(l.releve.generale)}/20</b></p>` : '<p class="muted">Pas encore de note.</p>'}
      ${l.releve.matieres.map(m => `<div class="row small"><span>${esc(m.matiere)}</span><span class="spacer"></span><b>${m.moyenne != null ? note20(m.moyenne) : '—'}</b></div>`).join('')}</div>` : ''}
    <h2>🗓️ Périodes en entreprise</h2>
    ${l.periodes.length ? l.periodes.map(p => p.signee ? periodeHtml(p, l) : `${periodeHtml(p, l)}
      <form class="card tut-form" data-p="${p.id}" style="margin:-4px 0 16px;border-color:var(--accent)">
        <h3 style="margin-top:0">Votre avis sur « ${esc(p.titre)} »</h3>
        <table class="tbl"><tbody>${Object.entries(l.criteres).map(([k, v]) => `<tr><td>${esc(v)}</td><td><div class="row" style="gap:10px">${niv(k, p.tuteur_evals?.[k])}</div></td></tr>`).join('')}</tbody></table>
        <label>Appréciation</label><textarea name="app" rows="3" maxlength="4000" required>${esc(p.tuteur_appreciation || '')}</textarea>
        <div class="row" style="margin-top:10px"><button class="btn" name="save">💾 Enregistrer sans signer</button><button class="btn primary" name="sign">✍️ Enregistrer et signer</button>
          <span class="small muted">Une fois signée, la période ne peut plus être modifiée.</span></div></form>`).join('')
      : '<div class="card empty">Votre apprenti n’a pas encore rempli de période.</div>'}
    ${l.visites.length ? `<h2>🚗 Visites et points de suivi du CFA</h2>${l.visites.map(v => `<div class="card" style="margin-bottom:10px"><b>${esc(v.type_nom)}</b> · ${frLong(v.date)} · ${esc(v.auteur)}${v.compte_rendu ? md(v.compte_rendu) : ''}</div>`).join('')}` : ''}
    <p class="small muted" style="margin-top:24px">Ce lien est personnel : ne le partagez pas. Votre apprenti peut le désactiver à tout moment. Vous ne voyez que son livret.</p>`;
  $$('.tut-form').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    const signer = e.submitter?.name === 'sign';
    if (signer && !confirm('Signer cette période ? Elle ne pourra plus être modifiée.')) return;
    const evals = Object.fromEntries(Object.keys(l.criteres).map(k => [k, f.querySelector(`input[name=e_${k}]:checked`)?.value]).filter(([, v]) => v));
    const res = await fetch(`/api/tuteur/periodes/${f.dataset.p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, appreciation: f.app.value, evals, signer }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Erreur');
    toast(signer ? 'Période signée ✍️ Merci !' : 'Avis enregistré');
    renderTuteur(token);
  });
}

// ===================================================================
// 🎓 Ma formation & catalogue du CFA
// ===================================================================
async function viewFormation(r) {
  const id = r.id || state.user.formation;
  if (!id) return viewFormations({ q: { ...r.q, choisir: '1' } });
  const [f, subs] = await Promise.all([api('GET', `/api/formations/${id}`), state.subjectsCache ? Promise.resolve(state.subjectsCache) : api('GET', '/api/subjects')]);
  state.subjectsCache = subs;
  const subName = Object.fromEntries(subs.map(x => [x.id, x]));
  const mine = id === state.user.formation;
  const eps = [...(f.epreuves || [])].sort((a, b) => (b.coef ?? -1) - (a.coef ?? -1));
  const totalCoef = eps.reduce((t, e) => t + (e.coef || 0), 0);
  const epHtml = eps.length ? `<div class="card" style="margin-bottom:16px"><h3 style="margin-top:0">🎯 Tes épreuves${totalCoef ? ' et leurs coefficients' : ''} — par ordre d'importance</h3>
    ${totalCoef ? `<p class="small muted">Plus le coefficient est gros, plus l'épreuve pèse dans ta note finale (total : ${String(totalCoef).replace('.', ',')}). Révise d'abord le haut du tableau.</p>` : `<p class="small muted">${f.filiere === 'TP' ? 'Pas de coefficient pour un titre pro : chaque CCP doit être validé devant le jury.' : 'Coefficients non publiés dans les documents trouvés : voir le référentiel.'}</p>`}
    <table class="tbl"><thead><tr><th>Épreuve</th>${totalCoef ? '<th>Coef</th><th>Poids</th>' : ''}<th>Forme</th><th>Réviser avec</th></tr></thead><tbody>
    ${eps.map(e => `<tr><td><b>${esc(e.code)}</b> ${esc(e.nom)}</td>${totalCoef ? `<td><span class="pill ${e.coef >= 5 ? 'gold' : ''}">${e.coef != null ? String(e.coef).replace('.', ',') : '—'}</span></td><td style="min-width:90px">${e.coef ? `<div class="progress" title="${Math.round(e.coef / totalCoef * 100)} %"><div style="width:${Math.round(e.coef / totalCoef * 100)}%"></div></div><span class="small muted">${Math.round(e.coef / totalCoef * 100)} %</span>` : ''}</td>` : ''}
      <td class="small">${esc(e.forme || '')}</td><td class="small">${(e.reviser || []).filter(r => subName[r]).map(r => `<a href="#/revisions/${r}">${subName[r].icone} ${esc(subName[r].nom)}</a>`).join('<br>') || '—'}</td></tr>`).join('')}
    </tbody></table>
    ${f.epreuves_source ? `<p class="small muted">Source : <a href="${esc(f.epreuves_source.url)}" target="_blank" rel="noopener noreferrer">${esc(f.epreuves_source.titre)}</a>. Vérifie toujours ta convocation et ton référentiel.</p>` : ''}</div>` : '';
  const link = k => (k === 'referentiels' ? f.liens.referentiels : f.liens[k] ? [f.liens[k]] : []);
  setTitle(`🎓 ${esc(f.nom)}`, `${esc(f.niveau_nom)} · ${esc(f.domaine_nom)}${f.rncp ? ` · ${esc(f.rncp)}` : ''}`);
  setContent(`<div class="row" style="margin-bottom:12px"><a href="#/formations" class="small">← Toutes les formations du CFA</a>${mine ? '<span class="pill ok">Ta formation</span>' : ''}</div>
    ${f.note ? `<div class="card" style="border-color:var(--gold);margin-bottom:16px">⚠️ ${esc(f.note)}</div>` : ''}
    ${epHtml}
    <div class="grid grid-3" style="margin-bottom:16px">
      <div class="card"><div class="muted small">Durée</div><b>${esc(f.duree || '—')}</b></div>
      <div class="card"><div class="muted small">Stage / période en entreprise</div><b>${esc(f.stage || '—')}</b></div>
      <div class="card"><div class="muted small">Diplôme délivré par</div><b>${esc(f.certificateur)}</b></div>
    </div>
    <div class="grid grid-2" style="align-items:start">
      <div>
        <div class="card"><h3 style="margin-top:0">🎯 Objectif</h3><p>${esc(f.objectif)}</p>${f.prerequis ? `<p class="small muted"><b>Pour entrer :</b> ${esc(f.prerequis)}</p>` : ''}</div>
        ${f.programme.length ? `<div class="card" style="margin-top:16px"><h3 style="margin-top:0">📚 Programme ${f.filiere === 'TP' ? '(blocs / CCP)' : '(unités)'}</h3><ul>${f.programme.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
          <p class="small muted">${esc(f.commun.validation_blocs)}</p></div>` : ''}
        <div class="card" style="margin-top:16px"><h3 style="margin-top:0">📝 L'examen</h3><p class="small"><b>${esc(f.examen.type)}</b></p><ul>${f.examen.comment.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
          ${f.examen.dates.length ? `<h4>Dates nationales 2027</h4>${f.examen.dates.map(d => `<div class="ev ${d.date < todayIso() ? 'past' : ''}"><b>${fmtDay(d.date)}</b><div>${esc(d.titre)}</div></div>`).join('')}` : ''}
          <p class="small muted">Source : <a href="${esc(f.examen.source.url)}" target="_blank" rel="noopener noreferrer">${esc(f.examen.source.titre)}</a></p></div>
      </div>
      <div>
        <div class="card"><h3 style="margin-top:0">🔎 Où trouver l'info officielle</h3>
          ${f.ou_trouver.map(o => { const urls = o.url ? [o.url] : link(o.lien); return urls.length ? `<div class="sub-item"><b>${esc(o.titre)}</b><div class="small muted">${esc(o.quoi)}</div>
            ${urls.map((u, i) => `<a class="small" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${urls.length > 1 ? `Document ${i + 1}` : 'Ouvrir'} ↗</a>`).join(' · ')}</div>` : ''; }).join('')}</div>
        <div class="card" style="margin-top:16px"><h3 style="margin-top:0">💼 Débouchés</h3>${f.debouches.map(d => `<span class="pill" style="margin:2px">${esc(d)}</span>`).join('')}</div>
        <div class="card" style="margin-top:16px"><h3 style="margin-top:0">🚀 Et après ?</h3><ul>${f.poursuites.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>
        <div class="card" style="margin-top:16px"><h3 style="margin-top:0">ℹ️ Bon à savoir</h3><ul class="small"><li>${esc(f.commun.cout)}</li><li>${esc(f.commun.entree)}</li><li>${esc(f.commun.rythme)}</li></ul></div>
        ${mine ? '<div class="card" style="margin-top:16px"><a href="#/revisions">📖 Mes révisions pour cette formation →</a></div>' : ''}
      </div>
    </div>
    <p class="small muted" style="margin-top:16px">${esc(f.source)}</p>`);
}
async function viewFormations(r) {
  const d = await api('GET', '/api/formations');
  const fil = state.setup?.filieres || [];
  const q = r.q || {};
  const term = norm(q.q || '');
  const items = d.items.filter(f => (!q.filiere || f.filiere === q.filiere) && (!q.domaine || f.domaine === q.domaine) && (!term || norm(`${f.nom} ${f.rncp}`).includes(term)));
  setTitle('🏫 Les formations du CFA', `${d.items.length} formations en alternance au CFA CEVEDOM`);
  const qs = o => `#/formations?${new URLSearchParams(Object.entries({ ...q, ...o }).filter(([, v]) => v))}`;
  setContent(`
    ${q.choisir && state.user.role === 'eleve' ? '<div class="card" style="border-color:var(--accent);margin-bottom:16px">👉 Indique ta formation exacte dans <a href="#/compte">Mon compte</a> (rubrique Formation) pour voir ta fiche, tes examens et les révisions qui te concernent.</div>' : ''}
    <div class="row" style="margin-bottom:12px;flex-wrap:wrap">
      <div class="seg"><a class="${!q.filiere ? 'on' : ''}" href="${qs({ filiere: '' })}">Toutes</a>${fil.map(f => `<a class="${q.filiere === f.id ? 'on' : ''}" href="${qs({ filiere: f.id })}">${esc(f.nom)}</a>`).join('')}</div>
      <select id="fm-dom" style="width:auto"><option value="">Tous les domaines</option>${Object.entries(d.domaines).map(([k, v]) => `<option value="${k}" ${q.domaine === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <input type="text" id="fm-q" placeholder="🔎 Chercher (nom, RNCP…)" value="${esc(q.q || '')}" style="max-width:260px">
    </div>
    ${fil.filter(f => items.some(x => x.filiere === f.id)).map(f => `<div class="section-title">${esc(f.nom)} (${items.filter(x => x.filiere === f.id).length})</div>
      <div class="grid grid-3">${items.filter(x => x.filiere === f.id).map(x => `<a class="card subject-card ${x.id === state.user.formation ? 'mine' : ''}" href="#/formation/${x.id}">
        <h3 style="margin:0 0 6px">${esc(x.nom)}</h3><div class="small muted">${esc(d.domaines[x.domaine])}</div>
        <div class="row small muted" style="margin-top:8px"><span>${esc(d.niveaux[x.niveau])}</span>${x.rncp ? `<span>· ${esc(x.rncp)}</span>` : ''}${x.id === state.user.formation ? '<span class="spacer"></span><span class="pill ok">Ta formation</span>' : ''}</div></a>`).join('')}</div>`).join('') || '<div class="card empty">Aucune formation ne correspond.</div>'}
    <p class="small muted" style="margin-top:16px">${esc(d.source)}</p>`);
  $('#fm-dom').onchange = e => { location.hash = qs({ domaine: e.target.value }); };
  let t;
  $('#fm-q').oninput = e => { clearTimeout(t); t = setTimeout(() => { history.replaceState(null, '', qs({ q: e.target.value })); state.loadingHash = location.hash; viewFormations({ q: { ...q, q: e.target.value } }).then(() => { const i = $('#fm-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250); };
}

// ---------- CFA & examens ----------
async function viewInfos(r) {
  const [{ cfa }, examens] = await Promise.all([api('GET', '/api/infos'), api('GET', '/api/examens')]);
  const fil = state.setup?.filieres || [];
  const cur = r.q.filiere || state.user.filiere || 'BTS';
  const ex = examens[cur];
  setTitle('🎓 CFA & examens', 'Le CFA CEVEDOM, tes droits, et comment se passe ton examen');
  setContent(`
    <div class="grid grid-2" style="align-items:start">
      <div class="card"><h2>🏫 ${esc(cfa.nom)}</h2><p>${esc(cfa.description)}</p>
        <p>📍 ${esc(cfa.adresse)}<br>📞 <a href="tel:${esc(cfa.telephone.replace(/\s/g, ''))}">${esc(cfa.telephone)}</a></p>
        <h3>🕐 Horaires de l'accueil</h3><ul>${cfa.horaires.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
        <p class="small">🔁 ${esc(cfa.rythme)}</p>
        <h3>🔗 Liens utiles</h3><ul>${cfa.sites.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.titre)}</a></li>`).join('')}</ul>
        <p class="small"><a href="#/formations">🏫 Voir les 41 formations du CFA</a>${state.user.formation ? ` · <a href="#/formation">🎓 Ma formation</a>` : ''}</p></div>
      <div>
        <div class="card"><h2>📝 Examens 2027</h2>
          <div class="seg" style="margin-bottom:12px">${fil.map(f => `<a class="${f.id === cur ? 'on' : ''}" href="#/infos?filiere=${f.id}">${esc(f.nom)}</a>`).join('')}</div>
          ${ex ? `<p class="small"><b>${esc(ex.type)}</b></p><ul>${ex.comment.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
            ${ex.dates.length ? `<div class="ev-list">${ex.dates.map(d => `<div class="ev ${d.date < todayIso() ? 'past' : ''}"><b>${fmtDay(d.date)}</b><div>${esc(d.titre)}</div></div>`).join('')}</div>
              <p class="small muted">Dates nationales, horaires de métropole : en Guyane, fie-toi à ta convocation.</p>` : ''}
            <p class="small muted">Source : <a href="${esc(ex.source.url)}" target="_blank" rel="noopener noreferrer">${esc(ex.source.titre)}</a></p>` : ''}</div>
        <div class="card" style="margin-top:16px"><h2>⚖️ Tes droits d'apprenti</h2><ul>${cfa.droits_apprenti.map(d => `<li>${esc(d)}</li>`).join('')}</ul><a class="small" href="#/revisions/apprenti">Réviser tes droits →</a></div>
        <div class="card" style="margin-top:16px"><h2>🤝 Services du CFA</h2><ul>${cfa.services.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>
      </div>
    </div>
    <p class="small muted" style="margin-top:16px">${esc(cfa.source)}</p>`);
}
