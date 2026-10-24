// Comptes : inscription / connexion (Google ou identifiant + mot de passe), filières,
// réinitialisation par un modérateur, suppression automatique en fin de formation.
const crypto = require('crypto');

const FILIERES = [
  { id: 'CAP', nom: 'CAP', duree: 2 },
  { id: 'BACPRO', nom: 'Bac pro', duree: 3 },
  { id: 'BTS', nom: 'BTS', duree: 2 },
  { id: 'TP', nom: 'Titre professionnel', duree: null }, // durée variable : on demande le mois de fin
];
const GRACE_DAYS = +(process.env.ACCOUNT_GRACE_DAYS ?? 60);
const WARN_DAYS = 30;

const GOOGLE = {
  id: process.env.GOOGLE_CLIENT_ID || '',
  secret: process.env.GOOGLE_CLIENT_SECRET || '',
  authUrl: process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
};
const googleEnabled = () => !!(GOOGLE.id && GOOGLE.secret);
// Avec Google activé, les élèves s'inscrivent obligatoirement via Google (adresse Gmail vérifiée)
const localSignupAllowed = () => !googleEnabled() || process.env.ALLOW_LOCAL_SIGNUP === '1';

function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  const add = (name, def) => { if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${def}`); };
  add('email', 'TEXT');
  add('google_sub', 'TEXT');
  add('filiere', 'TEXT');
  add('intitule', 'TEXT');
  add('end_date', 'TEXT');
  add('expires_at', 'INTEGER');
  add('must_change', 'INTEGER NOT NULL DEFAULT 0');
  add('deleted', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
           CREATE UNIQUE INDEX IF NOT EXISTS idx_users_gsub ON users(google_sub) WHERE google_sub IS NOT NULL;`);
}

// Date de fin de formation à partir de la filière et de l'année (ou du mois) de fin
function computeEnd(filiereId, fin) {
  const f = FILIERES.find(x => x.id === filiereId);
  if (!f) throw new Error('Choisis ta filière');
  let end;
  if (f.duree) {
    if (!/^\d{4}$/.test(String(fin))) throw new Error("Choisis l'année de ton examen");
    end = `${fin}-07-31`; // fin de l'année scolaire
  } else {
    const m = String(fin).match(/^(\d{4})-(\d{2})$/);
    if (!m || +m[2] < 1 || +m[2] > 12) throw new Error('Indique le mois de fin de ta formation');
    const last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
    end = `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`;
  }
  const t = Date.parse(end + 'T23:59:59Z');
  const today = Date.now();
  if (t < today - 864e5) throw new Error('Cette date de fin est déjà passée');
  if (t > today + 4 * 365 * 864e5) throw new Error('Date de fin trop lointaine (4 ans maximum)');
  return end;
}
const expiryFrom = end => (end ? Date.parse(end + 'T23:59:59Z') + GRACE_DAYS * 864e5 : null);

function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.randomBytes(10)].map(b => chars[b % chars.length]).join('');
}

