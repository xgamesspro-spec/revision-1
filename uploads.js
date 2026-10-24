// Pièces jointes, selon l'OWASP File Upload Cheat Sheet :
// liste blanche d'extensions, vérification de la signature (magic bytes), nom aléatoire côté serveur,
// stockage hors du dossier web, taille et quotas limités, accès réservé aux personnes autorisées,
// images décodées puis réencodées (métadonnées EXIF/GPS supprimées), antivirus ClamAV optionnel.
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const express = require('express');
const sharp = require('sharp');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });

const MAX_MB = +(process.env.UPLOAD_MAX_MB || 10);
const DAILY_MB = +(process.env.UPLOAD_DAILY_MB || 100);
const DAILY_FILES = 50;
const MAX_PER_POST = 5;

const latin = (b, s, e) => b.subarray(s, e).toString('latin1');
const SIGNATURES = {
  png: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: b => ['GIF87a', 'GIF89a'].includes(latin(b, 0, 6)),
  webp: b => latin(b, 0, 4) === 'RIFF' && latin(b, 8, 12) === 'WEBP',
  pdf: b => latin(b, 0, 5) === '%PDF-',
  zip: b => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04, // conteneur des docx/xlsx/pptx/odt
  text: b => !b.subarray(0, 65536).includes(0),
  any: () => true, // Packet Tracer : format binaire sans signature publique
};
const T = (sig, mime, image = false) => ({ sig, mime, image });
const TYPES = {
  png: T('png', 'image/png', true), jpg: T('jpg', 'image/jpeg', true), jpeg: T('jpg', 'image/jpeg', true),
  gif: T('gif', 'image/gif', true), webp: T('webp', 'image/webp', true),
  pdf: T('pdf', 'application/pdf'),
  docx: T('zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  xlsx: T('zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  pptx: T('zip', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  odt: T('zip', 'application/vnd.oasis.opendocument.text'),
  ods: T('zip', 'application/vnd.oasis.opendocument.spreadsheet'),
  odp: T('zip', 'application/vnd.oasis.opendocument.presentation'),
  txt: T('text', 'text/plain'), md: T('text', 'text/markdown'), csv: T('text', 'text/csv'), log: T('text', 'text/plain'),
  conf: T('text', 'text/plain'), cfg: T('text', 'text/plain'), ini: T('text', 'text/plain'), json: T('text', 'application/json'),
  yml: T('text', 'text/yaml'), yaml: T('text', 'text/yaml'), py: T('text', 'text/x-python'), sh: T('text', 'text/x-sh'),
  ps1: T('text', 'text/plain'),
  pkt: T('any', 'application/octet-stream'), pka: T('any', 'application/octet-stream'),
};
const ALLOWED = Object.keys(TYPES);

// Nom affiché seulement (le fichier est stocké sous un identifiant aléatoire)
function cleanName(raw) {
  let n = String(raw || '').normalize('NFC');
  n = n.split(/[\\/]/).pop();
  n = n.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').replace(/\.{2,}/g, '.').replace(/^[.\- ]+/, '').trim();
  if (n.length > 100) {
    const ext = path.extname(n);
    n = n.slice(0, 100 - ext.length) + ext;
  }
  return n;
}

// RFC 6266 / RFC 8187 : nom ASCII de secours + nom UTF-8 encodé
function contentDisposition(type, name) {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// Antivirus ClamAV (protocole clamd INSTREAM), actif si CLAMAV_HOST est défini
function clamScan(buf) {
  const host = process.env.CLAMAV_HOST;
  if (!host) return Promise.resolve('skip');
  const port = +(process.env.CLAMAV_PORT || 3310);
  return new Promise((resolve, reject) => {
    const s = net.connect(port, host);
    let out = '';
    s.setTimeout(30000);
    s.on('connect', () => {
      s.write('zINSTREAM\0');
      for (let i = 0; i < buf.length; i += 65536) {
        const chunk = buf.subarray(i, i + 65536);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        s.write(len); s.write(chunk);
      }
      s.write(Buffer.alloc(4));
    });
    s.on('data', d => { out += d; if (out.includes('\0')) s.end(); });
    s.on('end', () => resolve(out.replace(/\0/g, '').trim()));
    s.on('timeout', () => { s.destroy(); reject(new Error('timeout')); });
    s.on('error', reject);
  });
}

async function processImage(buf, ext) {
  const animated = ext === 'gif' || ext === 'webp';
  const opts = { limitInputPixels: 40e6, animated, failOn: 'error' };
  let img = sharp(buf, opts);
  if (!animated) img = img.rotate(); // applique l'orientation EXIF avant de supprimer les métadonnées
  img = img.resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true });
  if (ext === 'png') img = img.png({ compressionLevel: 9 });
  else if (ext === 'jpg' || ext === 'jpeg') img = img.jpeg({ quality: 85, mozjpeg: true });
  else if (ext === 'webp') img = img.webp({ quality: 85 });
  else if (ext === 'gif') img = img.gif();
  // Par défaut, sharp n'écrit aucune métadonnée (EXIF, GPS, XMP, IPTC) dans le fichier produit
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.pageHeight || info.height };
}

