// « Classe » visée par un contenu de formateur : tout le CFA, une filière, ou une formation précise.
const TZ = process.env.APP_TZ || 'America/Cayenne';
const today = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(Date.parse(s));
module.exports = function cible({ db, accounts, formations }) {
  const isStaff = u => !!u && (u.role === 'admin' || u.role === 'prof');

  // Normalise { filiere, formation } envoyé par le navigateur
  function parse(b = {}) {
    let filiere = accounts.FILIERES.some(f => f.id === b.filiere) ? b.filiere : null;
    let formation = b.formation ? String(b.formation) : null;
    if (formation) {
      const f = formations.get(formation);
      if (!f) throw new Error('Formation inconnue');
      if (filiere && f.filiere !== filiere) throw new Error('Cette formation n’est pas dans cette filière');
      filiere = f.filiere;
    }
    return { filiere, formation };
  }
  // Un élève sans formation précise voit les contenus de sa filière, mais pas ceux réservés à une formation
  const match = (u, t) => isStaff(u) || (u.role === 'eleve' && (!t.filiere || t.filiere === u.filiere) && (!t.formation || t.formation === u.formation));
  const label = t => (t.formation && formations.nom(t.formation)) || (t.filiere && accounts.filiereNom(t.filiere)) || 'Tout le CFA';
  function students(t = {}) {
    const where = ["role = 'eleve'", 'deleted = 0', 'banned = 0'], args = [];
    if (t.filiere) { where.push('filiere = ?'); args.push(t.filiere); }
    if (t.formation) { where.push('formation = ?'); args.push(t.formation); }
    return db.prepare(`SELECT id, display_name, username, filiere, formation FROM users WHERE ${where.join(' AND ')} ORDER BY display_name`).all(...args);
  }
  const nameOf = id => db.prepare('SELECT display_name FROM users WHERE id = ?').get(id)?.display_name || 'Ancien compte';
  const userById = id => db.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').get(+id);
  return { parse, match, label, students, isStaff, nameOf, userById, today, isDate };
};
