'use strict';
/* Comptes : connexion (Google ou email/identifiant + mot de passe), inscription avec filière,
   écrans obligatoires, page « Mon compte », modération des comptes. */

const GOOGLE_ICON = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

const AUTH_ERRORS = {
  invite: "Code d'invitation invalide. Demande-le à un modérateur de la classe.",
  pas_de_compte: "Aucun compte n'est lié à ce compte Google. Pour t'inscrire, clique sur « Créer mon compte » et entre le code de la classe.",
  email_pris: 'Cette adresse Gmail est déjà utilisée par un autre compte.',
  suspendu: 'Ce compte est suspendu. Contacte un modérateur.',
  google: 'La connexion avec Google a échoué, réessaie.',
  annule: 'Connexion Google annulée.',
  state: 'La connexion a expiré, recommence.',
  google_off: "La connexion Google n'est pas configurée sur ce serveur.",
};

const fmtDay = d => new Date(typeof d === 'string' ? d + 'T12:00:00' : d).toLocaleDateString('fr-FR', { dateStyle: 'long' });
const schoolYearEnd = () => { const d = new Date(); return d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear(); };

// ---------- Champs « filière » ----------
function filiereFields(cur = {}, required = true) {
  const f = state.setup?.filieres || [];
  return `
    <label>Ta filière${required ? '' : ' <span class="muted small">(optionnel pour un modérateur)</span>'}</label>
    <select name="filiere" ${required ? 'required' : ''}>
      <option value="">— Choisir —</option>
      ${f.map(x => `<option value="${x.id}" ${cur.filiere === x.id ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}
    </select>
    <div class="fin-wrap"></div>
    <label>Intitulé du diplôme <span class="muted small">(optionnel)</span></label>
    <input type="text" name="intitule" maxlength="60" value="${esc(cur.intitule || '')}" placeholder="ex. SIO option SISR, Opérateur logistique, Commerce…">
    <p class="small muted fin-note"></p>`;
}
function bindFiliere(form, cur = {}) {
  const sel = form.querySelector('select[name=filiere]');
  const wrap = form.querySelector('.fin-wrap');
  const note = form.querySelector('.fin-note');
  const update = () => {
    const fil = (state.setup?.filieres || []).find(x => x.id === sel.value);
    if (!fil) { wrap.innerHTML = ''; note.textContent = ''; return; }
    if (fil.duree) {
      const Y = schoolYearEnd();
      const curYear = cur.end_date ? cur.end_date.slice(0, 4) : '';
      const opts = Array.from({ length: fil.duree }, (_, i) => {
        const year = Y + i, annee = fil.duree - i;
        return `<option value="${year}" ${String(year) === curYear ? 'selected' : ''}>${year} — je suis en ${annee === 1 ? '1re' : annee + 'e'} année${annee === fil.duree ? ' (dernière)' : ''}</option>`;
      });
      wrap.innerHTML = `<label>Année de ton examen</label><select name="fin" required><option value="">— Choisir —</option>${opts.join('')}</select>`;
    } else {
      const m = new Date(); const min = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      wrap.innerHTML = `<label>Mois de fin de ta formation</label><input type="month" name="fin" min="${min}" required value="${cur.filiere === 'TP' && cur.end_date ? cur.end_date.slice(0, 7) : ''}">`;
    }
    note.textContent = `Ton compte sera supprimé automatiquement ${state.setup?.grace_days ?? 60} jours après la fin de ta formation.`;
  };
  sel.addEventListener('change', update);
  update();
}

function authShell(inner) {
  app.innerHTML = `<div class="auth"><div class="card">
    <div class="brand" style="padding:0;color:var(--text)"><div class="logo" style="color:#fff">S</div></div>
    ${inner}
  </div></div>`;
}

// ---------- Connexion / inscription ----------
async function renderAuth(mode) {
  if (!state.setup?.filieres) { try { state.setup = await api('GET', '/api/setup'); } catch {} }
  const setup = state.setup || {};
  const r = parseRoute();
  if (r.name === 'finaliser' && r.q.t) return renderFinishGoogle(r.q.t);
  if (setup.firstUser) mode = 'first';
  mode = mode || (r.name === 'inscription' ? 'register' : 'login');
  const err = AUTH_ERRORS[r.q.err] || '';
  const googleBtn = (href, label) => `<a class="btn google-btn" href="${href}">${GOOGLE_ICON}<span>${label}</span></a>`;

  if (mode === 'login') {
    authShell(`
      <h1>Connexion</h1>
      <p class="muted small" style="margin-top:0">Espace réservé aux élèves du CFA.</p>
      ${err ? `<div class="error" style="margin-bottom:12px">${esc(err)}</div>` : ''}
      ${setup.google ? `${googleBtn('/auth/google', 'Continuer avec Google')}<div class="or"><span>ou</span></div>` : ''}
      <form id="auth-form">
        <label for="f-user">Email ou identifiant</label>
        <input type="text" id="f-user" name="username" autocomplete="username" required>
        <label for="f-pass">Mot de passe</label>
        <input type="password" id="f-pass" name="password" autocomplete="current-password" required>
        <div class="error" id="auth-err"></div>
        <button class="btn primary" style="width:100%;margin-top:8px">Se connecter</button>
      </form>
      <p class="small muted">Mot de passe oublié ? ${setup.google ? 'Connecte-toi avec Google, ou d' : 'D'}emande à un modérateur de le réinitialiser.</p>
      <p class="small" style="text-align:center;margin-bottom:0">Pas encore de compte ? <a href="#" id="switch">Créer mon compte</a></p>`);
    $('#switch').onclick = e => { e.preventDefault(); renderAuth('register'); };
    $('#auth-form').onsubmit = async e => {
      e.preventDefault();
      try {
        const { user } = await api('POST', '/api/login', Object.fromEntries(new FormData(e.target)));
        state.user = user; location.hash = '#/'; render();
      } catch (er) { $('#auth-err').textContent = er.message; }
    };
    return;
  }

  // Inscription : via Google (recommandé) ou formulaire classique si autorisé
  const classic = mode === 'first' || setup.localSignup;
  authShell(`
    <h1>${mode === 'first' ? 'Créer le compte modérateur' : 'Créer mon compte'}</h1>
    ${mode === 'first' ? '<p class="pill gold">Premier compte de la plateforme : il deviendra modérateur</p>' : '<p class="muted small" style="margin-top:0">Il te faut le code d’invitation donné par un modérateur.</p>'}
    ${err ? `<div class="error" style="margin-bottom:12px">${esc(err)}</div>` : ''}
    ${setup.google && mode !== 'first' ? `
      <form id="google-form">
        <label for="g-code">Code d'invitation</label>
        <input type="text" id="g-code" name="invite" required autocomplete="off" style="text-transform:uppercase">
        <button class="btn google-btn" style="margin-top:12px">${GOOGLE_ICON}<span>Continuer avec Google</span></button>
        <p class="small muted">Tu choisiras ensuite ta filière et ton propre mot de passe.</p>
      </form>
      ${classic ? '<div class="or"><span>ou sans Google</span></div>' : ''}` : ''}
    ${classic ? `
      <form id="auth-form">
        <label for="f-user">Identifiant</label>
        <input type="text" id="f-user" name="username" autocomplete="username" required>
        <label for="f-name">Nom affiché</label>
        <input type="text" id="f-name" name="display_name" placeholder="Prénom N." maxlength="40">
        <label for="f-pass">Mot de passe (8 caractères min.)</label>
        <input type="password" id="f-pass" name="password" autocomplete="new-password" required minlength="8">
        ${setup.needsCode ? `<label for="f-code">Code d'invitation</label><input type="text" id="f-code" name="invite" required>` : ''}
        ${filiereFields({}, mode !== 'first')}
        <div class="error" id="auth-err"></div>
        <button class="btn primary" style="width:100%;margin-top:8px">S'inscrire</button>
      </form>` : ''}
    ${mode === 'first' && setup.google ? `<div class="or"><span>ou</span></div>${googleBtn('/auth/google', 'Créer avec Google')}` : ''}
    ${mode !== 'first' ? '<p class="small" style="text-align:center;margin-bottom:0">Déjà inscrit ? <a href="#" id="switch">Se connecter</a></p>' : ''}`);
  $('#switch')?.addEventListener('click', e => { e.preventDefault(); location.hash = '#/'; renderAuth('login'); });
  $('#google-form')?.addEventListener('submit', e => {
    e.preventDefault();
    location.href = '/auth/google?invite=' + encodeURIComponent($('#g-code').value.trim().toUpperCase());
  });
  const form = $('#auth-form');
  if (form) {
    bindFiliere(form);
    form.onsubmit = async e => {
      e.preventDefault();
      try {
        const { user } = await api('POST', '/api/register', Object.fromEntries(new FormData(e.target)));
        state.user = user; location.hash = '#/'; render();
      } catch (er) { $('#auth-err').textContent = er.message; }
    };
  }
}

