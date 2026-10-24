// Planning : événements (CFA / filière / perso), répétition hebdomadaire, rappels,
// réunions planifiées et flux iCalendar (RFC 5545) pour Google Agenda, Outlook, iPhone…
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TZ = process.env.APP_TZ || 'America/Cayenne';
const TYPES = {
  examen: 'Examen', rendu: 'Rendu / dossier', reunion: 'Réunion', cours: 'Cours',
  conge: 'Congés', absence: 'Absence', perso: 'Perso', autre: 'Autre',
};
// Précision selon le type (alternance)
const DETAILS = {
  absence: { cfa: 'Absence au CFA', entreprise: 'Absence en entreprise', les_deux: 'Absence CFA + entreprise' },
  conge: { cp: 'Congés payés', examen: 'Congé révision examen (5 jours)', fermeture: 'Vacances / fermeture du CFA' },
};
const NO_REMINDER = new Set(['cours', 'absence', 'conge']); // pas de rappel pour ces types
const isStaff = u => u && (u.role === 'admin' || u.role === 'prof');
const DAY = 864e5, WEEK = 7 * DAY;
const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const ICS_DAYS = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const weekday = t => WD[weekdayFmt.format(new Date(t))];
const dateParts = t => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
  .formatToParts(new Date(t)).map(p => [p.type, p.value]));
