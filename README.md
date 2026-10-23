# Classe SIO — révisions, salons et forum de classe

Plateforme web pour une classe de BTS SIO, **réservée aux élèves** :

- 📖 **Révisions** : fiches de cours, cartes mémoire avec répétition espacée (1, 3, 7, 14, 30, 60 jours) et quiz corrigés, pour : réseaux, systèmes, cybersécurité, droit/RGPD, maths, culture générale (« Le vrai du faux »), anglais pro, sranan tongo & patwa, examens & portfolio. Les élèves peuvent aussi publier leurs propres fiches.
- 💬 **Salons façon Discord** en temps réel (#general, #entraide-reseau, #cyber…) avec la liste des élèves en ligne.
- 🗂️ **Forums** : sujets, réponses, « résolu », épinglage.
- 📰 **Actus** : une sélection « à la une » + les flux en direct du CERT-FR, IT-Connect, Le Monde Informatique, CNIL, Guyane la 1ère, L'Étudiant…
- 🎓 **CFA & examens** : infos CFA CEVEDOM, droits de l'apprenti, calendrier BTS 2027 et compte à rebours.
- 🛠️ **Modération** : codes d'invitation, suspension de comptes, nomination de modérateurs, gestion des salons.

**Accès réservé** : on ne peut s'inscrire qu'avec un code d'invitation. Le **premier compte créé devient modérateur**.

## Installation avec Docker (recommandé)

Sur un serveur Linux (VM Debian/Ubuntu par exemple) avec Docker installé :

```bash
git clone https://github.com/xgamesspro-spec/revision-1.git
cd revision-1
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
```

Puis ouvre `http://IP-DU-SERVEUR:3000`, crée ton compte (tu deviens modérateur), va dans **Modération** et génère un code d'invitation pour la classe.

Mise à jour : `git pull && docker compose up -d --build` (les données dans `data/` sont conservées).

## Installation sans Docker

Il faut **Node.js 22.5 ou plus récent** (SQLite est intégré à Node, rien à compiler).

```bash
npm install
npm start
```

## Configuration (variables d'environnement)

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | port d'écoute | `3000` |
| `DATA_DIR` | dossier de la base SQLite | `./data` |
| `CLASS_CODE` | code d'inscription permanent (en plus des codes générés) | vide |
| `COOKIE_SECURE` | `1` si le site est servi en HTTPS | `0` |
| `TRUST_PROXY` | `1` derrière un reverse proxy (Nginx, Caddy…) | `0` |

> Pour une mise en ligne, place la plateforme derrière un reverse proxy **HTTPS** (Caddy le fait en 3 lignes) et passe `COOKIE_SECURE` et `TRUST_PROXY` à `1`. Si tu utilises Nginx, désactive le buffering sur `/api/stream` (`proxy_buffering off;`) pour le temps réel.

## Ajouter ou modifier des cours

Chaque matière est un fichier JSON dans `content/matieres/` :

```json
{
  "nom": "Ma matière", "icone": "📘", "groupe": "Informatique SISR", "ordre": 9,
  "description": "…",
  "fiches": [{ "titre": "…", "contenu": "Markdown : ## titre, **gras**, tableaux, listes…" }],
  "quiz": [{ "q": "Question ?", "choix": ["A", "B", "C"], "reponse": 1, "explication": "…" }],
  "cartes": [{ "recto": "…", "verso": "…" }]
}
```

`reponse` est l'index du bon choix (on commence à 0). Après modification : bouton **« Recharger les contenus »** dans Modération (ou redémarrage).

- Les actus « à la une » : `content/alaune.json`
- Les infos CFA et dates d'examen : `content/infos.json`
- Les flux RSS : `config/feeds.json`

## Tests

```bash
npm test
```

## Structure

```
server.js        API (comptes, salons, forum, révisions, actus, modération) + temps réel (SSE)
db.js            base SQLite et salons par défaut
news.js          agrégateur de flux RSS (cache 1 h)
public/          interface web (HTML/CSS/JS sans framework)
content/         cours, quiz, cartes, infos CFA et actus
config/          flux d'actualités
```

## Sécurité

Mots de passe hachés (scrypt), cookies `HttpOnly` + `SameSite=Strict`, en-têtes CSP, tout le contenu des élèves est échappé à l'affichage, limitation des tentatives de connexion. **Ne publie jamais de données réelles de ton entreprise** dans les salons (RGPD).