// Après Google : nom, filière, mot de passe
async function renderFinishGoogle(t) {
  let info;
  try { info = await api('GET', `/api/register/google?t=${encodeURIComponent(t)}`); }
  catch (e) {
    authShell(`<h1>Lien expiré</h1><p class="error">${esc(e.message)}</p><a class="btn primary" href="#/inscription">Recommencer</a>`);
    return;
  }
  authShell(`
    <h1>Termine ton inscription</h1>
    <p class="row small" style="margin-top:0">${GOOGLE_ICON}<b>${esc(info.email)}</b></p>
    <form id="finish-form">
      <label>Nom affiché</label>
      <input type="text" name="display_name" maxlength="40" value="${esc(info.name)}" required>
      ${filiereFields({}, !info.first)}
      <label>Crée ton mot de passe (8 caractères min.)</label>
      <input type="password" name="password" autocomplete="new-password" required minlength="8">
      <label>Confirme le mot de passe</label>
      <input type="password" name="password2" autocomplete="new-password" required minlength="8">
      <p class="small muted">Tu pourras te connecter avec Google <b>ou</b> avec ton adresse Gmail et ce mot de passe.</p>
      <div class="error" id="auth-err"></div>
      <button class="btn primary" style="width:100%;margin-top:8px">Créer mon compte</button>
    </form>`);
  const form = $('#finish-form');
  bindFiliere(form);
  form.onsubmit = async e => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(form));
    if (b.password !== b.password2) { $('#auth-err').textContent = 'Les deux mots de passe ne correspondent pas'; return; }
    try {
      const { user } = await api('POST', '/api/register/google', { ...b, t });
      state.user = user; location.hash = '#/'; render();
    } catch (er) { $('#auth-err').textContent = er.message; }
  };
}

