# Classe SIO — révisions, salons et forum de classe

Plateforme web pour une classe de BTS SIO, **réservée aux élèves** :

- 📖 **Révisions** : fiches de cours, cartes mémoire avec répétition espacée (1, 3, 7, 14, 30, 60 jours) et quiz corrigés, pour : réseaux, systèmes, cybersécurité, droit/RGPD, maths, culture générale (« Le vrai du faux »), anglais pro, sranan tongo & patwa, examens & portfolio. Les élèves peuvent aussi publier leurs propres fiches.
- 💬 **Salons façon Discord** en temps réel (#general, #entraide-reseau, #cyber…) avec la liste des élèves en ligne.
- 🗂️ **Forums** : sujets, réponses, « résolu », épinglage.
- 🎥 **Réunions vidéo (type Teams)** : caméra, micro, **partage d'écran**, main levée, réactions, chat de réunion, indicateur « parle », plein écran. Lancement depuis la page Réunions ou en un clic depuis un salon (le lien est posté automatiquement).
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

## HTTPS (obligatoire pour les réunions)

Les navigateurs **bloquent la caméra, le micro et le partage d'écran en HTTP** (sauf sur `localhost`). Pour les réunions il faut donc du HTTPS. Caddy est inclus :

1. Dans `docker-compose.yml`, mets ton domaine ou l'IP du serveur dans `SITE_ADDRESS`, et passe `COOKIE_SECURE` et `TRUST_PROXY` à `"1"`.
2. Lance : `docker compose --profile https up -d --build`
3. Ouvre `https://TON-DOMAINE-OU-IP`.

Avec une IP ou en réseau local, le certificat est auto-signé : le navigateur affiche un avertissement la première fois (« Paramètres avancés → Continuer »). Avec un vrai nom de domaine, retire la ligne `tls internal` du `Caddyfile` et le certificat sera valide automatiquement.

## Réunions : comment ça marche

- La vidéo passe **directement entre les navigateurs** (WebRTC en maillage) : le serveur ne fait que mettre les gens en relation, il ne voit pas passer la vidéo. Parfait jusqu'à ~6-8 personnes avec caméra (10 max par défaut, réglable avec `MEETING_MAX`). Au-delà, demande aux gens de couper leur caméra.
- Raccourcis : **M** = micro, **V** = caméra.
- Le partage d'écran marche sur ordinateur (Chrome, Edge, Firefox). Sur téléphone, on peut regarder mais pas partager.
- Les messages du chat de réunion ne sont pas enregistrés.
- **Si la connexion reste bloquée sur « connexion… »** (réseaux d'entreprise ou 4G stricts), active le relais **TURN** : `docker compose --profile turn up -d`, ouvre les ports 3478 (TCP/UDP) et 49160-49200 (UDP) sur le pare-feu, puis décommente `TURN_URL`, `TURN_USER`, `TURN_PASS` dans `docker-compose.yml` (mets le même mot de passe que dans le service `turn`).

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
| `MEETING_MAX` | participants max par réunion | `10` |
| `STUN_URLS` | serveurs STUN (séparés par des virgules) | `stun:stun.l.google.com:19302` |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | relais TURN optionnel | vide |
| `ICE_SERVERS` | configuration ICE complète en JSON (remplace les 2 lignes précédentes) | vide |

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
meetings.js      réunions vidéo : salles + signalisation WebRTC
Caddyfile        HTTPS (reverse proxy Caddy)
db.js            base SQLite et salons par défaut
news.js          agrégateur de flux RSS (cache 1 h)
public/          interface web (HTML/CSS/JS sans framework)
content/         cours, quiz, cartes, infos CFA et actus
config/          flux d'actualités
```

## Sécurité

Mots de passe hachés (scrypt), cookies `HttpOnly` + `SameSite=Strict`, en-têtes CSP, tout le contenu des élèves est échappé à l'affichage, limitation des tentatives de connexion. **Ne publie jamais de données réelles de ton entreprise** dans les salons (RGPD).
