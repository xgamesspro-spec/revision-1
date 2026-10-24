'use strict';
/* Exercices : publication par les formateurs, rendus des élèves, corrections. */

function dueLabel(t) {
  if (!t) return '<span class="muted">sans date limite</span>';
  const diff = t - Date.now();
  const date = new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hhmm(t);
  if (diff < 0) return `<span class="late">⏰ date dépassée (${date})</span>`;
  const days = Math.floor(diff / 864e5);
  return `<span class="${days < 2 ? 'soon' : ''}">📅 ${date} · ${days ? `dans ${days} j` : `dans ${Math.max(1, Math.round(diff / 3600e3))} h`}</span>`;
}
const subjectsList = () => state.subjectNames || [];

async function viewExercises(r) {
  if (r.id) return viewExercise(r);
  const d = await api('GET', '/api/exercises');
  const staff = d.staff;
  if (!state.subjectNames) state.subjectNames = (await api('GET', '/api/subjects').catch(() => [])).map(s => s.nom);
  const tab = r.q.tab || (staff ? 'tous' : 'afaire');
  const items = staff || tab === 'tous' ? d.items : d.items.filter(x => !x.done);
  setTitle('📝 Exercices', staff ? 'Publie des exercices et corrige les rendus' : 'Les exercices donnés par tes formateurs');
  setContent(`
    ${staff ? `<details class="card fiche" id="ex-new-box" ${d.items.length ? '' : 'open'}>
      <summary>➕ Publier un exercice</summary>
      <form id="ex-form" class="body">${exerciseFields({})}
        <div class="row" style="margin-top:12px"><button class="btn primary">Publier</button><span class="small muted">Les élèves concernés sont prévenus, et la date limite s'ajoute à leur planning.</span></div>
      </form></details>` : `<div class="tabs">
        <a class="tab ${tab === 'afaire' ? 'active' : ''}" href="#/exercices?tab=afaire">À faire (${d.items.filter(x => !x.done).length})</a>
        <a class="tab ${tab === 'tous' ? 'active' : ''}" href="#/exercices?tab=tous">Tous (${d.items.length})</a></div>`}
    <div class="card" style="padding:0;margin-top:16px">
      ${items.length ? items.map(x => `
        <a class="topic-row" href="#/exercices/${x.id}">
          <span class="notif-ico">📝</span>
          <div style="flex:1;min-width:0">
            <div><b>${esc(x.title)}</b> ${x.subject ? `<span class="pill">${esc(x.subject)}</span>` : ''} ${staff ? `<span class="pill">${esc(x.filiere_nom || 'Tout le CFA')}</span>` : ''}</div>
            <div class="small muted">${esc(x.author)} · ${dueLabel(x.due_at)} ${x.files ? `· 📎 ${x.files}` : ''}</div>
          </div>
          ${staff ? `<span class="pill ${x.submitted ? 'accent' : ''}">${x.submitted}/${x.students} rendus</span>${x.submitted ? `<span class="pill ${x.graded === x.submitted ? 'ok' : 'gold'}">${x.graded} corrigé(s)</span>` : ''}`
            : x.grade ? `<span class="pill ok">Noté : ${esc(x.grade)}</span>` : x.submitted ? '<span class="pill accent">Rendu</span>' : x.done ? '<span class="pill ok">Fait</span>' : '<span class="pill gold">À faire</span>'}
        </a>`).join('') : `<div class="empty">${staff ? 'Aucun exercice publié.' : tab === 'afaire' ? 'Rien à faire pour l’instant 🎉' : 'Aucun exercice.'}</div>`}
    </div>`);
  if (staff) bindExerciseForm($('#ex-form'), null);
}

