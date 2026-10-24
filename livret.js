// Livret d'apprentissage (comme le portail entreprise d'Ypareo) : l'apprenti décrit ses périodes en entreprise,
// le tuteur / maître d'apprentissage les commente et les signe depuis un lien personnel (sans compte),
// le formateur ajoute ses remarques et note les visites en entreprise.
// Le tuteur ne voit QUE le livret de son apprenti (+ absences et notes si l'apprenti l'a autorisé) :
// jamais les salons, le forum ni les autres élèves.
const crypto = require('crypto');

const CRITERES = {
  ponctualite: 'Ponctualité, assiduité',
  attitude: 'Attitude, savoir-être',
  consignes: 'Respect des consignes et de la sécurité',
  autonomie: 'Autonomie, prise d’initiative',
  qualite: 'Qualité du travail',
  communication: 'Communication (clients, équipe)',
};
const NIVEAUX = { A: 'Acquis', EC: 'En cours', NA: 'Non acquis' };
const VISITES = { visite: 'Visite en entreprise', telephone: 'Point téléphonique', visio: 'Point en visio', cfa: 'Rencontre au CFA' };
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');

module.exports = function setupLivret(app, { db, auth, bad, now, text, notifier, cible, viescolaire, notes, formations, accounts }) {
  db.exec(`CREATE TABLE IF NOT EXISTS livret_periodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, titre TEXT NOT NULL, debut TEXT, fin TEXT,
    activites TEXT NOT NULL DEFAULT '', appris TEXT NOT NULL DEFAULT '', difficultes TEXT NOT NULL DEFAULT '',
    tuteur_appreciation TEXT NOT NULL DEFAULT '', tuteur_evals TEXT, tuteur_nom TEXT, tuteur_signe_at INTEGER,
    formateur_remarque TEXT NOT NULL DEFAULT '', formateur_id INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS livret_visites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL, compte_rendu TEXT NOT NULL DEFAULT '',
    author_id INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS livret_tuteurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, nom TEXT NOT NULL, entreprise TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE, voir_absences INTEGER NOT NULL DEFAULT 1, voir_notes INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0, last_seen INTEGER, created_at INTEGER NOT NULL
  );`);

  const getP = id => db.prepare('SELECT * FROM livret_periodes WHERE id = ?').get(+id);
  const parseEvals = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
  const outP = p => ({ ...p, tuteur_evals: parseEvals(p.tuteur_evals), signee: !!p.tuteur_signe_at, formateur: p.formateur_id ? cible.nameOf(p.formateur_id) : null });
  const staffOrSelf = (req, uid) => cible.isStaff(req.user) || req.user.id === uid;
  const targetUid = req => (cible.isStaff(req.user) && (req.query.user_id || req.body.user_id) ? +(req.query.user_id || req.body.user_id) : req.user.id);
  const fr = d => (d ? d.split('-').reverse().join('/') : '');

  function livretDe(uid, { tuteur = null } = {}) {
    const u = cible.userById(uid);
    if (!u) return null;
    const periodes = db.prepare('SELECT * FROM livret_periodes WHERE user_id = ? ORDER BY COALESCE(debut, created_at) DESC, id DESC').all(uid).map(outP);
    const visites = db.prepare('SELECT * FROM livret_visites WHERE user_id = ? ORDER BY date DESC').all(uid)
      .map(v => ({ ...v, type_nom: VISITES[v.type], auteur: cible.nameOf(v.author_id) }));
    return {
      apprenti: { id: u.id, display_name: u.display_name, filiere: accounts.filiereNom(u.filiere), formation: formations.nom(u.formation), fin: u.end_date },
      periodes, visites, criteres: CRITERES, niveaux: NIVEAUX, types_visite: VISITES,
      absences: !tuteur || tuteur.voir_absences ? viescolaire.resume(uid) : null,
      absences_detail: tuteur?.voir_absences ? viescolaire.evenementsDe(uid).slice(0, 30) : undefined,
      releve: tuteur?.voir_notes ? notes.releve(uid) : undefined,
    };
  }

  // ---------- Apprenti & formateurs (connectés) ----------
  app.get('/api/livret', auth, (req, res) => {
    const uid = targetUid(req);
    if (!staffOrSelf(req, uid)) return bad(res, 'Interdit', 403);
    const l = livretDe(uid);
    if (!l) return bad(res, 'Élève introuvable', 404);
    const tuteurs = db.prepare('SELECT id, nom, entreprise, email, voir_absences, voir_notes, revoked, last_seen, created_at FROM livret_tuteurs WHERE user_id = ? AND revoked = 0 ORDER BY id DESC').all(uid);
    res.json({ ...l, tuteurs, staff: cible.isStaff(req.user), moi: req.user.id === uid });
  });

  // L'apprenti crée / modifie une période tant que le tuteur ne l'a pas signée
  app.post('/api/livret/periodes', auth, (req, res) => {
    if (req.user.role !== 'eleve') return bad(res, 'C’est l’apprenti qui remplit ses périodes', 403);
    const titre = text(req.body.titre, 120);
    if (!titre) return bad(res, 'Donne un titre à la période (ex. « Semaines du 3 au 21 novembre »)');
    for (const k of ['debut', 'fin']) if (req.body[k] && !cible.isDate(req.body[k])) return bad(res, 'Date invalide');
    const id = db.prepare(`INSERT INTO livret_periodes (user_id, titre, debut, fin, activites, appris, difficultes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, titre, req.body.debut || null, req.body.fin || null,
      text(req.body.activites, 8000), text(req.body.appris, 4000), text(req.body.difficultes, 4000), now(), now()).lastInsertRowid;
    res.json({ id });
  });
  app.patch('/api/livret/periodes/:id', auth, (req, res) => {
    const p = getP(req.params.id);
    if (!p || !staffOrSelf(req, p.user_id)) return bad(res, 'Période introuvable', 404);
    if (req.user.id === p.user_id) {
      if (p.tuteur_signe_at) return bad(res, 'Période déjà signée par ton tuteur : elle ne peut plus être modifiée');
      for (const k of ['debut', 'fin']) if (req.body[k] && !cible.isDate(req.body[k])) return bad(res, 'Date invalide');
      const v = {
        titre: 'titre' in req.body ? text(req.body.titre, 120) || p.titre : p.titre,
        debut: 'debut' in req.body ? req.body.debut || null : p.debut, fin: 'fin' in req.body ? req.body.fin || null : p.fin,
        activites: 'activites' in req.body ? text(req.body.activites, 8000) : p.activites,
        appris: 'appris' in req.body ? text(req.body.appris, 4000) : p.appris,
        difficultes: 'difficultes' in req.body ? text(req.body.difficultes, 4000) : p.difficultes,
      };
      db.prepare('UPDATE livret_periodes SET titre = ?, debut = ?, fin = ?, activites = ?, appris = ?, difficultes = ?, updated_at = ? WHERE id = ?')
        .run(v.titre, v.debut, v.fin, v.activites, v.appris, v.difficultes, now(), p.id);
    } else {
      // Formateur : remarque du CFA
      db.prepare('UPDATE livret_periodes SET formateur_remarque = ?, formateur_id = ?, updated_at = ? WHERE id = ?').run(text(req.body.formateur_remarque, 4000), req.user.id, now(), p.id);
      notifier.notify(p.user_id, { type: 'scolarite', link: '#/livret', title: '📘 Remarque du CFA sur ton livret', body: p.titre });
    }
    res.json({ ok: true });
  });
  app.delete('/api/livret/periodes/:id', auth, (req, res) => {
    const p = getP(req.params.id);
    if (!p || (p.user_id !== req.user.id && req.user.role !== 'admin')) return bad(res, 'Période introuvable', 404);
    if (p.tuteur_signe_at && req.user.role !== 'admin') return bad(res, 'Période signée : seul un modérateur peut la supprimer');
    db.prepare('DELETE FROM livret_periodes WHERE id = ?').run(p.id);
    res.json({ ok: true });
  });

  // Visites / points de suivi : notés par les formateurs
  app.post('/api/livret/visites', auth, (req, res) => {
    if (!cible.isStaff(req.user)) return bad(res, 'Réservé aux formateurs', 403);
    const uid = +req.body.user_id;
    const u = cible.userById(uid);
    if (!u || u.role !== 'eleve') return bad(res, 'Apprenti introuvable');
    const date = String(req.body.date || cible.today());
    if (!cible.isDate(date)) return bad(res, 'Date invalide');
    const type = VISITES[req.body.type] ? req.body.type : 'visite';
    const id = db.prepare('INSERT INTO livret_visites (user_id, date, type, compte_rendu, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid, date, type, text(req.body.compte_rendu, 6000), req.user.id, now()).lastInsertRowid;
    notifier.notify(uid, { type: 'scolarite', link: '#/livret', title: `📘 ${VISITES[type]} ajouté(e) à ton livret`, body: `Le ${fr(date)} par ${req.user.display_name}` });
    res.json({ id });
  });
  app.delete('/api/livret/visites/:id', auth, (req, res) => {
    const v = db.prepare('SELECT * FROM livret_visites WHERE id = ?').get(+req.params.id);
    if (!v || !(req.user.role === 'admin' || v.author_id === req.user.id)) return bad(res, 'Introuvable', 404);
    db.prepare('DELETE FROM livret_visites WHERE id = ?').run(v.id);
    res.json({ ok: true });
  });

  // Lien du tuteur : créé par l'apprenti (ou un formateur). Le jeton n'est montré qu'une fois et seul son empreinte est stockée.
  app.post('/api/livret/tuteurs', auth, (req, res) => {
    const uid = targetUid(req);
    if (!staffOrSelf(req, uid)) return bad(res, 'Interdit', 403);
    const u = cible.userById(uid);
    if (!u || u.role !== 'eleve') return bad(res, 'Le livret est celui d’un apprenti');
    const nom = text(req.body.nom, 80);
    if (!nom) return bad(res, 'Nom du tuteur obligatoire');
    if (db.prepare('SELECT COUNT(*) AS n FROM livret_tuteurs WHERE user_id = ? AND revoked = 0').get(uid).n >= 3) return bad(res, '3 liens tuteur maximum : supprime un ancien lien');
    const token = crypto.randomBytes(24).toString('base64url');
    db.prepare(`INSERT INTO livret_tuteurs (user_id, nom, entreprise, email, token_hash, voir_absences, voir_notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uid, nom, text(req.body.entreprise, 120), text(req.body.email, 120), hash(token), req.body.voir_absences === false ? 0 : 1, req.body.voir_notes ? 1 : 0, now());
    res.json({ token, lien: `#/tuteur/${token}` });
  });
  app.delete('/api/livret/tuteurs/:id', auth, (req, res) => {
    const t = db.prepare('SELECT * FROM livret_tuteurs WHERE id = ?').get(+req.params.id);
    if (!t || !staffOrSelf(req, t.user_id)) return bad(res, 'Introuvable', 404);
    db.prepare('UPDATE livret_tuteurs SET revoked = 1 WHERE id = ?').run(t.id);
    res.json({ ok: true });
  });

  // ---------- Espace tuteur (sans compte, jeton dans le corps de la requête) ----------
  // Anti-essais : seuls les jetons invalides comptent (20 par 15 min et par adresse IP)
  const fails = new Map();
  function tuteurFrom(req, res) {
    const f = fails.get(req.ip);
    if (f && now() - f.t < 15 * 60e3 && f.n >= 20) { bad(res, 'Trop de tentatives, réessaie plus tard', 429); return null; }
    const tk = String(req.body.token || '');
    const t = tk.length >= 20 && db.prepare('SELECT * FROM livret_tuteurs WHERE token_hash = ? AND revoked = 0').get(hash(tk));
    const u = t && cible.userById(t.user_id);
    if (!t || !u || u.banned) {
      const cur = f && now() - f.t < 15 * 60e3 ? f : { n: 0, t: now() };
      cur.n++; fails.set(req.ip, cur);
      bad(res, 'Lien invalide ou désactivé. Demande un nouveau lien à ton apprenti.', 404); return null;
    }
    db.prepare('UPDATE livret_tuteurs SET last_seen = ? WHERE id = ?').run(now(), t.id);
    return t;
  }
  app.post('/api/tuteur/livret', (req, res) => {
    const t = tuteurFrom(req, res);
    if (!t) return;
    res.json({ ...livretDe(t.user_id, { tuteur: t }), tuteur: { nom: t.nom, entreprise: t.entreprise } });
  });
  app.post('/api/tuteur/periodes/:id', (req, res) => {
    const t = tuteurFrom(req, res);
    if (!t) return;
    const p = getP(req.params.id);
    if (!p || p.user_id !== t.user_id) return bad(res, 'Période introuvable', 404);
    if (p.tuteur_signe_at) return bad(res, 'Période déjà signée');
    const evals = {};
    for (const k of Object.keys(CRITERES)) if (NIVEAUX[req.body.evals?.[k]]) evals[k] = req.body.evals[k];
    const appreciation = text(req.body.appreciation, 4000);
    if (!appreciation) return bad(res, 'Écris une appréciation');
    const signe = !!req.body.signer;
    db.prepare('UPDATE livret_periodes SET tuteur_appreciation = ?, tuteur_evals = ?, tuteur_nom = ?, tuteur_signe_at = ?, updated_at = ? WHERE id = ?')
      .run(appreciation, JSON.stringify(evals), `${t.nom}${t.entreprise ? ` (${t.entreprise})` : ''}`, signe ? now() : null, now(), p.id);
    notifier.notify(t.user_id, { type: 'scolarite', link: '#/livret', title: signe ? `✍️ ${t.nom} a signé ton livret` : `📘 ${t.nom} a commenté ton livret`, body: p.titre });
    res.json({ ok: true, signee: signe });
  });

  function forgetUser(uid) {
    for (const tbl of ['livret_periodes', 'livret_visites', 'livret_tuteurs']) db.prepare(`DELETE FROM ${tbl} WHERE user_id = ?`).run(uid);
  }
  return { forgetUser };
};
