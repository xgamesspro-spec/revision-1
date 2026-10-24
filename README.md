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

## Interactivité

- **Discussions vivantes** : réactions emoji sur les messages et les posts du forum, **répondre à un message précis** (citation cliquable, l'auteur est prévenu), **modifier** ses messages (✏️ ou ↑ dans la zone vide), « **… est en train d'écrire** », nouveaux messages animés.
- **Progression** (page 🏆) :
  - **XP et niveaux**, gagnés avec les cartes, les quiz, le défi du jour, les duels, les réponses sur le forum, les exercices rendus et les fiches partagées. Il y a un plafond par jour et par activité.
  - **Série 🔥** de jours de révision d'affilée, et **15 badges** à débloquer.
  - **Défi du jour** : 5 questions, les mêmes pour toute la classe, une seule tentative, avec un chrono et un classement du jour.
  - **Duels** entre élèves : mêmes 5 questions, chacun joue quand il veut (3 jours max). Le meilleur score gagne, le plus rapide en cas d'égalité.
  - **Classement** par filière (semaine ou depuis le début), avec un podium. Chacun peut choisir de ne pas y apparaître.
  - Le défi et les duels sont **corrigés côté serveur** : les bonnes réponses ne sont jamais envoyées au navigateur avant la fin.
- **Interface animée** :
  - transitions entre les pages, retours visuels au clic, confettis (quiz sans faute, niveau, badge), « +XP » flottant ;
  - **thème clair / sombre / auto**, **sons** au choix et animations désactivables (Mon compte → Apparence) ;
  - le réglage système « réduire les animations » est respecté.
- **Raccourcis** : **Ctrl + K** (recherche rapide de pages, salons et matières), **?** (aide), **1-4** pour répondre aux quiz, **← →** dans le planning.
- **En direct sans recharger** : forum, sujets, planning, exercices, boîte à idées, accueil, réactions et modifications. Si tu es en train d'écrire, rien n'est écrasé : un bouton « 🔄 Du nouveau — afficher » apparaît.

## Planning (alternance)

- **Navigation** : flèches ‹ ›, clic sur le mois pour **sauter à n'importe quel mois ou année**, touches ← → / T (aujourd'hui), glisser sur mobile. Le mois choisi est dans l'adresse (`#/planning?m=2027-05`), donc le bouton retour et le rechargement fonctionnent, en vue mois comme en vue liste.
- Vue **mois** et vue **liste**, avec des filtres par type : examen, rendu, réunion, cours, congés, absence, perso, autre.
- **Rythme d'alternance** : les formateurs et modérateurs règlent les jours de CFA de chaque filière, et chaque élève peut ajuster les siens. Le planning marque chaque jour « CFA » ou « Entreprise », et l'accueil affiche « Aujourd'hui : au CFA / en entreprise ».
- **Qui voit quoi** :
  - **Perso** (moi seul) : n'importe quel élève.
  - **Ma filière** : un élève pour la sienne, un formateur pour n'importe laquelle.
  - **Tout le CFA** : formateurs et modérateurs seulement.
- **Absences** : l'élève précise si c'est au CFA, en entreprise ou les deux, avec un motif et un **justificatif** en option. L'absence est visible **par lui et par l'équipe du CFA, jamais par les autres élèves**.
- **Congés** :
  - congés payés, **congé de révision de 5 jours** pour l'examen, et fermetures du CFA (publiées par l'équipe) ;
  - compteur des **jours ouvrables** posés sur la période de référence, du 1er juin au 31 mai ;
  - alerte si des congés tombent sur des jours de CFA, puisque le temps au CFA est du temps de travail.
  - Règles d'après [service-public.fr](https://www.service-public.gouv.fr/particuliers/vosdroits/F2258), le [CIDJ](https://www.cidj.com/etudes-formations-alternance/alternance/contrat-d-apprentissage-droits-et-avantages-de-l-apprenti) et [Centre Inffo](https://www.centre-inffo.fr/helpie_faq/toggle-title-18). C'est l'employeur qui fixe les dates.