function exerciseFields(ex) {
  const dueVal = ex.due_at ? `${isoDay(new Date(ex.due_at))}T${hhmm(ex.due_at)}` : '';
  return `
    <label>Titre</label><input type="text" name="title" maxlength="120" required value="${esc(ex.title || '')}" placeholder="Ex. : TP VLAN et routage inter-VLAN">
    <div class="row" style="flex-wrap:nowrap">
      <div style="flex:1"><label>Matière</label><input type="text" name="subject" maxlength="60" list="subj-list" value="${esc(ex.subject || '')}" placeholder="Réseaux, Maths…">
        <datalist id="subj-list">${subjectsList().map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
      <div style="flex:1"><label>Pour</label><select name="filiere"><option value="">Tout le CFA</option>${(state.setup?.filieres || []).map(f => `<option value="${f.id}" ${ex.filiere === f.id ? 'selected' : ''}>${esc(f.nom)}</option>`).join('')}</select></div>
      <div style="flex:1"><label>À rendre pour le</label><input type="datetime-local" name="due" value="${dueVal}"></div>
    </div>
    <label>Consigne <span class="muted small">(Markdown : **gras**, listes, \`code\`, tableaux)</span></label>
    <textarea name="content" rows="7" maxlength="20000">${esc(ex.content || '')}</textarea>
    ${attachUi()}
    <label class="toggle"><input type="checkbox" name="allow_submit" ${ex.allow_submit === 0 ? '' : 'checked'}> Les élèves rendent leur travail en ligne</label>`;
}
function bindExerciseForm(f, ex) {
  const box = bindAttach(f, f.content);
  f.onsubmit = async e => {
    e.preventDefault();
    if (box.busy()) return toast('Attends la fin de l’envoi des fichiers');
    const body = {
      title: f.title.value, subject: f.subject.value, filiere: f.filiere.value || null, content: f.content.value,
      due_at: f.due.value ? new Date(f.due.value).getTime() : null, allow_submit: f.allow_submit.checked, attachments: box.ids(),
    };
    try {
      if (ex) { await api('PATCH', `/api/exercises/${ex.id}`, body); toast('Exercice modifié'); viewExercise({ id: ex.id, q: {} }); }
      else { const { id } = await api('POST', '/api/exercises', body); toast('Exercice publié'); location.hash = `#/exercices/${id}`; }
    } catch (err) { toast(err.message); }
  };
}