// ---------- Écrans obligatoires (mot de passe provisoire, profil incomplet) ----------
function renderGate() {
  const u = state.user;
  const logout = `<p class="small" style="text-align:center;margin-bottom:0"><a href="#" id="gate-logout">Se déconnecter</a></p>`;
  if (u.must_change) {
    authShell(`
      <h1>Nouveau mot de passe</h1>
      <p class="muted small" style="margin-top:0">Un modérateur a réinitialisé ton mot de passe. Choisis-en un nouveau pour continuer.</p>
      <form id="gate-form">
        <label>Nouveau mot de passe (8 caractères min.)</label>
        <input type="password" name="new" autocomplete="new-password" required minlength="8">
        <label>Confirme</label>
        <input type="password" name="new2" autocomplete="new-password" required minlength="8">
        <div class="error" id="auth-err"></div>
        <button class="btn primary" style="width:100%;margin-top:8px">Enregistrer</button>
      </form>${logout}`);
    $('#gate-form').onsubmit = async e => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(e.target));
      if (b.new !== b.new2) { $('#auth-err').textContent = 'Les deux mots de passe ne correspondent pas'; return; }
      try { const d = await api('POST', '/api/me/password', { new: b.new }); state.user = d.user; render(); }
      catch (er) { $('#auth-err').textContent = er.message; }
    };
  } else {
    authShell(`
      <h1>Complète ton profil</h1>
      <p class="muted small" style="margin-top:0">Indique ta filière : ton compte sera supprimé automatiquement après la fin de ta formation.</p>
      <form id="gate-form">${filiereFields(u, true)}
        <div class="error" id="auth-err"></div>
        <button class="btn primary" style="width:100%;margin-top:8px">Continuer</button>
      </form>${logout}`);
    bindFiliere($('#gate-form'), u);
    $('#gate-form').onsubmit = async e => {
      e.preventDefault();
      try { const d = await api('POST', '/api/me/profile', Object.fromEntries(new FormData(e.target))); state.user = d.user; render(); }
      catch (er) { $('#auth-err').textContent = er.message; }
    };
  }
  $('#gate-logout').onclick = async e => { e.preventDefault(); await api('POST', '/api/logout'); state.user = null; render(); };
}

