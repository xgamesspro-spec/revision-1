// Révisions « fun » : XP, niveaux, séries de jours, badges, classement, défi du jour et duels.
// Le défi du jour et les duels sont corrigés côté serveur (impossible de tricher en modifiant la page).
const crypto = require('crypto');

const TZ = process.env.APP_TZ || 'America/Cayenne';
const DAY = 864e5;
const dayKey = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

// Points gagnés et plafond par jour (pour que ça reste équitable)
const RULES = {
  carte_ok: { xp: 2, cap: 100, kind: 'cartes' }, carte_ko: { xp: 1, cap: 100, kind: 'cartes' },
  quiz: { cap: 150, kind: 'quiz' }, defi: { cap: 100, kind: 'defi' }, duel: { cap: 150, kind: 'duel' },
  reponse: { xp: 5, cap: 30, kind: 'forum' }, sujet: { xp: 3, cap: 15, kind: 'forum' },
  fiche: { xp: 15, cap: 30, kind: 'fiche' }, exercice: { xp: 20, cap: 60, kind: 'exercice' },
};
const TITLES = ['Débutant', 'Apprenti', 'Curieux', 'Motivé', 'Régulier', 'Confirmé', 'Expert', 'Maître', 'Légende du CFA'];
const xpForLevel = n => 25 * n * (n - 1); // niveau 2 = 50 XP, 3 = 150, 4 = 300, 5 = 500…
function levelOf(xp) {
  let n = 1;
  while (xpForLevel(n + 1) <= xp) n++;
  return { level: n, title: TITLES[Math.min(n - 1, TITLES.length - 1)], from: xpForLevel(n), to: xpForLevel(n + 1) };
}
const BADGES = [
  { id: 'premiers_pas', ico: '👣', nom: 'Premiers pas', desc: 'Gagner tes premiers points' },
  { id: 'quiz_parfait', ico: '💯', nom: 'Sans faute', desc: 'Réussir un quiz à 100 %' },
  { id: 'serie_3', ico: '🔥', nom: 'Ça chauffe', desc: 'Réviser 3 jours de suite' },
  { id: 'serie_7', ico: '🚀', nom: 'Semaine parfaite', desc: 'Réviser 7 jours de suite' },
  { id: 'serie_30', ico: '🏔️', nom: 'Inarrêtable', desc: 'Réviser 30 jours de suite' },
  { id: 'cartes_50', ico: '🃏', nom: 'Mémoire vive', desc: 'Revoir 50 cartes' },
  { id: 'cartes_500', ico: '🧠', nom: 'Disque dur', desc: 'Revoir 500 cartes' },
  { id: 'defi_1', ico: '🎯', nom: 'Défi relevé', desc: 'Faire ton premier défi du jour' },
  { id: 'defi_parfait', ico: '🏹', nom: 'En plein dans le mille', desc: 'Faire 5/5 au défi du jour' },
  { id: 'defi_10', ico: '📆', nom: 'Fidèle au poste', desc: 'Faire 10 défis du jour' },
  { id: 'duelliste', ico: '⚔️', nom: 'Duelliste', desc: 'Terminer ton premier duel' },
  { id: 'champion', ico: '🏆', nom: 'Champion', desc: 'Gagner 5 duels' },
  { id: 'entraide', ico: '🤝', nom: 'Entraide', desc: 'Répondre 10 fois sur le forum' },
  { id: 'assidu', ico: '📝', nom: 'Assidu', desc: 'Rendre 10 exercices' },
  { id: 'niveau_5', ico: '⭐', nom: 'Niveau 5', desc: 'Atteindre le niveau 5' },
];

// Tirage reproductible (même défi pour tout le monde le même jour)
function seeded(seed) {
  let h = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  return () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}