async function viewExercise(r) {
  const d = await api('GET', `/api/exercises/${r.id}`);
  const ex = d.exercise;
  setTitle(`📝 ${esc(ex.title)}`, `${esc(ex.subject || 'Exercice')} · ${esc(ex.filiere_nom || 'Tout le CFA')} · ${esc(ex.author)}`);
  const consigne = `
    <div class="card">
      <div class="row"><span>${dueLabel(ex.due_at)}</span><span class="spacer"></span>
        ${ex.can_edit ? '<button class="btn sm" id="ex-edit">Modifier</button><button class="btn sm danger" id="ex-del">Supprimer</button>' : ''}</div>
      ${ex.content ? md(ex.content) : '<p class="muted">Pas de consigne écrite : voir les fichiers.</p>'}
      ${renderAttachments(ex.attachments)}
    </div>`;
  let side = '';
  if (!d.staff) {
    const m = d.mine;
    side = !ex.allow_submit ? `
      <div class="card"><h3>Mon avancement</h3>
        <label class="toggle"><input type="checkbox" id="ex-done" ${d.done ? 'checked' : ''}> J'ai fait cet exercice</label>
        <p class="small muted">Pas de rendu en ligne : suis les consignes du formateur.</p></div>`
      : m?.grade != null ? `
      <div class="card"><h3>✅ Corrigé</h3>
        <div class="grade">${esc(m.grade)}</div>
        ${m.feedback ? `<div class="explain">${md(m.feedback)}</div>` : ''}
        <h3 style="margin-top:16px">Mon rendu</h3>${m.content ? md(m.content) : ''}${renderAttachments(m.attachments)}</div>`
      : `
      <form class="card" id="sub-form"><h3 style="margin-top:0">${m ? '📤 Rendu envoyé' : '📤 Rendre mon travail'}</h3>
        ${m ? `<p class="small muted">Envoyé ${fmtDate(m.updated_at)}${m.late ? ' <span class="late">(en retard)</span>' : ''}. Tu peux le compléter tant qu'il n'est pas corrigé.</p>
          ${m.content ? md(m.content) : ''}${renderAttachments(m.attachments)}<hr>` : ''}
        <label style="margin-top:0">${m ? 'Remplacer le texte' : 'Ta réponse'} <span class="muted small">(optionnel si tu joins un fichier)</span></label>
        <textarea name="content" rows="6" maxlength="20000"></textarea>
        ${attachUi()}
        <div class="row" style="margin-top:10px"><button class="btn primary">${m ? 'Mettre à jour' : 'Rendre'}</button></div>
      </form>`;
  } else {
    side = `
      <div class="card"><h3>📥 Rendus (${d.submissions.length})</h3>
        ${d.submissions.length ? d.submissions.map(s => `
          <div class="sub-item">
            <div class="row">${avatar(s.student)}<b>${esc(s.student)}</b><span class="small muted">${fmtDate(s.updated_at)}</span>${s.late ? '<span class="pill" style="color:var(--danger)">en retard</span>' : ''}
              <span class="spacer"></span>${s.grade != null ? `<span class="pill ok">${esc(s.grade)}</span>` : '<span class="pill gold">à corriger</span>'}</div>
            ${s.content ? md(s.content) : ''}${renderAttachments(s.attachments)}
            <form class="grade-form row" data-sub="${s.id}" style="flex-wrap:nowrap;margin-top:8px">
              <input type="text" name="grade" maxlength="20" placeholder="Note (ex. 15/20)" value="${esc(s.grade && s.grade !== '—' ? s.grade : '')}" style="max-width:130px">
              <input type="text" name="feedback" maxlength="5000" placeholder="Commentaire" value="${esc(s.feedback || '')}">
              <button class="btn sm primary">${s.grade != null ? 'Modifier' : 'Corriger'}</button>
            </form>
          </div>`).join('') : '<p class="muted small">Aucun rendu pour l’instant.</p>'}
        ${d.missing.length ? `<h3 style="margin-top:16px">⏳ Pas encore rendu (${d.missing.length})</h3><p class="small">${d.missing.map(m => esc(m.display_name)).join(', ')}</p>` : ''}
      </div>`;
  }
  setContent(`<div class="row" style="margin-bottom:12px"><a href="#/exercices" class="small">← Tous les exercices</a></div>
    <div class="grid grid-2" style="align-items:start">${consigne}<div>${side}</div></div>
    ${ex.can_edit ? `<dialog class="card dialog wide" id="ex-edit-dlg"><h3 style="margin-top:0">Modifier l'exercice</h3><form id="ex-edit-form">${exerciseFields(ex)}
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn" id="ex-edit-cancel">Annuler</button><button class="btn primary">Enregistrer</button></div></form></dialog>` : ''}`);

  $('#ex-done')?.addEventListener('change', e => api('POST', `/api/exercises/${ex.id}/done`, { done: e.target.checked }).then(() => toast('Enregistré')));
  const sf = $('#sub-form');
  if (sf) {
    const box = bindAttach(sf, sf.content);
    sf.onsubmit = async e => {
      e.preventDefault();
      if (box.busy()) return toast('Attends la fin de l’envoi des fichiers');
      try { await api('POST', `/api/exercises/${ex.id}/submit`, { content: sf.content.value, attachments: box.ids() }); toast('Travail rendu ✅'); viewExercise(r); }
      catch (err) { toast(err.message); }
    };
  }
  $$('.grade-form').forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    try { await api('POST', `/api/submissions/${f.dataset.sub}/grade`, { grade: f.grade.value, feedback: f.feedback.value }); toast('Correction envoyée à l’élève'); viewExercise(r); }
    catch (err) { toast(err.message); }
  });
  $('#ex-edit')?.addEventListener('click', () => { $('#ex-edit-dlg').showModal(); });
  $('#ex-edit-cancel')?.addEventListener('click', () => $('#ex-edit-dlg').close());
  if ($('#ex-edit-form')) bindExerciseForm($('#ex-edit-form'), ex);
  $('#ex-del')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cet exercice et tous les rendus ?')) return;
    await api('DELETE', `/api/exercises/${ex.id}`); location.hash = '#/exercices';
  });
}