const localDate = t => { const p = dateParts(t); return `${p.year}${p.month}${p.day}`; };
const frDate = (t, allDay) => new Intl.DateTimeFormat('fr-FR', allDay
  ? { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }
  : { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(t));

// Toutes les occurrences d'un événement qui touchent [from, to)
function occurrences(ev, from, to) {
  const dur = Math.max(0, (ev.end_at || ev.start_at) - ev.start_at);
  if (!ev.repeat_days) return ev.start_at < to && ev.start_at + dur >= from ? [ev.start_at] : [];
  const days = ev.repeat_days.split(',').map(Number);
  const until = ev.repeat_until || Infinity;
  const out = [];
  for (const d of days) {
    let t = ev.start_at;
    for (let i = 0; i < 7 && weekday(t) !== d; i++) t += DAY;
    if (t + dur < from) t += Math.floor((from - dur - t) / WEEK) * WEEK;
    while (t < to && t <= until && out.length < 500) {
      if (t + dur >= from) out.push(t);
      t += WEEK;
    }
  }
  return out.sort((a, b) => a - b);
}

// ---------- iCalendar (RFC 5545) ----------
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsUtc = t => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Pliage à 75 octets sans couper un caractère UTF-8 (RFC 5545 §3.1)
function fold(line) {
  const out = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
function toIcs(events, calName) {
  const now = icsUtc(Date.now());
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Classe SIO//Planning//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `NAME:${icsText(calName)}`, `X-WR-CALNAME:${icsText(calName)}`, `X-WR-TIMEZONE:${TZ}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  for (const ev of events) {
    L.push('BEGIN:VEVENT', `UID:event-${ev.id}@classe-sio`, `DTSTAMP:${now}`);
    if (ev.all_day) {
      const lastDay = (ev.end_at || ev.start_at);
      L.push(`DTSTART;VALUE=DATE:${localDate(ev.start_at)}`, `DTEND;VALUE=DATE:${localDate(lastDay + DAY)}`);
    } else {
      L.push(`DTSTART:${icsUtc(ev.start_at)}`, `DTEND:${icsUtc(ev.end_at || ev.start_at + 3600e3)}`);
    }
    if (ev.repeat_days) {
      const by = ev.repeat_days.split(',').map(d => ICS_DAYS[+d]).join(',');
      L.push(`RRULE:FREQ=WEEKLY;BYDAY=${by}${ev.repeat_until ? `;UNTIL=${icsUtc(ev.repeat_until)}` : ''}`);
    }
    L.push(`SUMMARY:${icsText(ev.title)}`);
    if (ev.description) L.push(`DESCRIPTION:${icsText(ev.description)}`);
    if (ev.location) L.push(`LOCATION:${icsText(ev.location)}`);
    L.push(`CATEGORIES:${icsText(TYPES[ev.type] || 'Autre')}`);
    if (ev.type !== 'cours' && !ev.all_day) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(ev.title)}`, 'TRIGGER:-PT30M', 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

module.exports = function setupCalendar(app, { db, auth, bad, now, text, notifier, meetings, accounts, uploads, onChange = () => {} }) {
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'autre',
    description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
    start_at INTEGER NOT NULL, end_at INTEGER, all_day INTEGER NOT NULL DEFAULT 0,
    visibility TEXT NOT NULL DEFAULT 'perso', filiere TEXT,
    created_by INTEGER, repeat_days TEXT, repeat_until INTEGER,
    meeting_id TEXT, detail TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rythmes (filiere TEXT PRIMARY KEY, days TEXT NOT NULL DEFAULT '');
  CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);
  CREATE TABLE IF NOT EXISTS event_reminders (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    occ INTEGER NOT NULL, user_id INTEGER NOT NULL,
    PRIMARY KEY (event_id, occ, user_id)
  );`);
  const ucols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!ucols.includes('cal_token')) db.exec('ALTER TABLE users ADD COLUMN cal_token TEXT');
  if (!ucols.includes('rythme')) db.exec('ALTER TABLE users ADD COLUMN rythme TEXT'); // jours de CFA propres à l'élève
  if (!db.prepare('PRAGMA table_info(events)').all().some(c => c.name === 'detail')) db.exec('ALTER TABLE events ADD COLUMN detail TEXT');

  // Premier lancement : dates nationales du BTS 2027 (épreuves communes)
  if (!db.prepare('SELECT COUNT(*) AS n FROM events').get().n) {
    try {
      const infos = JSON.parse(fs.readFileSync(path.join(__dirname, 'content', 'infos.json'), 'utf8'));
      const ins = db.prepare(`INSERT INTO events (title, type, description, start_at, all_day, visibility, filiere, created_at)
        VALUES (?, ?, ?, ?, 1, 'filiere', 'BTS', ?)`);
      for (const d of infos.examens.dates) {
        const [y, m, day] = d.date.split('-').map(Number);
        const midnight = Date.UTC(y, m - 1, day, 3); // minuit en Guyane (UTC-3)
        ins.run(d.titre.replace(/ \(.*\)$/, ''), d.titre.startsWith('Fin des inscriptions') ? 'rendu' : 'examen',
          `${infos.examens.note}\nSource : ${infos.examens.source.url}`, midnight, now());
      }
    } catch (e) { console.warn('[planning] dates d’examen non importées', e.message); }
  }

  // Les absences des élèves sont visibles par les formateurs et modérateurs, pas par les autres élèves
  const visibleTo = (u, ev) => ev.visibility === 'cfa'
    || (ev.visibility === 'filiere' && (isStaff(u) || u.filiere === ev.filiere))
    || (ev.visibility === 'perso' && (ev.created_by === u.id || (ev.type === 'absence' && isStaff(u))));
  const canEdit = (u, ev) => u.role === 'admin' || ev.created_by === u.id;
  const visibleEvents = u => db.prepare('SELECT * FROM events').all().filter(ev => visibleTo(u, ev));

  // Contrôle et normalisation d'un événement envoyé par le navigateur
  function parse(u, b, existing = {}) {
    const ev = { ...existing };
    if ('title' in b || !existing.id) ev.title = text(b.title, 120);
    if (!ev.title) throw new Error('Titre obligatoire');
    if ('type' in b || !existing.id) ev.type = TYPES[b.type] ? b.type : 'autre';
    if ('detail' in b || !existing.id || 'type' in b) {
      const opts = DETAILS[ev.type];
      ev.detail = opts ? (opts[b.detail] ? b.detail : Object.keys(opts)[0]) : null;
    }
    if ('description' in b) ev.description = text(b.description, 2000);
    if ('location' in b) ev.location = text(b.location, 120);
    if ('all_day' in b || !existing.id) ev.all_day = b.all_day ? 1 : 0;
    if ('start_at' in b || !existing.id) ev.start_at = +b.start_at;
    if ('end_at' in b) ev.end_at = b.end_at ? +b.end_at : null;
    if (!Number.isFinite(ev.start_at) || Math.abs(ev.start_at - now()) > 5 * 365 * DAY) throw new Error('Date invalide');
    if (ev.end_at != null && (!Number.isFinite(ev.end_at) || ev.end_at < ev.start_at || ev.end_at - ev.start_at > 31 * DAY)) throw new Error('Date de fin invalide');
    if ('visibility' in b || 'type' in b || !existing.id) {
      ev.visibility = ['perso', 'filiere', 'cfa'].includes(b.visibility ?? ev.visibility) ? (b.visibility ?? ev.visibility) : 'perso';
      // Une absence ou des congés payés sont toujours personnels ; une fermeture du CFA est publiée par l'équipe
      if (ev.type === 'absence' || (ev.type === 'conge' && ev.detail !== 'fermeture')) ev.visibility = 'perso';
      if (ev.type === 'conge' && ev.detail === 'fermeture' && !isStaff(u)) throw new Error('Seule l’équipe du CFA peut publier une fermeture');
      if (ev.type === 'conge' && ev.detail === 'fermeture' && ev.visibility === 'perso') ev.visibility = 'cfa';
      if (ev.visibility === 'cfa' && !isStaff(u)) throw new Error('Seuls les formateurs et modérateurs publient pour tout le CFA');
      if (ev.visibility === 'filiere') {
        ev.filiere = isStaff(u) && accounts.FILIERES.some(f => f.id === b.filiere) ? b.filiere : (u.filiere || existing.filiere);
        if (!ev.filiere) throw new Error('Choisis une filière');
      } else ev.filiere = null;
    }
    if ('repeat_days' in b) {
      const days = [...new Set((Array.isArray(b.repeat_days) ? b.repeat_days : []).map(Number).filter(d => d >= 1 && d <= 7))].sort();
      ev.repeat_days = days.length ? days.join(',') : null;
      ev.repeat_until = days.length && b.repeat_until ? +b.repeat_until : null;
      if (ev.repeat_days && !ev.repeat_until) throw new Error('Indique jusqu’à quand ça se répète');
      if (ev.repeat_until && (ev.repeat_until < ev.start_at || ev.repeat_until - ev.start_at > 2 * 365 * DAY)) throw new Error('Fin de répétition invalide (2 ans max)');
    }
    // Le début d'une série doit tomber sur un des jours choisis (RFC 5545)
    if (ev.repeat_days) {
      const days = ev.repeat_days.split(',').map(Number);
      const dur = ev.end_at ? ev.end_at - ev.start_at : null;
      for (let i = 0; i < 7 && !days.includes(weekday(ev.start_at)); i++) ev.start_at += DAY;
      if (dur != null) ev.end_at = ev.start_at + dur;
    }
    return ev;
  }

  const nameOf = id => db.prepare('SELECT display_name FROM users WHERE id = ?').get(id)?.display_name || '';
  const out = (u, ev, occ) => {
    const dur = (ev.end_at || ev.start_at) - ev.start_at;
    const others = ev.visibility === 'perso' && ev.created_by !== u.id; // absence d'un élève vue par un formateur
    return {
      ...ev, occ_start: occ, occ_end: occ + dur, can_edit: canEdit(u, ev),
      type_nom: TYPES[ev.type], detail_nom: DETAILS[ev.type]?.[ev.detail] || null, filiere_nom: accounts.filiereNom(ev.filiere),
      author: others ? nameOf(ev.created_by) : null,
      meeting_live: !!(ev.meeting_id && meetings.exists(ev.meeting_id)),
      attachments: uploads.forTargets('event', [ev.id])[ev.id] || [],
    };
  };

  // ---------- Rythme d'alternance (jours au CFA) ----------
  const parseDays = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map(Number).filter(d => d >= 1 && d <= 7))].sort().join(',');
  const filiereDays = f => (f && db.prepare('SELECT days FROM rythmes WHERE filiere = ?').get(f)?.days) || '';
  const rythmeOf = u => ({ filiere: filiereDays(u.filiere), mine: u.rythme ?? null, effective: u.rythme ?? filiereDays(u.filiere) });
  app.get('/api/rythme', auth, (req, res) => res.json({
    ...rythmeOf(req.user),
    filieres: Object.fromEntries(accounts.FILIERES.map(f => [f.id, filiereDays(f.id)])),
  }));
  app.post('/api/rythme', auth, (req, res) => {
    // null = revenir au rythme de la filière
    const v = req.body.days === null ? null : parseDays(req.body.days);
    db.prepare('UPDATE users SET rythme = ? WHERE id = ?').run(v, req.user.id);
    res.json(rythmeOf({ ...req.user, rythme: v }));
  });
  app.post('/api/rythme/filiere', auth, (req, res) => {
    if (!isStaff(req.user)) return bad(res, 'Réservé aux formateurs et modérateurs', 403);
    if (!accounts.FILIERES.some(f => f.id === req.body.filiere)) return bad(res, 'Filière inconnue');
    db.prepare('INSERT INTO rythmes (filiere, days) VALUES (?, ?) ON CONFLICT(filiere) DO UPDATE SET days = excluded.days').run(req.body.filiere, parseDays(req.body.days));
    res.json({ ok: true });
  });

  // ---------- Congés : jours ouvrables posés (lundi → samedi) sur la période de référence ----------
  function refPeriod(t = now()) {
    const p = dateParts(t);
    const y = +p.month >= 6 ? +p.year : +p.year - 1;
    return { from: Date.UTC(y, 5, 1, 3), to: Date.UTC(y + 1, 5, 1, 3), label: `1er juin ${y} → 31 mai ${y + 1}` };
  }
  function ouvrables(start, end) {
    let n = 0;
    for (let t = start; t <= end; t += DAY) if (weekday(t) !== 7) n++;
    return n;
  }
  function congesSummary(u) {
    const ref = refPeriod();
    const sum = { cp: 0, examen: 0, periode: ref.label };
    for (const ev of db.prepare("SELECT * FROM events WHERE type = 'conge' AND created_by = ? AND visibility = 'perso'").all(u.id)) {
      for (const o of occurrences(ev, ref.from, ref.to)) {
        const end = o + ((ev.end_at || ev.start_at) - ev.start_at);
        sum[ev.detail === 'examen' ? 'examen' : 'cp'] += ouvrables(o, end);
      }
    }
    return sum;
  }
  // Jours de CFA compris dans des congés : on prévient (le temps au CFA est du temps de travail)
  function cfaOverlap(u, ev) {
    if (ev.type !== 'conge' || ev.detail === 'fermeture') return 0;
    const days = (u.rythme ?? filiereDays(u.filiere)).split(',').filter(Boolean).map(Number);
    if (!days.length) return 0;
    let n = 0;
    for (let t = ev.start_at; t <= (ev.end_at || ev.start_at); t += DAY) if (days.includes(weekday(t))) n++;
    return n;
  }

  app.get('/api/events', auth, (req, res) => {
    const from = +req.query.from || now() - 31 * DAY;
    const to = Math.min(+req.query.to || now() + 62 * DAY, from + 400 * DAY);
    const list = [];
    for (const ev of visibleEvents(req.user)) for (const o of occurrences(ev, from, to)) list.push(out(req.user, ev, o));
    list.sort((a, b) => a.occ_start - b.occ_start || b.all_day - a.all_day);
    res.json({
      events: list.slice(0, 1000), types: TYPES, details: DETAILS, staff: isStaff(req.user),
      rythme: rythmeOf(req.user), conges: req.user.role === 'eleve' ? congesSummary(req.user) : null,
    });
  });

  app.post('/api/events', auth, (req, res) => {
    let ev;
    try { ev = parse(req.user, req.body); } catch (e) { return bad(res, e.message); }
    const r = db.prepare(`INSERT INTO events (title, type, description, location, start_at, end_at, all_day, visibility, filiere, created_by, repeat_days, repeat_until, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ev.title, ev.type, ev.description || '', ev.location || '', ev.start_at, ev.end_at ?? null,
      ev.all_day, ev.visibility, ev.filiere ?? null, req.user.id, ev.repeat_days ?? null, ev.repeat_until ?? null, now());
    db.prepare('UPDATE events SET detail = ? WHERE id = ?').run(ev.detail ?? null, r.lastInsertRowid);
    try { uploads.link(req.user, req.body.attachments, 'event', r.lastInsertRowid, null); } catch { /* pièces jointes facultatives */ }
    onChange(db.prepare('SELECT * FROM events WHERE id = ?').get(r.lastInsertRowid));
    const warnings = [];
    const n = cfaOverlap(req.user, ev);
    if (n) warnings.push(`${n} jour(s) de CFA inclus dans ces congés : le temps au CFA est du temps de travail, vérifie avec ton employeur et le CFA.`);
    res.json({ id: r.lastInsertRowid, warnings });
  });

  app.patch('/api/events/:id', auth, (req, res) => {
    const cur = db.prepare('SELECT * FROM events WHERE id = ?').get(+req.params.id);
    if (!cur || !visibleTo(req.user, cur)) return bad(res, 'Événement introuvable', 404);
    if (!canEdit(req.user, cur)) return bad(res, 'Seul son auteur ou un modérateur peut le modifier', 403);
    let ev;
    try { ev = parse(req.user, req.body, cur); } catch (e) { return bad(res, e.message); }
    db.prepare(`UPDATE events SET title = ?, type = ?, description = ?, location = ?, start_at = ?, end_at = ?, all_day = ?,
      visibility = ?, filiere = ?, repeat_days = ?, repeat_until = ?, detail = ? WHERE id = ?`).run(ev.title, ev.type, ev.description, ev.location,
      ev.start_at, ev.end_at ?? null, ev.all_day, ev.visibility, ev.filiere ?? null, ev.repeat_days ?? null, ev.repeat_until ?? null, ev.detail ?? null, cur.id);
    db.prepare('DELETE FROM event_reminders WHERE event_id = ?').run(cur.id); // la date a pu changer : nouveau rappel
    onChange(cur); onChange(db.prepare('SELECT * FROM events WHERE id = ?').get(cur.id));
    res.json({ ok: true });
  });

  app.delete('/api/events/:id', auth, (req, res) => {
    const cur = db.prepare('SELECT * FROM events WHERE id = ?').get(+req.params.id);
    if (!cur || !visibleTo(req.user, cur)) return bad(res, 'Événement introuvable', 404);
    if (!canEdit(req.user, cur)) return bad(res, 'Seul son auteur ou un modérateur peut le supprimer', 403);
    uploads.removeFor('event', [cur.id]);
    db.prepare('DELETE FROM events WHERE id = ?').run(cur.id);
    onChange(cur);
    res.json({ ok: true });
  });

  // Réunion planifiée : la salle est créée au moment où quelqu'un la rejoint
  app.post('/api/events/:id/meeting', auth, (req, res) => {
    const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(+req.params.id);
    if (!ev || !visibleTo(req.user, ev)) return bad(res, 'Événement introuvable', 404);
    if (ev.type !== 'reunion') return bad(res, 'Ce n’est pas une réunion');
    if (ev.meeting_id && meetings.exists(ev.meeting_id)) return res.json({ id: ev.meeting_id });
    const id = meetings.createRoom(ev.title, req.user);
    db.prepare('UPDATE events SET meeting_id = ? WHERE id = ?').run(id, ev.id);
    res.json({ id });
  });

  // ---------- Abonnement agenda (lien secret, révocable) ----------
  const baseUrl = req => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  function feedUrl(req, reset) {
    let tok = req.user.cal_token;
    if (!tok || reset) {
      tok = crypto.randomBytes(24).toString('hex');
      db.prepare('UPDATE users SET cal_token = ? WHERE id = ?').run(tok, req.user.id);
    }
    return `${baseUrl(req)}/cal/${tok}.ics`;
  }
  app.get('/api/calendar/feed', auth, (req, res) => res.json({ url: feedUrl(req, false) }));
  app.post('/api/calendar/feed/reset', auth, (req, res) => res.json({ url: feedUrl(req, true) }));
  app.get('/cal/:token.ics', (req, res) => {
    const tok = String(req.params.token);
    const u = /^[a-f0-9]{48}$/.test(tok) && db.prepare('SELECT * FROM users WHERE cal_token = ? AND deleted = 0 AND banned = 0').get(tok);
    if (!u) return res.status(404).type('text/plain').send('Lien d’agenda invalide ou révoqué');
    const evs = visibleEvents(u).filter(ev => (ev.repeat_until || ev.end_at || ev.start_at) > now() - 60 * DAY);
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900', 'Content-Disposition': 'inline; filename="classe-sio.ics"' });
    res.send(toIcs(evs, `Classe SIO — ${u.display_name}`));
  });

  // ---------- Rappels (via les notifications) ----------
  function recipients(ev) {
    if (ev.visibility === 'perso') return [ev.created_by];
    const rows = ev.visibility === 'cfa'
      ? db.prepare('SELECT id FROM users WHERE deleted = 0 AND banned = 0').all()
      : db.prepare('SELECT id FROM users WHERE deleted = 0 AND banned = 0 AND filiere = ?').all(ev.filiere);
    return rows.map(r => r.id);
  }
  function sendReminders(at = now()) {
    let n = 0;
    for (const ev of db.prepare('SELECT * FROM events').all()) {
      if (NO_REMINDER.has(ev.type)) continue;
      // Rappel quand l'événement commence dans les prochaines 24 h
      for (const occ of occurrences(ev, at, at + DAY)) {
        if (occ <= at) continue;
        for (const uid of recipients(ev)) {
          const done = db.prepare('INSERT OR IGNORE INTO event_reminders (event_id, occ, user_id) VALUES (?, ?, ?)').run(ev.id, occ, uid);
          if (!done.changes) continue;
          notifier.notify(uid, {
            type: 'rappel', link: `#/planning?date=${occ}`,
            title: `🗓️ ${TYPES[ev.type] === 'Perso' ? 'Rappel' : TYPES[ev.type]} : ${ev.title}`,
            body: `${frDate(occ, ev.all_day)}${ev.location ? ' — ' + ev.location : ''}`,
          });
          n++;
        }
      }
    }
    db.prepare('DELETE FROM event_reminders WHERE occ < ?').run(at - 30 * DAY);
    return n;
  }
  setInterval(() => { try { sendReminders(); } catch (e) { console.warn('[planning] rappels', e.message); } }, 5 * 60e3).unref();

  // Prochains événements pour l'accueil
  function upcoming(u, limit = 5) {
    const list = [];
    for (const ev of visibleEvents(u)) {
      if (ev.type === 'cours') continue;
      for (const o of occurrences(ev, now(), now() + 120 * DAY)) list.push(out(u, ev, o));
    }
    return list.sort((a, b) => a.occ_start - b.occ_start).slice(0, limit);
  }

  return { sendReminders, upcoming, occurrences, toIcs, TYPES, visibleTo, rythmeOf, weekday, isStaff, congesSummary };
};
module.exports.occurrences = occurrences;
module.exports.toIcs = toIcs;
module.exports.fold = fold;