function pick(arr, n, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

module.exports = function setupGame(app, { db, auth, bad, now, conns, getSubjects, notifier, accounts }) {
  db.exec(`CREATE TABLE IF NOT EXISTS xp_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL,
    reason TEXT NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_xp_user ON xp_log(user_id, day);
  CREATE TABLE IF NOT EXISTS badges (user_id INTEGER NOT NULL, badge TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, badge));
  CREATE TABLE IF NOT EXISTS daily_runs (
    user_id INTEGER NOT NULL, day TEXT NOT NULL, started_at INTEGER NOT NULL,
    score INTEGER, total INTEGER, ms INTEGER, answers TEXT, PRIMARY KEY (user_id, day)
  );
  CREATE TABLE IF NOT EXISTS duels (
    id INTEGER PRIMARY KEY AUTOINCREMENT, challenger_id INTEGER NOT NULL, opponent_id INTEGER NOT NULL,
    subject TEXT, qkeys TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    c_start INTEGER, c_score INTEGER, c_ms INTEGER, o_start INTEGER, o_score INTEGER, o_ms INTEGER,
    winner_id INTEGER, created_at INTEGER NOT NULL
  );`);
  if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'hide_rank')) db.exec('ALTER TABLE users ADD COLUMN hide_rank INTEGER NOT NULL DEFAULT 0');

  const plays = u => u && u.role !== 'prof';
  const totalXp = uid => db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM xp_log WHERE user_id = ?').get(uid).n;
  const count = (uid, reasons) => db.prepare(`SELECT COUNT(*) AS n FROM xp_log WHERE user_id = ? AND reason IN (${reasons.map(() => '?').join(',')})`).get(uid, ...reasons).n;
  const hasBadge = (uid, b) => !!db.prepare('SELECT 1 FROM badges WHERE user_id = ? AND badge = ?').get(uid, b);

  function streakOf(uid) {
    const days = new Set(db.prepare('SELECT DISTINCT day FROM xp_log WHERE user_id = ?').all(uid).map(r => r.day));
    let t = Date.now();
    if (!days.has(dayKey(t))) t -= DAY; // la série tient tant qu'on a révisé hier
    let n = 0;
    while (days.has(dayKey(t)) && n < 1000) { n++; t -= DAY; }
    return { current: n, today: days.has(dayKey()), at_risk: n > 0 && !days.has(dayKey()) };
  }

  function push(uid, event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of conns.values()) if (c.user.id === uid) c.res.write(payload);
  }

  function checkBadges(uid, ctx = {}) {
    const got = [];
    const give = id => {
      if (hasBadge(uid, id)) return;
      db.prepare('INSERT INTO badges (user_id, badge, created_at) VALUES (?, ?, ?)').run(uid, id, now());
      got.push(BADGES.find(b => b.id === id));
    };
    give('premiers_pas');
    if (ctx.perfectQuiz) give('quiz_parfait');
    const s = streakOf(uid).current;
    if (s >= 3) give('serie_3');
    if (s >= 7) give('serie_7');
    if (s >= 30) give('serie_30');
    const cards = count(uid, ['carte_ok', 'carte_ko']);
    if (cards >= 50) give('cartes_50');
    if (cards >= 500) give('cartes_500');
    const defis = db.prepare('SELECT COUNT(*) AS n FROM daily_runs WHERE user_id = ? AND score IS NOT NULL').get(uid).n;
    if (defis >= 1) give('defi_1');
    if (defis >= 10) give('defi_10');
    if (ctx.perfectDaily) give('defi_parfait');
    const duels = db.prepare("SELECT COUNT(*) AS n FROM duels WHERE status = 'done' AND (challenger_id = ? OR opponent_id = ?)").get(uid, uid).n;
    if (duels >= 1) give('duelliste');
    if (db.prepare("SELECT COUNT(*) AS n FROM duels WHERE status = 'done' AND winner_id = ?").get(uid).n >= 5) give('champion');
    if (count(uid, ['reponse']) >= 10) give('entraide');
    if (count(uid, ['exercice']) >= 10) give('assidu');
    if (levelOf(totalXp(uid)).level >= 5) give('niveau_5');
    return got;
  }

  // Ajoute des points (en respectant le plafond du jour) et prévient l'élève en direct
  function award(uid, reason, amount, ctx = {}) {
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(uid);
    if (!plays(u)) return 0;
    const rule = RULES[reason] || { cap: 50, kind: reason };
    const xp = amount ?? rule.xp ?? 0;
    const used = db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM xp_log WHERE user_id = ? AND day = ? AND kind = ?').get(uid, dayKey(), rule.kind).n;
    const gained = Math.max(0, Math.min(xp, rule.cap - used));
    const before = levelOf(totalXp(uid)).level;
    // On enregistre même 0 XP : l'activité compte pour la série de jours
    db.prepare('INSERT INTO xp_log (user_id, amount, reason, kind, day, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid, gained, reason, rule.kind, dayKey(), now());
    const total = totalXp(uid);
    const lv = levelOf(total);
    const newBadges = checkBadges(uid, ctx);
    if (gained || newBadges.length) {
      push(uid, 'xp', { gained, reason, xp: total, ...lv, level_up: lv.level > before, badges: newBadges, streak: streakOf(uid).current });
    }
    return gained;
  }

  // ---------- Banque de questions ----------
  function allQuestions() {
    const out = [];
    for (const s of getSubjects()) s.quiz.forEach((q, i) => out.push({ key: `${s.id}:${i}`, subject: s.id, subjectNom: s.nom, ...q }));
    return out;
  }
  const byKey = k => allQuestions().find(q => q.key === k);
  // Version envoyée au navigateur : sans la bonne réponse, choix mélangés
  const forClient = (q, rnd = Math.random) => ({
    key: q.key, q: q.q, subject: q.subjectNom,
    choix: pick(q.choix.map((c, i) => ({ i, c })), q.choix.length, rnd),
  });
  function grade(keys, answers) {
    let score = 0;
    const details = keys.map((k, idx) => {
      const q = byKey(k);
      const chosen = Array.isArray(answers) ? +answers[idx] : -1;
      const ok = !!q && chosen === q.reponse;
      if (ok) score++;
      return q ? { key: k, q: q.q, ok, chosen, reponse: q.reponse, bonne: q.choix[q.reponse], explication: q.explication || '' } : { key: k, ok: false };
    });
    return { score, total: keys.length, details };
  }

  // ---------- Défi du jour ----------
  const dailyKeys = (day = dayKey()) => pick(allQuestions().map(q => q.key), 5, seeded('defi-' + day));
  function dailyBoard(u, day = dayKey()) {
    const rows = db.prepare(`SELECT d.user_id, d.score, d.total, d.ms, u.display_name, u.hide_rank, u.filiere FROM daily_runs d JOIN users u ON u.id = d.user_id
      WHERE d.day = ? AND d.score IS NOT NULL AND u.deleted = 0 ORDER BY d.score DESC, d.ms ASC`).all(day);
    return rows.filter(r => (u.role === 'admin' || r.filiere === u.filiere) && (!r.hide_rank || r.user_id === u.id))
      .slice(0, 20).map((r, i) => ({ rank: i + 1, name: r.display_name, score: r.score, total: r.total, ms: r.ms, me: r.user_id === u.id }));
  }
  app.get('/api/daily', auth, (req, res) => {
    if (!plays(req.user)) return bad(res, 'Le défi du jour est réservé aux élèves', 403);
    const day = dayKey();
    const keys = dailyKeys(day);
    let run = db.prepare('SELECT * FROM daily_runs WHERE user_id = ? AND day = ?').get(req.user.id, day);
    if (run?.score != null) {
      return res.json({ day, done: true, score: run.score, total: run.total, ms: run.ms, details: grade(keys, JSON.parse(run.answers || '[]')).details, board: dailyBoard(req.user, day) });
    }
    if (req.query.start === '1' && !run) {
      db.prepare('INSERT INTO daily_runs (user_id, day, started_at) VALUES (?, ?, ?)').run(req.user.id, day, now());
      run = { started_at: now() };
    }
    const rnd = seeded('ordre-' + day + '-' + req.user.id);
    res.json({ day, done: false, started: !!run, questions: run ? keys.map(k => forClient(byKey(k), rnd)) : null, count: keys.length, board: dailyBoard(req.user, day) });
  });
  app.post('/api/daily', auth, (req, res) => {
    if (!plays(req.user)) return bad(res, 'Réservé aux élèves', 403);
    const day = dayKey();
    const run = db.prepare('SELECT * FROM daily_runs WHERE user_id = ? AND day = ?').get(req.user.id, day);
    if (!run) return bad(res, 'Commence le défi d’abord');
    if (run.score != null) return bad(res, 'Tu as déjà fait le défi aujourd’hui, reviens demain !');
    const keys = dailyKeys(day);
    const g = grade(keys, req.body.answers);
    const ms = Math.min(now() - run.started_at, 3600e3);
    db.prepare('UPDATE daily_runs SET score = ?, total = ?, ms = ?, answers = ? WHERE user_id = ? AND day = ?')
      .run(g.score, g.total, ms, JSON.stringify((req.body.answers || []).slice(0, keys.length).map(Number)), req.user.id, day);
    const xp = award(req.user.id, 'defi', g.score * 10 + (g.score === g.total ? 20 : 0), { perfectDaily: g.score === g.total });
    res.json({ ...g, ms, xp, board: dailyBoard(req.user, day) });
  });

  // ---------- Duels (chacun joue quand il veut, mêmes 5 questions) ----------
  const nameOf = id => db.prepare('SELECT display_name FROM users WHERE id = ?').get(id)?.display_name || 'Ancien élève';
  function duelOut(d, uid) {
    const mine = d.challenger_id === uid ? 'c' : 'o';
    const other = mine === 'c' ? 'o' : 'c';
    const done = d.status === 'done';
    return {
      id: d.id, status: d.status, subject: d.subject, created_at: d.created_at,
      sujet_nom: d.subject ? getSubjects().find(s => s.id === d.subject)?.nom : 'Toutes matières',
      opponent: nameOf(mine === 'c' ? d.opponent_id : d.challenger_id), i_challenged: mine === 'c',
      my_score: d[`${mine}_score`], my_ms: d[`${mine}_ms`], played: d[`${mine}_score`] != null,
      their_score: done ? d[`${other}_score`] : null, their_ms: done ? d[`${other}_ms`] : null, they_played: d[`${other}_score`] != null,
      won: done ? (d.winner_id === uid ? true : d.winner_id ? false : null) : null,
    };
  }
  const expireDuels = () => db.prepare("UPDATE duels SET status = 'expired' WHERE status = 'pending' AND created_at < ?").run(now() - 3 * DAY);

  app.get('/api/duels', auth, (req, res) => {
    expireDuels();
    const rows = db.prepare('SELECT * FROM duels WHERE challenger_id = ? OR opponent_id = ? ORDER BY id DESC LIMIT 30').all(req.user.id, req.user.id);
    res.json(rows.map(d => duelOut(d, req.user.id)));
  });
  app.post('/api/duels', auth, (req, res) => {
    if (!plays(req.user)) return bad(res, 'Réservé aux élèves', 403);
    const opp = db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0 AND banned = 0').get(+req.body.opponent_id);
    if (!opp || opp.id === req.user.id || !plays(opp)) return bad(res, 'Choisis un autre élève');
    const pendingN = db.prepare("SELECT COUNT(*) AS n FROM duels WHERE challenger_id = ? AND status = 'pending'").get(req.user.id).n;
    if (pendingN >= 5) return bad(res, 'Tu as déjà 5 duels en attente');
    const subj = getSubjects().find(s => s.id === req.body.subject && s.quiz.length >= 5);
    const pool = allQuestions().filter(q => !subj || q.subject === subj.id).map(q => q.key);
    const keys = pick(pool, 5, Math.random);
    const r = db.prepare('INSERT INTO duels (challenger_id, opponent_id, subject, qkeys, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, opp.id, subj?.id || null, JSON.stringify(keys), now());
    notifier.notify(opp.id, {
      type: 'duel', link: '#/progression',
      title: `⚔️ ${req.user.display_name} te défie en duel !`,
      body: `${subj ? subj.nom : 'Toutes matières'} — 5 questions, tu as 3 jours pour répondre.`,
    });
    res.json({ id: r.lastInsertRowid });
  });
  function duelFor(uid, id) {
    const d = db.prepare('SELECT * FROM duels WHERE id = ?').get(+id);
    if (!d || (d.challenger_id !== uid && d.opponent_id !== uid)) return null;
    return d;
  }
  app.get('/api/duels/:id/play', auth, (req, res) => {
    expireDuels();
    const d = duelFor(req.user.id, req.params.id);
    if (!d) return bad(res, 'Duel introuvable', 404);
    if (d.status !== 'pending') return bad(res, 'Ce duel est terminé');
    const p = d.challenger_id === req.user.id ? 'c' : 'o';
    if (d[`${p}_score`] != null) return bad(res, 'Tu as déjà joué ce duel');
    if (!d[`${p}_start`]) db.prepare(`UPDATE duels SET ${p}_start = ? WHERE id = ?`).run(now(), d.id);
    const rnd = seeded(`duel-${d.id}-${req.user.id}`);
    res.json({ id: d.id, questions: JSON.parse(d.qkeys).map(k => byKey(k)).filter(Boolean).map(q => forClient(q, rnd)), opponent: nameOf(p === 'c' ? d.opponent_id : d.challenger_id) });
  });
  app.post('/api/duels/:id/answers', auth, (req, res) => {
    const d = duelFor(req.user.id, req.params.id);
    if (!d) return bad(res, 'Duel introuvable', 404);
    if (d.status !== 'pending') return bad(res, 'Ce duel est terminé');
    const p = d.challenger_id === req.user.id ? 'c' : 'o';
    if (d[`${p}_score`] != null) return bad(res, 'Tu as déjà joué ce duel');
    if (!d[`${p}_start`]) return bad(res, 'Commence le duel d’abord');
    const g = grade(JSON.parse(d.qkeys), req.body.answers);
    const ms = Math.min(now() - d[`${p}_start`], 3600e3);
    db.prepare(`UPDATE duels SET ${p}_score = ?, ${p}_ms = ? WHERE id = ?`).run(g.score, ms, d.id);
    let xp = award(req.user.id, 'duel', 10 + g.score * 3);
    const cur = db.prepare('SELECT * FROM duels WHERE id = ?').get(d.id);
    if (cur.c_score != null && cur.o_score != null) {
      const winner = cur.c_score !== cur.o_score ? (cur.c_score > cur.o_score ? cur.challenger_id : cur.opponent_id)
        : cur.c_ms !== cur.o_ms ? (cur.c_ms < cur.o_ms ? cur.challenger_id : cur.opponent_id) : null;
      db.prepare("UPDATE duels SET status = 'done', winner_id = ? WHERE id = ?").run(winner, d.id);
      if (winner) { const bonus = award(winner, 'duel', 25); if (winner === req.user.id) xp += bonus; }
      for (const uid of [cur.challenger_id, cur.opponent_id]) {
        checkBadges(uid);
        const res2 = winner == null ? 'Égalité parfaite !' : winner === uid ? 'Tu as gagné 🏆' : 'Tu as perdu, revanche ?';
        notifier.notify(uid, { type: 'duel', link: '#/progression', title: `⚔️ Duel terminé : ${cur.c_score} – ${cur.o_score}`, body: res2 });
      }
    }
    res.json({ ...g, ms, xp, duel: duelOut(db.prepare('SELECT * FROM duels WHERE id = ?').get(d.id), req.user.id) });
  });
  app.post('/api/duels/:id/decline', auth, (req, res) => {
    const d = duelFor(req.user.id, req.params.id);
    if (!d || d.opponent_id !== req.user.id || d.status !== 'pending') return bad(res, 'Duel introuvable', 404);
    db.prepare("UPDATE duels SET status = 'declined' WHERE id = ?").run(d.id);
    res.json({ ok: true });
  });

  // ---------- Progression & classement ----------
  app.get('/api/progress', auth, (req, res) => {
    const uid = req.user.id;
    const xp = totalXp(uid);
    const mine = new Map(db.prepare('SELECT badge, created_at FROM badges WHERE user_id = ?').all(uid).map(b => [b.badge, b.created_at]));
    const today = db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM xp_log WHERE user_id = ? AND day = ?').get(uid, dayKey()).n;
    const week = db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM xp_log WHERE user_id = ? AND created_at > ?').get(uid, now() - 7 * DAY).n;
    const daily = db.prepare('SELECT score, total FROM daily_runs WHERE user_id = ? AND day = ?').get(uid, dayKey());
    expireDuels();
    const duelsTodo = db.prepare("SELECT * FROM duels WHERE status = 'pending' AND (challenger_id = ? OR opponent_id = ?)").all(uid, uid)
      .filter(d => d[(d.challenger_id === uid ? 'c' : 'o') + '_score'] == null).length;
    res.json({
      plays: plays(req.user), xp, today, week, ...levelOf(xp), streak: streakOf(uid),
      badges: BADGES.map(b => ({ ...b, got: mine.has(b.id), at: mine.get(b.id) || null })),
      daily_done: daily?.score != null, daily_score: daily?.score ?? null, duels_todo: duelsTodo, hide_rank: !!req.user.hide_rank,
    });
  });
  app.get('/api/leaderboard', auth, (req, res) => {
    const staff = ['admin', 'prof'].includes(req.user.role);
    const filiere = staff && accounts.FILIERES.some(f => f.id === req.query.filiere) ? req.query.filiere : req.user.filiere;
    const since = req.query.period === 'all' ? 0 : now() - 7 * DAY;
    const rows = db.prepare(`SELECT u.id, u.display_name, u.hide_rank, COALESCE(SUM(x.amount), 0) AS xp FROM users u
      LEFT JOIN xp_log x ON x.user_id = u.id AND x.created_at > ?
      WHERE u.deleted = 0 AND u.banned = 0 AND u.role != 'prof' AND ${filiere ? 'u.filiere = ?' : 'u.filiere IS NULL'}
      GROUP BY u.id ORDER BY xp DESC, u.display_name`).all(since, ...(filiere ? [filiere] : []));
    const list = rows.filter(r => !r.hide_rank || r.id === req.user.id).map((r, i) => ({
      rank: i + 1, name: r.display_name, xp: r.xp, me: r.id === req.user.id,
      level: levelOf(totalXp(r.id)).level, streak: streakOf(r.id).current,
    }));
    res.json({ filiere, filiere_nom: accounts.filiereNom(filiere), period: since ? 'week' : 'all', list: list.slice(0, 50) });
  });
  app.post('/api/progress/prefs', auth, (req, res) => {
    db.prepare('UPDATE users SET hide_rank = ? WHERE id = ?').run(req.body.hide_rank ? 1 : 0, req.user.id);
    res.json({ ok: true });
  });

  function forgetUser(uid) {
    for (const t of ['xp_log', 'badges', 'daily_runs']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(uid);
    db.prepare('DELETE FROM duels WHERE challenger_id = ? OR opponent_id = ?').run(uid, uid);
  }
  return { award, checkBadges, streakOf, levelOf, forgetUser, dayKey, BADGES };
};