// ---------- Mon compte ----------
async function viewAccount(r) {
  const { user } = await api('GET', '/api/me');
  state.user = user;
  if (r?.q?.ok === 'google') toast('Compte Google lié ✅');
  if (r?.q?.err === 'deja_lie') toast('Ce compte Google est déjà utilisé par un autre compte');
  setTitle('Mon compte');
  const isAdmin = user.role === 'admin';
  setContent(`
    <div class="grid grid-2" style="align-items:start">
      <div class="card">
        <h3>👤 Profil</h3>
        <form id="name-form" class="row" style="flex-wrap:nowrap">
          <input type="text" name="display_name" value="${esc(user.display_name)}" maxlength="40" required>
          <button class="btn">Renommer</button>
        </form>
        <p class="small" style="margin-top:12px">Identifiant : <b>${esc(user.username)}</b>${user.email ? `<br>Email : <b>${esc(user.email)}</b>` : ''}</p>
        ${user.google ? '<p class="row small">' + GOOGLE_ICON + ' Compte Google lié</p>'
          : state.setup?.google ? `<a class="btn google-btn" href="/auth/google?link=1">${GOOGLE_ICON}<span>Lier mon compte Google</span></a>` : ''}
      </div>
      <div class="card">
        <h3>🎓 Formation</h3>
        ${user.filiere ? `<p><b>${esc(user.filiere_nom)}</b>${user.intitule ? ` — ${esc(user.intitule)}` : ''}<br>
          <span class="small muted">Fin de formation : ${fmtDay(user.end_date)}</span></p>` : '<p class="muted">Pas de filière renseignée.</p>'}
        ${isAdmin ? '<p class="small pill accent">Les comptes modérateurs ne sont pas supprimés automatiquement.</p>'
          : user.expires_at ? `<p class="small ${user.expire_bientot ? 'error' : 'muted'}">🗑️ Suppression automatique du compte le <b>${fmtDay(user.expires_at)}</b>.</p>`
          : '<p class="small muted">Compte sans date de suppression (réglé par un modérateur).</p>'}
        <details><summary class="small" style="cursor:pointer">Changer de filière / d'année (passage en Bac pro, redoublement…)</summary>
          <form id="profile-form">${filiereFields(user, !isAdmin)}<button class="btn primary" style="margin-top:8px">Enregistrer</button></form>
        </details>
      </div>
      <div class="card">
        <h3>🔑 Mot de passe</h3>
        <form id="pw-form">
          <label>Mot de passe actuel</label><input type="password" name="old" autocomplete="current-password" required>
          <label>Nouveau mot de passe (8 caractères min.)</label><input type="password" name="new" autocomplete="new-password" required minlength="8">
          <div class="row" style="margin-top:12px"><button class="btn primary">Enregistrer</button></div>
        </form>
      </div>
      <div class="card" style="border-color:#c2413b55">
        <h3>⚠️ Supprimer mon compte</h3>
        <p class="small muted">Ton compte et ta progression sont effacés. Tes messages restent visibles sous le nom « Ancien élève ».</p>
        <form id="del-form" class="row" style="flex-wrap:nowrap">
          <input type="text" name="confirm" placeholder="Écris SUPPRIMER" autocomplete="off">
          <button class="btn danger">Supprimer</button>
        </form>
      </div>
    </div>`);
  const pf = $('#profile-form');
  bindFiliere(pf, user);
  const done = d => { state.user = d.user; renderSidebar(); viewAccount({}); toast('Enregistré'); };
  pf.onsubmit = async e => { e.preventDefault(); try { done(await api('POST', '/api/me/profile', Object.fromEntries(new FormData(pf)))); } catch (er) { toast(er.message); } };
  $('#name-form').onsubmit = async e => { e.preventDefault(); try { done(await api('POST', '/api/me/profile', Object.fromEntries(new FormData(e.target)))); } catch (er) { toast(er.message); } };
  $('#pw-form').onsubmit = async e => {
    e.preventDefault();
    try { await api('POST', '/api/me/password', Object.fromEntries(new FormData(e.target))); toast('Mot de passe modifié'); e.target.reset(); }
    catch (er) { toast(er.message); }
  };
  $('#del-form').onsubmit = async e => {
    e.preventDefault();
    if (!confirm('Supprimer définitivement ton compte ?')) return;
    try { await api('POST', '/api/me/delete', Object.fromEntries(new FormData(e.target))); state.user = null; location.hash = '#/'; render(); }
    catch (er) { toast(er.message); }
  };
}