module.exports = function setupUploads(app, { db, auth, bad, now, canSeeChannelId }) {
  db.exec(`CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    ext TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    is_image INTEGER NOT NULL DEFAULT 0,
    width INTEGER, height INTEGER,
    target TEXT, target_id INTEGER, channel_id INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_att_target ON attachments(target, target_id);
  CREATE INDEX IF NOT EXISTS idx_att_user ON attachments(user_id, created_at);`);

  const filePath = id => path.join(UPLOAD_DIR, id);
  const publicAtt = a => ({ id: a.id, name: a.name, ext: a.ext, size: a.size, is_image: !!a.is_image, width: a.width, height: a.height });

  app.get('/api/uploads/config', auth, (req, res) => res.json({ max_mb: MAX_MB, daily_mb: DAILY_MB, max_per_post: MAX_PER_POST, allowed: ALLOWED }));

  app.post('/api/uploads', auth, express.raw({ type: () => true, limit: MAX_MB * 1024 * 1024 }), async (req, res) => {
    let name;
    try { name = cleanName(decodeURIComponent(String(req.get('X-Filename') || ''))); } catch { return bad(res, 'Nom de fichier invalide'); }
    const ext = path.extname(name).slice(1).toLowerCase();
    const type = TYPES[ext];
    if (!name || !type) return bad(res, `Type de fichier non autorisé. Autorisés : ${ALLOWED.join(', ')}`, 415);
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return bad(res, 'Fichier vide');
    if (!SIGNATURES[type.sig](buf)) return bad(res, `Le contenu ne correspond pas à un fichier .${ext}`, 415);
    const day = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS total FROM attachments WHERE user_id = ? AND created_at > ?').get(req.user.id, now() - 864e5);
    if (day.n >= DAILY_FILES || day.total + buf.length > DAILY_MB * 1024 * 1024) return bad(res, `Quota journalier atteint (${DAILY_FILES} fichiers / ${DAILY_MB} Mo)`, 429);
    let data = buf, width = null, height = null;
    if (type.image) {
      try { ({ data, width, height } = await processImage(buf, ext)); } catch { return bad(res, 'Image illisible ou trop grande', 415); }
    }
    try {
      const verdict = await clamScan(data);
      if (verdict !== 'skip' && !/\bOK$/.test(verdict)) {
        console.warn(`[uploads] fichier refusé par l'antivirus (${req.user.username}) : ${verdict}`);
        return bad(res, 'Fichier refusé par l’antivirus', 422);
      }
    } catch {
      return bad(res, 'Antivirus indisponible, réessaie plus tard', 503); // en cas de doute on refuse
    }
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(filePath(id), data, { mode: 0o600 });
    db.prepare(`INSERT INTO attachments (id, user_id, name, ext, mime, size, is_image, width, height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, req.user.id, name, ext, type.mime, data.length, type.image ? 1 : 0, width, height, now());
    res.json(publicAtt(db.prepare('SELECT * FROM attachments WHERE id = ?').get(id)));
  });

  app.get('/api/files/:id', auth, (req, res) => {
    const a = /^[a-f0-9]{32}$/.test(req.params.id) && db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
    if (!a) return bad(res, 'Fichier introuvable', 404);
    // Fichier pas encore publié : seulement son auteur. Sinon : il faut avoir accès au salon.
    const allowed = a.target ? canSeeChannelId(req.user, a.channel_id) : a.user_id === req.user.id;
    if (!allowed) return bad(res, 'Fichier introuvable', 404);
    const inline = a.is_image && req.query.dl !== '1';
    res.set({
      'Content-Type': inline ? a.mime : 'application/octet-stream',
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', a.name),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    });
    fs.createReadStream(filePath(a.id)).on('error', () => res.status(404).end()).pipe(res);
  });

  // Rattache des fichiers envoyés à un message / sujet / réponse
  function link(user, ids, target, targetId, channelId) {
    ids = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    if (ids.length > MAX_PER_POST) throw new Error(`${MAX_PER_POST} pièces jointes maximum`);
    const rows = ids.map(id => db.prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ? AND target IS NULL').get(id, user.id));
    if (rows.some(r => !r)) throw new Error('Pièce jointe invalide');
    const up = db.prepare('UPDATE attachments SET target = ?, target_id = ?, channel_id = ? WHERE id = ?');
    rows.forEach(r => up.run(target, targetId, channelId, r.id));
    return rows.length;
  }
  // Vérification avant création du message (évite un message créé puis une erreur)
  function check(user, ids) {
    ids = Array.isArray(ids) ? ids : [];
    if (ids.length > MAX_PER_POST) throw new Error(`${MAX_PER_POST} pièces jointes maximum`);
    for (const id of ids) {
      if (!db.prepare('SELECT 1 FROM attachments WHERE id = ? AND user_id = ? AND target IS NULL').get(String(id), user.id)) throw new Error('Pièce jointe invalide');
    }
    return ids.length;
  }
  function forTargets(target, ids) {
    const out = {};
    if (!ids.length) return out;
    const rows = db.prepare(`SELECT * FROM attachments WHERE target = ? AND target_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`).all(target, ...ids);
    for (const r of rows) (out[r.target_id] ||= []).push(publicAtt(r));
    return out;
  }
  function removeRows(rows) {
    for (const r of rows) {
      fs.rm(filePath(r.id), { force: true }, () => {});
      db.prepare('DELETE FROM attachments WHERE id = ?').run(r.id);
    }
  }
  const removeFor = (target, ids) => ids.length && removeRows(db.prepare(`SELECT id FROM attachments WHERE target = ? AND target_id IN (${ids.map(() => '?').join(',')})`).all(target, ...ids));
  const removeChannel = channelId => removeRows(db.prepare('SELECT id FROM attachments WHERE channel_id = ?').all(channelId));

  // Fichiers envoyés mais jamais publiés : supprimés au bout de 24 h
  const sweep = () => removeRows(db.prepare('SELECT id FROM attachments WHERE target IS NULL AND created_at < ?').all(now() - 864e5));
  setInterval(sweep, 3600e3).unref();

  return { link, check, forTargets, removeFor, removeChannel, sweep, ALLOWED, MAX_MB };
};
module.exports.cleanName = cleanName;
module.exports.contentDisposition = contentDisposition;