- **Répétition** chaque semaine sur les jours choisis, par exemple « Cours réseaux » tous les jeudis jusqu'en juin.
- **Rappels** la veille d'un examen, d'un rendu ou d'une réunion, via les notifications.
- **Réunions planifiées** : le jour J, un bouton « Rejoindre » ouvre la visio.
- **Dans ton agenda** : chacun a un lien personnel au format iCalendar ([RFC 5545](https://icalendar.org/iCalendar-RFC-5545/5-recommended-practices.html)) à ajouter dans Google Agenda ([aide Google](https://support.google.com/calendar/answer/37100)), iPhone ou Outlook. Il se met à jour tout seul. Le lien est secret et peut être régénéré.
- Les dates du **BTS 2027** sont préremplies pour la filière BTS.

## Formateurs et exercices

- Un modérateur génère un **code formateurs** (Modération → Codes d'invitation), ou bien il clique sur « Nommer formateur » sur un compte. Les formateurs n'ont pas de filière et leur compte n'est pas supprimé automatiquement.
- Comme demandé, **les salons, le forum, les réunions et la liste des élèves restent réservés aux élèves**. Les formateurs ont le planning, les exercices, les révisions, les actus et les infos.
- **Exercices** :
  - le formateur publie une consigne (Markdown), des fichiers, la filière visée et une **date limite**, qui s'ajoute automatiquement au planning ;
  - les élèves concernés sont notifiés ;
  - l'élève rend son travail (texte + fichiers), modifiable tant qu'il n'est pas corrigé, ou coche « fait » si le rendu n'est pas en ligne ;
  - le formateur voit qui a rendu (en retard ou non) et qui n'a pas rendu, puis met une **note et un commentaire** : l'élève est notifié ;
  - un rendu n'est visible que par son auteur et par les formateurs.

## Boîtes à idées

- Deux boîtes **séparées** : celle des **élèves** (visible par les élèves et les modérateurs, pas par les formateurs) et celle des **formateurs** (visible par les formateurs et les modérateurs).
- Chacun propose une idée (catégorie, explication, **anonyme** possible : seuls les modérateurs voient le nom), et vote ▲ pour celles des autres. Tri par popularité ou date.
- Les modérateurs voient les deux boîtes. Ils **répondent** et changent le statut (🆕 Nouvelle, 🔍 À l'étude, 📅 Prévue, ✅ Faite, ❌ Pas retenue), et l'auteur est notifié.

## Guide d'utilisation

Page ❓ **Guide** dans l'appli, avec un onglet par profil (Élève, Formateur, Modérateur) :
- ✅ ce qu'on **peut** faire, et comment ;
- 🚫 ce qu'on **ne peut pas** faire, et pourquoi ;
- recherche, raccourcis clavier et questions fréquentes.

Le contenu est dans `content/guide.json`, modifiable sans toucher au code.

## Espaces par filière

- Chaque filière a ses propres salons (`cap-general`, `bac-pro-general`, `bts-general`, `titre-pro-general`) et forums (`…-questions`). Ils ne sont **visibles que par les élèves de la filière** et par les modérateurs. Les autres salons restent communs à tout le CFA.
- Dans **Modération → Salons et forums**, un menu par salon permet de choisir qui le voit : tout le CFA, ou une seule filière. Même chose à la création.
- Le contrôle est fait **côté serveur** sur chaque action : lecture, écriture, fichiers, temps réel et notifications. Un élève ne peut pas lire un salon d'une autre filière, même en trafiquant l'adresse.

## Pièces jointes

- Bouton 📎, **glisser-déposer**, ou **coller une capture d'écran** (Ctrl+V) dans les salons, les sujets et les réponses. Jusqu'à 5 fichiers par message, 10 Mo chacun, 100 Mo par élève et par jour (réglable).
- Types acceptés : images (PNG, JPG, GIF, WebP), PDF, Word/Excel/PowerPoint, LibreOffice, Packet Tracer (`.pkt`, `.pka`), texte et configs (`.txt`, `.md`, `.csv`, `.log`, `.conf`, `.cfg`, `.ini`, `.json`, `.yml`, `.py`, `.sh`, `.ps1`).
- Sécurité, d'après l'[OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) :
  - liste blanche d'extensions et **vérification de la signature** du fichier (un `.exe` renommé en `.png` est refusé) ; SVG refusé (risque de script) ;
  - fichiers stockés **hors du dossier web** sous un nom aléatoire, avec des droits restreints (600) ;
  - téléchargement réservé aux personnes qui ont accès au salon ;
  - les documents sont toujours **téléchargés, jamais affichés** dans le navigateur (`Content-Disposition: attachment`, `nosniff`, CSP `sandbox`) ; nom de fichier encodé selon la [RFC 6266](https://httpwg.org/specs/rfc6266.html) ;
  - les **images sont décodées puis réencodées** avec [sharp](https://sharp.pixelplumbing.com/) : les métadonnées EXIF (position GPS, appareil, auteur) sont supprimées, conformément aux [conseils sur les données EXIF et la vie privée](https://ressources.forge.apps.education.fr/snt/Photo/a_telecharger/04/04.%20EXIF%20-%20PHOTOS%20NUMERIQUES.pdf) ;
  - quotas par élève, fichiers non publiés effacés au bout de 24 h, fichiers supprimés avec leur message ;
  - **antivirus ClamAV optionnel** (`docker compose --profile antivirus up -d` + `CLAMAV_HOST: "clamav"`). S'il est activé mais injoignable, l'envoi est refusé par prudence.

## Notifications

- **Mentions** : tape `@` dans un message, une liste des élèves s'affiche. La personne mentionnée est prévenue et le message est surligné pour elle.
- **Réponses** : l'auteur d'un sujet et les personnes qui y ont déjà répondu sont prévenus des nouvelles réponses.
- Page 🔔 **Notifications** : historique, compteur dans le menu et dans l'onglet du navigateur, alerte en direct. Chacun choisit ce qu'il veut recevoir.
- **Notifications sur le téléphone ou l'ordinateur**, même appli fermée, via la [Push API du W3C](https://developer.mozilla.org/docs/Web/API/Push_API) et la librairie [web-push](https://github.com/web-push-libs/web-push) (normes [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030), [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291) pour le chiffrement de bout en bout, [RFC 8292 / VAPID](https://www.rfc-editor.org/rfc/rfc8292)). Les clés VAPID sont générées automatiquement au premier démarrage (`data/vapid.json`). Renseigne `VAPID_SUBJECT` avec ton email.
  - La permission n'est **jamais demandée au chargement de la page**, seulement après un clic, comme le recommande [web.dev](https://web.dev/articles/push-notifications-permissions-ux). Le navigateur ne laisse refuser qu'une fois.
  - **iPhone / iPad** : il faut iOS 16.4 ou plus, puis ajouter le site à l'écran d'accueil (Partager → « Sur l'écran d'accueil ») et l'ouvrir de là ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). La plateforme est installable comme une appli (manifeste + icônes).
  - Le push n'est envoyé que si l'élève n'a aucun onglet ouvert (pas de doublon). Les abonnements expirés (codes 404/410) sont supprimés. Seuls les vrais services push des navigateurs sont acceptés comme destination, pour éviter qu'on se serve du serveur pour attaquer le réseau interne (SSRF).
  - HTTPS obligatoire, comme pour les réunions.

## Comptes élèves

- **Inscription avec Google (Gmail)** : l'élève entre le code de la classe, clique sur « Continuer avec Google », puis choisit son nom, **sa filière** et **son propre mot de passe**. Ensuite il se connecte avec Google **ou** avec son adresse Gmail + mot de passe.
- **Filières** : CAP, Bac pro, BTS (on demande l'année de l'examen) ou Titre professionnel (on demande le mois de fin).
- **Suppression automatique** : le compte est supprimé `ACCOUNT_GRACE_DAYS` jours (60 par défaut) après la fin de la formation. L'élève est prévenu 30 jours avant sur son tableau de bord, et peut mettre à jour sa filière s'il continue (CAP → Bac pro, redoublement…). Les comptes modérateurs ne sont jamais supprimés automatiquement.
- **Suppression = anonymisation** : identité, email, mot de passe et progression sont effacés ; les messages restent sous le nom « Ancien élève » pour ne pas casser les discussions.
- **Mot de passe oublié** : l'élève se connecte avec Google, ou un modérateur clique sur « Réinitialiser » (Modération → Comptes). Un mot de passe provisoire s'affiche une seule fois, et l'élève doit en choisir un nouveau à la connexion.
- Les modérateurs peuvent aussi changer la date de fin d'un compte, le rendre permanent, le suspendre ou le supprimer tout de suite. Chaque élève peut supprimer son compte depuis « Mon compte ».
- Les comptes créés avant cette version (sans filière) devront indiquer leur filière à la prochaine connexion. Un compte existant peut être lié à Google depuis « Mon compte ».

## Connexion avec Google

Il faut créer un identifiant OAuth (gratuit) :

1. Va sur [console.cloud.google.com](https://console.cloud.google.com/) → crée un projet (ex. « Classe SIO »).
2. **API et services → Écran de consentement OAuth** : type « Externe », nom de l'appli, ton email. Les scopes `openid`, `email` et `profile` suffisent (pas de validation Google nécessaire pour ceux-là). Passe l'appli « En production » pour que tous les élèves puissent se connecter.
3. **Identifiants → Créer des identifiants → ID client OAuth** → « Application Web ».
   - URI de redirection autorisé : `https://TON-DOMAINE/auth/google/callback`
4. Copie l'ID client et le code secret dans `docker-compose.yml` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), et mets `PUBLIC_URL: "https://TON-DOMAINE"`.
5. `docker compose --profile https up -d --build`

⚠️ Google exige un **vrai nom de domaine en HTTPS** pour la redirection (pas une simple IP ; `localhost` est accepté pour tester). Un sous-domaine gratuit (DuckDNS, etc.) fait l'affaire.

Quand Google est configuré, l'inscription sans Google est fermée aux élèves (pour que chaque compte corresponde à une vraie adresse Gmail). Pour la rouvrir : `ALLOW_LOCAL_SIGNUP=1`. Sans Google configuré, l'inscription se fait avec un identifiant + mot de passe + filière.

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
| `PUBLIC_URL` | adresse publique du site (pour la redirection Google) | déduite de la requête |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | active la connexion Google | vide |
| `ALLOW_LOCAL_SIGNUP` | `1` = autorise aussi l'inscription sans Google | `0` |
| `ACCOUNT_GRACE_DAYS` | jours entre la fin de formation et la suppression du compte | `60` |
| `UPLOAD_MAX_MB` / `UPLOAD_DAILY_MB` | taille max d'un fichier / quota par élève et par jour | `10` / `100` |
| `CLAMAV_HOST`, `CLAMAV_PORT` | antivirus ClamAV (clamd) pour les pièces jointes | vide / `3310` |
| `VAPID_SUBJECT` | contact de l'admin pour les notifications push (`mailto:…` ou `https://…`) | `PUBLIC_URL` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | clés push fixes (sinon générées dans `data/vapid.json`) | auto |
| `MEETING_MAX` | participants max par réunion | `10` |
| `APP_TZ` | fuseau horaire du planning | `America/Cayenne` |
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
accounts.js      comptes : Google, filières, réinitialisation, suppression automatique
uploads.js       pièces jointes sécurisées (OWASP)
notify.js        notifications + Web Push
public/sw.js     service worker (réception des notifications push)
calendar.js      planning : événements, alternance, congés/absences, rappels, iCalendar
exercises.js     exercices des formateurs, rendus et corrections
social.js        réactions, réponses, modification, « en train d'écrire »
game.js          XP, niveaux, séries, badges, défi du jour, duels, classement
ideas.js         boîtes à idées élèves / formateurs
content/guide.json  guide d'utilisation par rôle
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