// ---------- Modération ----------
function showDialog(html) {
  const d = document.createElement('dialog');
  d.className = 'card dialog';
  d.innerHTML = html + '<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" data-close>OK</button></div>';
  document.body.appendChild(d);
  d.querySelector('[data-close]').onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

const visOpts = cur => `<option value="">👥 Tout le CFA</option>${(state.setup?.filieres || []).map(f => `<option value="${f.id}" ${cur === f.id ? 'selected' : ''}>🔒 ${esc(f.nom)} seulement</option>`).join('')}`;

async function viewAdmin(r) {
  if (state.user.role !== 'admin') throw new Error('Réservé aux modérateurs');
  setTitle('Modération', 'Invitations, comptes et salons');
  const [users, invites] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/invites')]);
  const fil = r?.q?.f || '';
  const qtxt = (r?.q?.s || '').toLowerCase();
  const counts = {};
  users.forEach(u => { const k = u.role === 'admin' ? 'MODO' : u.filiere || 'AUCUNE'; counts[k] = (counts[k] || 0) + 1; });
  const shown = users.filter(u => (!fil || (fil === 'MODO' ? u.role === 'admin' : fil === 'AUCUNE' ? !u.filiere && u.role !== 'admin' : u.filiere === fil))
    && (!qtxt || `${u.display_name} ${u.username} ${u.email || ''}`.toLowerCase().includes(qtxt)));
  const chips = [['', 'Tous', users.length], ...state.setup.filieres.map(f => [f.id, f.nom, counts[f.id] || 0]), ['MODO', 'Modérateurs', counts.MODO || 0], ['AUCUNE', 'Sans filière', counts.AUCUNE || 0]];
  setContent(`
    <div class="grid grid-2">
      <div class="card">
        <h3>🎟️ Codes d'invitation</h3>
        <p class="small muted">Donne ce code aux élèves : ils s'inscrivent ${state.setup.google ? 'avec leur compte Google (Gmail), ' : ''}choisissent leur filière et leur mot de passe.</p>
        <form id="inv-form" class="row"><input type="number" name="uses" value="30" min="1" max="100" style="width:110px"><span class="small muted">utilisations</span><button class="btn primary">Générer</button></form>
        <div style="margin-top:12px">${invites.length ? invites.map(i => `
          <div class="row" style="padding:6px 0;border-bottom:1px solid var(--border)">
            <code style="font-size:16px;font-weight:700;letter-spacing:1px">${esc(i.code)}</code>
            <span class="small muted">${i.uses_left} restant(s)</span><span class="spacer"></span>
            <button class="btn sm" data-copy="${esc(i.code)}">Copier</button>
            <button class="btn sm danger" data-del-inv="${esc(i.code)}">✕</button>
          </div>`).join('') : '<p class="muted small">Aucun code actif.</p>'}</div>
      </div>
      <div class="card">
        <h3>#️⃣ Salons et forums</h3>
        <form id="ch-form">
          <div class="row"><input type="text" name="name" placeholder="nom-du-salon" required style="flex:1">
            <select name="kind" style="width:auto"><option value="chat">Salon (chat)</option><option value="forum">Forum</option></select></div>
          <input type="text" name="description" placeholder="Description" style="margin-top:8px">
          <div class="row" style="margin-top:8px">
            <select name="filiere" style="width:auto">${visOpts('')}</select>
            <button class="btn primary">Créer</button></div>
        </form>
        <div style="margin-top:12px">${state.channels.map(c => `
          <div class="row" style="padding:5px 0"><span>${c.kind === 'forum' ? '💬' : '#'} ${esc(c.name)}</span><span class="spacer"></span>
          <select class="sm-select" data-vis="${c.id}" title="Qui peut voir ce salon ?">${visOpts(c.filiere || '')}</select>
          <button class="btn sm danger" data-del-ch="${c.id}">Supprimer</button></div>`).join('')}</div>
        <button class="btn sm" id="reload" style="margin-top:12px">↻ Recharger les contenus de révision</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="row"><h3 style="margin:0">👥 Comptes (${users.length})</h3><span class="spacer"></span>
        <input type="text" id="user-search" placeholder="Rechercher…" value="${esc(r?.q?.s || '')}" style="max-width:220px"></div>
      <div class="row" style="margin:12px 0">${chips.map(([k, l, n]) => `<a class="btn sm ${k === fil ? 'primary' : ''}" href="#/admin?f=${k}">${esc(l)} <span class="muted">${n}</span></a>`).join('')}</div>
      ${shown.map(u => `
        <div class="user-row">
          ${avatar(u.display_name)}
          <div class="user-info">
            <div><b>${esc(u.display_name)}</b> <span class="small muted">${esc(u.email || '@' + u.username)}</span></div>
            <div class="row small" style="gap:6px;margin-top:3px">
              ${u.role === 'admin' ? '<span class="pill accent">modo</span>' : ''}
              ${u.filiere_nom ? `<span class="pill">${esc(u.filiere_nom)}${u.intitule ? ' · ' + esc(u.intitule) : ''}</span>` : ''}
              ${u.google ? '<span class="pill">Google</span>' : ''}
              ${u.banned ? '<span class="pill" style="color:var(--danger)">suspendu</span>' : ''}
              ${u.must_change ? '<span class="pill gold">mdp provisoire</span>' : ''}
              <span class="muted">${u.role === 'admin' ? 'jamais supprimé' : u.expires_at ? `fin ${fmtDay(u.end_date)} · suppression le ${fmtDay(u.expires_at)}` : 'pas de suppression auto'}</span>
            </div>
          </div>
          ${u.id !== state.user.id ? `<div class="row user-actions">
            <button class="btn sm" data-reset="${u.id}" data-name="${esc(u.display_name)}">🔑 Réinitialiser</button>
            <button class="btn sm" data-end="${u.id}" data-cur="${esc(u.end_date || '')}">📅 Fin</button>
            <button class="btn sm" data-role="${u.id}" data-to="${u.role === 'admin' ? 'eleve' : 'admin'}">${u.role === 'admin' ? 'Retirer modo' : 'Nommer modo'}</button>
            <button class="btn sm" data-ban="${u.id}" data-to="${u.banned ? 0 : 1}">${u.banned ? 'Réactiver' : 'Suspendre'}</button>
            <button class="btn sm danger" data-del-user="${u.id}" data-name="${esc(u.display_name)}">Supprimer</button>
          </div>` : '<span class="small muted">c’est toi</span>'}
        </div>`).join('') || '<p class="muted">Aucun compte.</p>'}
    </div>`);
  const reload = () => viewAdmin(parseRoute());
  $$('[data-vis]').forEach(sel => sel.onchange = async () => {
    try {
      await api('PATCH', `/api/channels/${sel.dataset.vis}`, { filiere: sel.value || null });
      state.channels = await api('GET', '/api/channels'); renderSidebar(); toast('Visibilité mise à jour');
    } catch (err) { toast(err.message); }
  });
  let tmo;
  $('#user-search').oninput = e => { clearTimeout(tmo); tmo = setTimeout(() => { location.hash = `#/admin?f=${fil}&s=${encodeURIComponent(e.target.value)}`; }, 400); };
  $('#inv-form').onsubmit = async e => { e.preventDefault(); const { code } = await api('POST', '/api/admin/invites', { uses: +e.target.uses.value }); toast(`Code ${code} créé`); reload(); };
  $('#ch-form').onsubmit = async e => {
    e.preventDefault();
    try { await api('POST', '/api/channels', Object.fromEntries(new FormData(e.target))); state.channels = await api('GET', '/api/channels'); renderSidebar(); reload(); }
    catch (err) { toast(err.message); }
  };
  $('#reload').onclick = async () => { const x = await api('POST', '/api/admin/reload-content'); toast(`${x.matieres} matières rechargées`); };
  $$('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Copié'); });
  $$('[data-del-inv]').forEach(b => b.onclick = async () => { await api('DELETE', `/api/admin/invites/${b.dataset.delInv}`); reload(); });
  $$('[data-del-ch]').forEach(b => b.onclick = async () => {
    if (!confirm('Supprimer ce salon et tous ses messages ?')) return;
    await api('DELETE', `/api/channels/${b.dataset.delCh}`); state.channels = await api('GET', '/api/channels'); renderSidebar(); reload();
  });
  const act = (sel, fn) => $$(sel).forEach(b => b.onclick = async () => { try { await fn(b); } catch (err) { toast(err.message); } });
  act('[data-role]', async b => { await api('POST', `/api/admin/users/${b.dataset.role}`, { role: b.dataset.to }); reload(); });
  act('[data-ban]', async b => { await api('POST', `/api/admin/users/${b.dataset.ban}`, { banned: b.dataset.to === '1' }); reload(); });
  act('[data-reset]', async b => {
    if (!confirm(`Réinitialiser le mot de passe de ${b.dataset.name} ?`)) return;
    const { temp, login } = await api('POST', `/api/admin/users/${b.dataset.reset}/reset-password`);
    const d = showDialog(`<h3>🔑 Mot de passe provisoire</h3>
      <p>Donne ces infos à <b>${esc(b.dataset.name)}</b> (en main propre de préférence) :</p>
      <p>Connexion : <b>${esc(login)}</b><br>Mot de passe : <code style="font-size:18px;font-weight:700">${esc(temp)}</code>
      <button class="btn sm" id="copy-temp">Copier</button></p>
      <p class="small muted">Il devra choisir un nouveau mot de passe à sa prochaine connexion. Ce code ne sera plus affiché.</p>`);
    d.querySelector('#copy-temp').onclick = () => { navigator.clipboard?.writeText(temp); toast('Copié'); };
    d.addEventListener('close', reload);
  });
  act('[data-end]', async b => {
    const v = prompt('Nouvelle date de fin de formation (AAAA-MM-JJ).\nLaisse vide pour que ce compte ne soit jamais supprimé automatiquement.', b.dataset.cur);
    if (v === null) return;
    await api('POST', `/api/admin/users/${b.dataset.end}`, { end_date: v.trim() || null }); toast('Date mise à jour'); reload();
  });
  act('[data-del-user]', async b => {
    if (!confirm(`Supprimer le compte de ${b.dataset.name} maintenant ? (irréversible)`)) return;
    await api('POST', `/api/admin/users/${b.dataset.delUser}/delete`); toast('Compte supprimé'); reload();
  });
}
