// Vie scolaire (comme Pronote / Ypareo) : feuille d'appel du formateur (présent / absent / retard),
// absences et retards visibles par l'élève, justificatifs envoyés en ligne et validés par l'équipe.
const STATUTS = { present: 'Présent', absent: 'Absent', retard: 'En retard' };
const CRENEAUX = { matin: 'Matin', aprem: 'Après-midi', journee: 'Journée' };
const MOTIFS = { sante: 'Raison de santé', transport: 'Problème de transport', famille: 'Raison familiale', entreprise: "Demande de l'entreprise", administratif: 'Démarche administrative', autre: 'Autre' };
const JSTATUTS = { attente: 'En attente', acceptee: 'Acceptée', refusee: 'Refusée' };

module.exports = function setupVieScolaire(app, { db, auth, bad, now, text, uploads, notifier, cible }) {
  db.exec(`CREATE TABLE IF NOT EXISTS appels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, creneau TEXT NOT NULL, matiere TEXT NOT NULL DEFAULT '',
    filiere TEXT, formation TEXT, author_id INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS appel_lignes (
    appel_id INTEGER NOT NULL REFERENCES appels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL, statut TEXT NOT NULL, minutes INTEGER, justif_id INTEGER,
    PRIMARY KEY (appel_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS justifs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, motif TEXT NOT NULL, commentaire TEXT NOT NULL DEFAULT '',
    statut TEXT NOT NULL DEFAULT 'attente', reponse TEXT NOT NULL DEFAULT '', traite_par INTEGER, traite_at INTEGER,
    created_at INTEGER NOT NULL
  );`);

  const staffOnly = (req, res, next) => cible.isStaff(req.user) ? next() : bad(res, 'Réservé aux formateurs', 403);
  const getAppel = id => db.prepare('SELECT * FROM appels WHERE id = ?').get(+id);
  const getJustif = id => db.prepare('SELECT * FROM justifs WHERE id = ?').get(+id);
  const fr = d => d.split('-').reverse().join('/');

  // Absences et retards d'un élève (le plus récent d'abord), avec l'état du justificatif
  function evenementsDe(uid) {
    return db.prepare(`SELECT l.*, a.date, a.creneau, a.matiere, a.author_id, j.statut AS justif_statut, j.motif AS justif_motif
      FROM appel_lignes l JOIN appels a ON a.id = l.appel_id LEFT JOIN justifs j ON j.id = l.justif_id
      WHERE l.user_id = ? AND l.statut != 'present' ORDER BY a.date DESC, a.id DESC`).all(uid)
      .map(r => ({
        appel_id: r.appel_id, date: r.date, creneau: r.creneau, creneau_nom: CRENEAUX[r.creneau], matiere: r.matiere, statut: r.statut, minutes: r.minutes,
        formateur: cible.nameOf(r.author_id), justif_id: r.justif_id, justif_statut: r.justif_statut || null,
        justifiee: r.justif_statut === 'acceptee',
      }));
  }
  function resume(uid) {
    const ev = evenementsDe(uid);
    const abs = ev.filter(e => e.statut === 'absent'), ret = ev.filter(e => e.statut === 'retard');
    return {
      absences: abs.length, absences_non_justifiees: abs.filter(e => !e.justifiee).length,
      retards: ret.length, retards_non_justifies: ret.filter(e => !e.justifiee).length,
      a_justifier: ev.filter(e => !e.justif_id || e.justif_statut === 'refusee').length,
    };
  }

  // ---------- Élève ----------
  app.get('/api/viescolaire', auth, (req, res) => {
    const staff = cible.isStaff(req.user);
    const uid = staff && req.query.user_id ? +req.query.user_id : req.user.id;
    if (!staff && uid !== req.user.id) return bad(res, 'Interdit', 403);
    const justifs = db.prepare('SELECT * FROM justifs WHERE user_id = ? ORDER BY id DESC').all(uid);
    const files = uploads.forTargets('justif', justifs.map(j => j.id));
    res.json({
      staff, statuts: STATUTS, creneaux: CRENEAUX, motifs: MOTIFS, jstatuts: JSTATUTS,
      eleve: { id: uid, display_name: cible.nameOf(uid) },
      evenements: evenementsDe(uid), resume: resume(uid),
      justifs: justifs.map(j => ({ ...j, motif_nom: MOTIFS[j.motif], statut_nom: JSTATUTS[j.statut], attachments: files[j.id] || [], traite_par_nom: j.traite_par ? cible.nameOf(j.traite_par) : null })),
    });
  });

  // L'élève justifie une ou plusieurs absences / retards (avec un justificatif en pièce jointe si besoin)
  app.post('/api/justifs', auth, (req, res) => {
    if (req.user.role !== 'eleve') return bad(res, 'Seuls les élèves envoient des justificatifs', 403);
    const motif = MOTIFS[req.body.motif] ? req.body.motif : null;
    if (!motif) return bad(res, 'Choisis un motif');
    const appels = [...new Set((Array.isArray(req.body.appels) ? req.body.appels : []).map(Number))].slice(0, 50);
    if (!appels.length) return bad(res, 'Choisis au moins une absence ou un retard');
    const lignes = appels.map(a => db.prepare(`SELECT l.*, j.statut AS js FROM appel_lignes l LEFT JOIN justifs j ON j.id = l.justif_id
      WHERE l.appel_id = ? AND l.user_id = ? AND l.statut != 'present'`).get(a, req.user.id));
    if (lignes.some(l => !l)) return bad(res, 'Absence introuvable');
    if (lignes.some(l => l.justif_id && l.js !== 'refusee')) return bad(res, 'Une de ces absences a déjà un justificatif');
    try { uploads.check(req.user, req.body.attachments); } catch (e) { return bad(res, e.message); }
    const id = db.prepare('INSERT INTO justifs (user_id, motif, commentaire, created_at) VALUES (?, ?, ?, ?)')
      .run(req.user.id, motif, text(req.body.commentaire, 1000), now()).lastInsertRowid;
    uploads.link(req.user, req.body.attachments, 'justif', id, null);
    for (const a of appels) db.prepare('UPDATE appel_lignes SET justif_id = ? WHERE appel_id = ? AND user_id = ?').run(id, a, req.user.id);
    // Prévient les formateurs qui ont fait ces appels
    const auteurs = new Set(appels.map(a => getAppel(a).author_id));
    for (const aid of auteurs) notifier.notify(aid, { type: 'scolarite', link: '#/viescolaire', title: `🗂️ Justificatif reçu : ${req.user.display_name}`, body: MOTIFS[motif] });
    res.json({ id });
  });

  // ---------- Formateurs : feuille d'appel ----------
  app.get('/api/appels', auth, staffOnly, (req, res) => {
    const rows = db.prepare('SELECT * FROM appels ORDER BY date DESC, id DESC LIMIT 200').all();
    const aTraiter = db.prepare("SELECT * FROM justifs WHERE statut = 'attente' ORDER BY id").all();
    const files = uploads.forTargets('justif', aTraiter.map(j => j.id));
    res.json({
      statuts: STATUTS, creneaux: CRENEAUX, motifs: MOTIFS,
      appels: rows.map(a => {
        const c = db.prepare("SELECT SUM(statut = 'absent') AS abs, SUM(statut = 'retard') AS ret, COUNT(*) AS n FROM appel_lignes WHERE appel_id = ?").get(a.id);
        return { ...a, cible: cible.label(a), author: cible.nameOf(a.author_id), absents: c.abs || 0, retards: c.ret || 0, n: c.n };
      }),
      justifs: aTraiter.map(j => ({
        ...j, eleve: cible.nameOf(j.user_id), motif_nom: MOTIFS[j.motif], attachments: files[j.id] || [],
        lignes: db.prepare('SELECT a.date, a.creneau, a.matiere, l.statut, l.minutes FROM appel_lignes l JOIN appels a ON a.id = l.appel_id WHERE l.justif_id = ?').all(j.id)
          .map(l => ({ ...l, creneau_nom: CRENEAUX[l.creneau] })),
      })),
    });
  });

  // Prépare ou rouvre une feuille d'appel : liste des élèves de la classe avec leur statut
  app.get('/api/appels/:id', auth, staffOnly, (req, res) => {
    const a = getAppel(req.params.id);
    if (!a) return bad(res, 'Appel introuvable', 404);
    const lignes = Object.fromEntries(db.prepare('SELECT * FROM appel_lignes WHERE appel_id = ?').all(a.id).map(l => [l.user_id, l]));
    res.json({ appel: { ...a, cible: cible.label(a) }, statuts: STATUTS, creneaux: CRENEAUX,
      eleves: cible.students(a).map(s => ({ id: s.id, display_name: s.display_name, statut: lignes[s.id]?.statut || 'present', minutes: lignes[s.id]?.minutes ?? null })) });
  });

  app.post('/api/appels', auth, staffOnly, (req, res) => {
    let t;
    try { t = cible.parse(req.body); } catch (e) { return bad(res, e.message); }
    const date = String(req.body.date || cible.today());
    if (!cible.isDate(date)) return bad(res, 'Date invalide');
    const creneau = CRENEAUX[req.body.creneau] ? req.body.creneau : 'matin';
    if (!cible.students(t).length) return bad(res, 'Aucun élève dans cette classe');
    const dup = db.prepare("SELECT id FROM appels WHERE date = ? AND creneau = ? AND COALESCE(filiere, '') = ? AND COALESCE(formation, '') = ?")
      .get(date, creneau, t.filiere || '', t.formation || '');
    if (dup) return res.json({ id: dup.id, existant: true });
    const id = db.prepare('INSERT INTO appels (date, creneau, matiere, filiere, formation, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(date, creneau, text(req.body.matiere, 60), t.filiere, t.formation, req.user.id, now(), now()).lastInsertRowid;
    res.json({ id });
  });

  // Enregistre l'appel : seuls les absents / retards sont stockés ; l'élève est prévenu pour justifier
  app.put('/api/appels/:id', auth, staffOnly, (req, res) => {
    const a = getAppel(req.params.id);
    if (!a) return bad(res, 'Appel introuvable', 404);
    if (req.user.role !== 'admin' && a.author_id !== req.user.id) return bad(res, 'Seul le formateur qui a fait l’appel peut le modifier', 403);
    const allowed = new Set(cible.students(a).map(s => s.id));
    const list = Array.isArray(req.body.eleves) ? req.body.eleves.slice(0, 500) : [];
    const avant = Object.fromEntries(db.prepare('SELECT user_id, statut FROM appel_lignes WHERE appel_id = ?').all(a.id).map(l => [l.user_id, l.statut]));
    const nouveaux = [];
    db.exec('BEGIN');
    try {
      for (const e of list) {
        const uid = +e.id;
        if (!allowed.has(uid)) continue;
        const statut = STATUTS[e.statut] ? e.statut : 'present';
        if (statut === 'present') { db.prepare('DELETE FROM appel_lignes WHERE appel_id = ? AND user_id = ?').run(a.id, uid); continue; }
        const minutes = statut === 'retard' ? Math.min(Math.max(+e.minutes | 0, 0), 600) || null : null;
        db.prepare(`INSERT INTO appel_lignes (appel_id, user_id, statut, minutes) VALUES (?, ?, ?, ?)
          ON CONFLICT(appel_id, user_id) DO UPDATE SET statut = excluded.statut, minutes = excluded.minutes`).run(a.id, uid, statut, minutes);
        if (avant[uid] !== statut) nouveaux.push({ uid, statut });
      }
      if ('matiere' in req.body) db.prepare('UPDATE appels SET matiere = ? WHERE id = ?').run(text(req.body.matiere, 60), a.id);
      db.prepare('UPDATE appels SET updated_at = ? WHERE id = ?').run(now(), a.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    for (const n of nouveaux) {
      notifier.notify(n.uid, { type: 'scolarite', link: '#/viescolaire',
        title: n.statut === 'absent' ? `🚩 Absence relevée le ${fr(a.date)}` : `⏰ Retard relevé le ${fr(a.date)}`,
        body: `${CRENEAUX[a.creneau]}${a.matiere ? ` · ${a.matiere}` : ''} — pense à envoyer un justificatif si besoin.` });
    }
    res.json({ ok: true });
  });

  app.delete('/api/appels/:id', auth, staffOnly, (req, res) => {
    const a = getAppel(req.params.id);
    if (!a) return bad(res, 'Appel introuvable', 404);
    if (req.user.role !== 'admin' && a.author_id !== req.user.id) return bad(res, 'Interdit', 403);
    db.prepare('DELETE FROM appels WHERE id = ?').run(a.id);
    res.json({ ok: true });
  });

  // Traitement d'un justificatif
  app.post('/api/justifs/:id', auth, staffOnly, (req, res) => {
    const j = getJustif(req.params.id);
    if (!j) return bad(res, 'Justificatif introuvable', 404);
    const statut = ['acceptee', 'refusee'].includes(req.body.statut) ? req.body.statut : null;
    if (!statut) return bad(res, 'Accepte ou refuse le justificatif');
    db.prepare('UPDATE justifs SET statut = ?, reponse = ?, traite_par = ?, traite_at = ? WHERE id = ?').run(statut, text(req.body.reponse, 1000), req.user.id, now(), j.id);
    notifier.notify(j.user_id, { type: 'scolarite', link: '#/viescolaire',
      title: statut === 'acceptee' ? '✅ Justificatif accepté' : '❌ Justificatif refusé', body: text(req.body.reponse, 140) || MOTIFS[j.motif] });
    res.json({ ok: true });
  });

  // Synthèse par élève pour les formateurs (qui a le plus d'absences non justifiées)
  app.get('/api/viescolaire/synthese', auth, staffOnly, (req, res) => {
    let t;
    try { t = cible.parse(req.query); } catch (e) { return bad(res, e.message); }
    res.json(cible.students(t).map(s => ({ id: s.id, display_name: s.display_name, ...resume(s.id) }))
      .sort((a, b) => b.absences_non_justifiees - a.absences_non_justifiees || b.retards - a.retards));
  });

  function canAccessAttachment(u, a) {
    if (a.target !== 'justif') return false;
    const j = getJustif(a.target_id);
    return !!j && (j.user_id === u.id || cible.isStaff(u));
  }
  function forgetUser(uid) {
    const ids = db.prepare('SELECT id FROM justifs WHERE user_id = ?').all(uid).map(j => j.id);
    uploads.removeFor('justif', ids);
    db.prepare('DELETE FROM justifs WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM appel_lignes WHERE user_id = ?').run(uid);
  }
  return { evenementsDe, resume, canAccessAttachment, forgetUser, CRENEAUX };
};
