// Catalogue des 41 formations du CFA CEVEDOM (content/formations.json) : fiche de chaque formation,
// examens par filière, où trouver l'info officielle, et ciblage des contenus (« pour ta formation »).
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'content', 'formations.json');
let DATA = load();
function load() {
  const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  d.byId = new Map(d.formations.map(f => [f.id, f]));
  return d;
}

const get = id => (id && DATA.byId.get(id)) || null;
const valid = (id, filiere) => { const f = get(id); return !!f && (!filiere || f.filiere === filiere); };
const nom = id => get(id)?.nom || null;

// Un contenu ciblé porte une liste « publics » : "*" (tout le monde), une filière ("BTS"),
// un identifiant de formation ("bts-sio") ou un domaine ("d:numerique").
function matches(u, publics) {
  if (!publics || !publics.length || publics.includes('*')) return true;
  if (!u || u.role !== 'eleve') return true; // formateurs et modérateurs voient tout
  const f = get(u.formation);
  return publics.some(p => p === u.filiere || (f && (p === f.id || p === `d:${f.domaine}`)));
}
// Plus c'est précis, plus c'est « pour toi » : formation > domaine > filière > tous
function score(u, publics) {
  if (!u || u.role !== 'eleve' || !publics?.length) return 0;
  const f = get(u.formation);
  if (f && publics.includes(f.id)) return 3;
  if (f && publics.includes(`d:${f.domaine}`)) return 2;
  if (publics.includes(u.filiere)) return 1;
  return 0;
}

module.exports = function setupFormations(app, { auth, admin, bad }) {
  const light = f => ({ id: f.id, nom: f.nom, filiere: f.filiere, niveau: f.niveau, domaine: f.domaine, rncp: f.rncp, duree: f.duree });

  // Liste publique (utilisée aussi à l'inscription, avant d'avoir un compte)
  app.get('/api/formations', (req, res) => {
    res.json({ domaines: DATA.domaines, niveaux: DATA.niveaux, source: DATA.source, items: DATA.formations.map(light) });
  });
  app.get('/api/formations/:id', auth, (req, res) => {
    const f = get(req.params.id);
    if (!f) return bad(res, 'Formation introuvable', 404);
    const examen = DATA.examens[f.filiere];
    const ou = [...DATA.ou_trouver.tous, ...(f.filiere === 'TP' ? DATA.ou_trouver.tp : DATA.ou_trouver.diplome)];
    res.json({ ...f, domaine_nom: DATA.domaines[f.domaine], niveau_nom: DATA.niveaux[f.niveau], examen, ou_trouver: ou, commun: DATA.commun, source: DATA.source });
  });
  // Infos d'examen de toutes les filières (page CFA & examens)
  app.get('/api/examens', auth, (req, res) => res.json(DATA.examens));
  app.post('/api/admin/reload-formations', auth, admin, (req, res) => {
    try { DATA = load(); } catch (e) { return bad(res, 'Fichier formations.json invalide : ' + e.message); }
    res.json({ ok: true, formations: DATA.formations.length });
  });

  return { get, valid, nom, matches, score, examens: () => DATA.examens, all: () => DATA.formations };
};
const light = () => DATA.formations.map(f => ({ id: f.id, nom: f.nom, filiere: f.filiere, domaine: f.domaine }));
Object.assign(module.exports, { get, valid, nom, matches, score, light, examens: () => DATA.examens });