module.exports = function setupAccounts(app, h) {
  const { db, auth, admin, text, bad, tooMany, hashPassword, checkPassword, setSession, clearSession, now, CLASS_CODE } = h;
  migrate(db);

  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users WHERE deleted = 0').get().n;
  const filiereNom = id => FILIERES.find(f => f.id === id)?.nom || null;

  function me(u) {
    if (!u) return null;
    const needsProfile = u.role !== 'admin' && !u.filiere;
    return {
      id: u.id, username: u.username, display_name: u.display_name, role: u.role,
      email: u.email, google: !!u.google_sub,
      filiere: u.filiere, filiere_nom: filiereNom(u.filiere), intitule: u.intitule,
      end_date: u.end_date, expires_at: u.role === 'admin' ? null : u.expires_at,
      expire_bientot: u.role !== 'admin' && u.expires_at && u.expires_at - now() < WARN_DAYS * 864e5,
      must_change: !!u.must_change, needs_profile: needsProfile,
    };
  }

  // Écran obligatoire avant d'accéder au reste (mot de passe provisoire, profil incomplet)
  const GATE_FREE = new Set(['/me', '/me/password', '/me/profile', '/me/delete', '/logout', '/setup', '/login']);
  function gate(req, res, next) {
    const u = req.user;
    if (!u || GATE_FREE.has(req.path)) return next();
    if (u.must_change) return res.status(403).json({ error: 'Change ton mot de passe provisoire', gate: 'must_change' });
    if (u.role !== 'admin' && !u.filiere) return res.status(403).json({ error: 'Complète ton profil', gate: 'needs_profile' });
    next();
  }

  function checkInvite(code) {
    if (userCount() === 0 && !CLASS_CODE) return { ok: true, first: true };
    if (CLASS_CODE && code === CLASS_CODE) return { ok: true };
    const inv = code && db.prepare('SELECT * FROM invites WHERE code = ? AND uses_left > 0').get(code);
    return inv ? { ok: true, invite: inv.code } : { ok: false };
  }
  const useInvite = code => { if (code) db.prepare('UPDATE invites SET uses_left = uses_left - 1 WHERE code = ?').run(code); };

  function profileFields(body, required) {
    const filiere = text(body.filiere, 10);
    if (!filiere && !required) return {};
    const end_date = computeEnd(filiere, text(body.fin, 7));
    return { filiere, end_date, intitule: text(body.intitule, 60) || null, expires_at: expiryFrom(end_date) };
  }
  const checkNewPassword = pw => {
    if (String(pw || '').length < 8) throw new Error('Mot de passe : 8 caractères minimum');
  };

  function anonymize(id) {
    const tag = `supprime-${id}-${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`UPDATE users SET username = ?, display_name = 'Ancien élève', email = NULL, google_sub = NULL, pass_hash = '!',
      banned = 1, deleted = 1, filiere = NULL, intitule = NULL, end_date = NULL, expires_at = NULL, must_change = 0 WHERE id = ?`).run(tag, id);
    for (const t of ['sessions', 'card_progress', 'quiz_results']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
  }

  // ---------- Infos publiques ----------
  app.get('/api/setup', (req, res) => {
    const first = userCount() === 0;
    res.json({
      firstUser: first, needsCode: !first || !!CLASS_CODE,
      google: googleEnabled(), localSignup: localSignupAllowed() || first,
      filieres: FILIERES, grace_days: GRACE_DAYS,
    });
  });

  // ---------- Inscription classique (si autorisée) ----------
  app.post('/api/register', (req, res) => {
    if (tooMany(req.ip)) return bad(res, 'Trop de tentatives, réessaie plus tard', 429);
    const first = userCount() === 0;
    if (!first && !localSignupAllowed()) return bad(res, "L'inscription se fait avec ton compte Google", 403);
    const username = text(req.body.username, 24);
    const display = text(req.body.display_name, 40) || username;
    const password = String(req.body.password || '');
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) return bad(res, 'Identifiant : 3 à 24 caractères (lettres, chiffres, . _ -)');
    let profile;
    try { checkNewPassword(password); profile = profileFields(req.body, !first); } catch (e) { return bad(res, e.message); }
    const inv = checkInvite(text(req.body.invite, 64));
    if (!inv.ok) return bad(res, "Code d'invitation invalide. Demande-le à un modérateur de la classe.", 403);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return bad(res, 'Cet identifiant est déjà pris');
    const r = db.prepare(`INSERT INTO users (username, display_name, pass_hash, role, created_at, filiere, intitule, end_date, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(username, display, hashPassword(password), inv.first ? 'admin' : 'eleve', now(),
      profile.filiere || null, profile.intitule || null, profile.end_date || null, profile.expires_at || null);
    useInvite(inv.invite);
    setSession(res, r.lastInsertRowid);
    res.json({ user: me(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) });
  });

  // ---------- Connexion identifiant/email + mot de passe ----------
  app.post('/api/login', (req, res) => {
    if (tooMany(req.ip)) return bad(res, 'Trop de tentatives, réessaie dans 15 minutes', 429);
    const id = text(req.body.username, 120);
    const u = db.prepare('SELECT * FROM users WHERE deleted = 0 AND (username = ? OR email = ?)').get(id, id.toLowerCase());
    if (!u || !checkPassword(String(req.body.password || ''), u.pass_hash)) return bad(res, 'Identifiant ou mot de passe incorrect', 401);
    if (u.banned) return bad(res, 'Compte suspendu', 403);
    setSession(res, u.id);
    res.json({ user: me(u) });
  });

  app.post('/api/logout', (req, res) => {
    clearSession(req, res);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => res.json({ user: me(req.user) }));

  app.post('/api/me/password', auth, (req, res) => {
    // Avec un mot de passe provisoire, pas besoin de redonner l'ancien
    if (!req.user.must_change && !checkPassword(String(req.body.old || ''), req.user.pass_hash)) return bad(res, 'Ancien mot de passe incorrect');
    try { checkNewPassword(req.body.new); } catch (e) { return bad(res, e.message); }
    db.prepare('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?').run(hashPassword(String(req.body.new)), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.sid);
    res.json({ user: me(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  // Filière / fin de formation (à l'inscription, après un changement de filière, ou pour un ancien compte)
  app.post('/api/me/profile', auth, (req, res) => {
    let p = {};
    const display = text(req.body.display_name, 40);
    const wantsProfile = 'filiere' in req.body || (req.user.role !== 'admin' && !req.user.filiere);
    if (wantsProfile) {
      try { p = profileFields(req.body, req.user.role !== 'admin'); } catch (e) { return bad(res, e.message); }
    }
    if (p.filiere) {
      db.prepare('UPDATE users SET filiere = ?, intitule = ?, end_date = ?, expires_at = ? WHERE id = ?')
        .run(p.filiere, p.intitule, p.end_date, p.expires_at, req.user.id);
    }
    if (display) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display, req.user.id);
    res.json({ user: me(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  app.post('/api/me/delete', auth, (req, res) => {
    if (text(req.body.confirm, 20) !== 'SUPPRIMER') return bad(res, 'Écris SUPPRIMER pour confirmer');
    if (req.user.role === 'admin' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND deleted = 0").get().n <= 1) {
      return bad(res, 'Tu es le seul modérateur : nomme quelqu’un d’autre avant de supprimer ton compte');
    }
    anonymize(req.user.id);
    clearSession(req, res);
    res.json({ ok: true });
  });

  // ---------- Google (OpenID Connect) ----------
  const oauthStates = new Map(); // state -> { invite, linkUserId, exp }
  const pending = new Map();     // jeton -> infos Google en attente de fin d'inscription
  const sweep = m => { for (const [k, v] of m) if (v.exp < now()) m.delete(k); };
  const baseUrl = req => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const back = (res, hash) => res.redirect(`/#/${hash}`);

  app.get('/auth/google', (req, res) => {
    if (!googleEnabled()) return back(res, 'connexion?err=google_off');
    sweep(oauthStates);
    const invite = text(req.query.invite, 64);
    if (invite && !checkInvite(invite).ok) return back(res, 'connexion?err=invite');
    // Liaison d'un compte existant (depuis « Mon compte ») : la session est lue ici, avant le départ vers Google
    let linkUserId = null;
    if (req.query.link === '1') {
      const sid = h.parseCookies(req).sid;
      const row = sid && db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires > ?').get(sid, now());
      if (!row) return back(res, 'connexion');
      linkUserId = row.user_id;
    }
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, { invite, linkUserId, exp: now() + 10 * 60e3 });
    res.setHeader('Set-Cookie', `gstate=${state}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600${h.COOKIE_SECURE ? '; Secure' : ''}`);
    const params = new URLSearchParams({
      client_id: GOOGLE.id, redirect_uri: `${baseUrl(req)}/auth/google/callback`, response_type: 'code',
      scope: 'openid email profile', state, prompt: 'select_account',
    });
    res.redirect(`${GOOGLE.authUrl}?${params}`);
  });

  app.get('/auth/google/callback', async (req, res) => {
    const state = String(req.query.state || '');
    const saved = oauthStates.get(state);
    oauthStates.delete(state);
    res.setHeader('Set-Cookie', 'gstate=; Path=/auth; Max-Age=0');
    if (!saved || saved.exp < now() || h.parseCookies(req).gstate !== state) return back(res, 'connexion?err=state');
    if (req.query.error || !req.query.code) return back(res, 'connexion?err=annule');
    let claims;
    try {
      const r = await fetch(GOOGLE.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(req.query.code), client_id: GOOGLE.id, client_secret: GOOGLE.secret,
          redirect_uri: `${baseUrl(req)}/auth/google/callback`, grant_type: 'authorization_code',
        }),
      });
      const tok = await r.json();
      if (!r.ok || !tok.id_token) throw new Error('token');
      // Jeton reçu directement de Google en HTTPS : on lit son contenu et on vérifie les champs
      claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString());
      const issOk = ['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss);
      if (!issOk || claims.aud !== GOOGLE.id || claims.exp * 1000 < now() || !claims.sub || !claims.email || !claims.email_verified) throw new Error('claims');
    } catch {
      return back(res, 'connexion?err=google');
    }
    const email = String(claims.email).toLowerCase();

    // 1) Compte déjà lié à ce Google
    const known = db.prepare('SELECT * FROM users WHERE google_sub = ? AND deleted = 0').get(claims.sub);
    if (saved.linkUserId) {
      if (known && known.id !== saved.linkUserId) return back(res, 'compte?err=deja_lie');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ? AND deleted = 0').get(email, saved.linkUserId)) return back(res, 'compte?err=deja_lie');
      db.prepare('UPDATE users SET google_sub = ?, email = ? WHERE id = ?').run(claims.sub, email, saved.linkUserId);
      return back(res, 'compte?ok=google');
    }
    if (known) {
      if (known.banned) return back(res, 'connexion?err=suspendu');
      setSession(res, known.id);
      return back(res, '');
    }
    // 2) Nouveau : code d'invitation obligatoire, puis on termine l'inscription (nom, filière, mot de passe)
    const inv = checkInvite(saved.invite);
    if (!inv.ok) return back(res, 'connexion?err=pas_de_compte');
    if (db.prepare('SELECT 1 FROM users WHERE email = ? AND deleted = 0').get(email)) return back(res, 'connexion?err=email_pris');
    sweep(pending);
    const t = crypto.randomBytes(18).toString('hex');
    pending.set(t, { sub: claims.sub, email, name: text(claims.name, 40), invite: saved.invite, exp: now() + 30 * 60e3 });
    back(res, `finaliser?t=${t}`);
  });

  app.get('/api/register/google', (req, res) => {
    const p = pending.get(String(req.query.t || ''));
    if (!p || p.exp < now()) return bad(res, 'Lien expiré, recommence la connexion avec Google', 404);
    res.json({ email: p.email, name: p.name, first: userCount() === 0 });
  });

  app.post('/api/register/google', (req, res) => {
    const t = String(req.body.t || '');
    const p = pending.get(t);
    if (!p || p.exp < now()) return bad(res, 'Lien expiré, recommence la connexion avec Google', 404);
    const inv = checkInvite(p.invite);
    if (!inv.ok) return bad(res, "Le code d'invitation n'est plus valide", 403);
    const display = text(req.body.display_name, 40) || p.name || p.email.split('@')[0];
    let profile;
    try { checkNewPassword(req.body.password); profile = profileFields(req.body, !inv.first); } catch (e) { return bad(res, e.message); }
    if (db.prepare('SELECT 1 FROM users WHERE (email = ? OR google_sub = ?) AND deleted = 0').get(p.email, p.sub)) return bad(res, 'Ce compte Google est déjà inscrit');
    // Identifiant automatique tiré de l'adresse (l'élève se connecte avec son email ou Google)
    let base = p.email.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 20) || 'eleve';
    if (base.length < 3) base = base.padEnd(3, '0');
    let username = base, i = 1;
    while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) username = `${base}${++i}`;
    const r = db.prepare(`INSERT INTO users (username, display_name, pass_hash, role, created_at, email, google_sub, filiere, intitule, end_date, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(username, display, hashPassword(String(req.body.password)), inv.first ? 'admin' : 'eleve', now(),
      p.email, p.sub, profile.filiere || null, profile.intitule || null, profile.end_date || null, profile.expires_at || null);
    useInvite(inv.invite);
    pending.delete(t);
    setSession(res, r.lastInsertRowid);
    res.json({ user: me(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) });
  });

  // ---------- Modération des comptes ----------
  app.get('/api/admin/users', auth, admin, (req, res) => {
    res.json(db.prepare(`SELECT id, username, display_name, role, banned, created_at, email, google_sub IS NOT NULL AS google,
      filiere, intitule, end_date, expires_at, must_change FROM users WHERE deleted = 0 ORDER BY filiere, display_name`).all()
      .map(u => ({ ...u, filiere_nom: filiereNom(u.filiere) })));
  });

  app.post('/api/admin/users/:id', auth, admin, (req, res) => {
    const id = +req.params.id;
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(id);
    if (!u) return bad(res, 'Compte introuvable', 404);
    if (id === req.user.id) return bad(res, 'Tu ne peux pas te modifier toi-même ici (va dans Mon compte)');
    if ('banned' in req.body) {
      db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(req.body.banned ? 1 : 0, id);
      if (req.body.banned) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (req.body.role === 'admin' || req.body.role === 'eleve') db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, id);
    if ('end_date' in req.body) {
      // null = jamais supprimé automatiquement ; sinon nouvelle date de fin (prolongation, redoublement…)
      const d = req.body.end_date;
      if (d === null || d === '') db.prepare('UPDATE users SET end_date = NULL, expires_at = NULL WHERE id = ?').run(id);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d))) db.prepare('UPDATE users SET end_date = ?, expires_at = ? WHERE id = ?').run(d, expiryFrom(d), id);
      else return bad(res, 'Date invalide');
    }
    if (req.body.filiere && FILIERES.some(f => f.id === req.body.filiere)) db.prepare('UPDATE users SET filiere = ? WHERE id = ?').run(req.body.filiere, id);
    res.json({ ok: true });
  });

  app.post('/api/admin/users/:id/reset-password', auth, admin, (req, res) => {
    const id = +req.params.id;
    if (id === req.user.id) return bad(res, 'Change ton propre mot de passe dans Mon compte');
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(id);
    if (!u) return bad(res, 'Compte introuvable', 404);
    const temp = tempPassword();
    db.prepare('UPDATE users SET pass_hash = ?, must_change = 1 WHERE id = ?').run(hashPassword(temp), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json({ temp, login: u.email || u.username });
  });

  app.post('/api/admin/users/:id/delete', auth, admin, (req, res) => {
    const id = +req.params.id;
    if (id === req.user.id) return bad(res, 'Supprime ton propre compte depuis Mon compte');
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND deleted = 0').get(id)) return bad(res, 'Compte introuvable', 404);
    anonymize(id);
    res.json({ ok: true });
  });

  // ---------- Suppression automatique en fin de formation ----------
  function purgeExpired() {
    const rows = db.prepare(`SELECT id FROM users WHERE deleted = 0 AND role != 'admin' AND expires_at IS NOT NULL AND expires_at < ?`).all(now());
    rows.forEach(r => anonymize(r.id));
    if (rows.length) console.log(`[comptes] ${rows.length} compte(s) supprimé(s) : fin de formation dépassée`);
    return rows.length;
  }
  purgeExpired();
  setInterval(purgeExpired, 3600e3).unref();

  return { gate, me, purgeExpired, anonymize, FILIERES, filiereNom };
};

module.exports.computeEnd = computeEnd;
