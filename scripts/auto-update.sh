#!/usr/bin/env bash
# Mise à jour automatique de Classe CEVEDOM (lancée chaque nuit par le minuteur systemd ou cron).
# 1. regarde s'il y a une nouvelle version sur GitHub ;
# 2. la récupère en gardant tes réglages locaux (docker-compose.yml…) ;
# 3. reconstruit et relance le conteneur ;
# 4. vérifie que le site répond ; sinon remet l'ancienne version ;
# 5. écrit le résultat dans data/update-status.json : le site l'affiche dans 🛠️ Maintenance et prévient les modérateurs.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1
CONF="$REPO/.auto-update.conf"
[ -f "$CONF" ] && . "$CONF"
BRANCH="${BRANCH:-main}"
COMPOSE_PROFILES="${COMPOSE_PROFILES:-}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
REPO_USER="${REPO_USER:-$(stat -c %U "$REPO")}"
export COMPOSE_PROFILES

DATA="$REPO/data"
mkdir -p "$DATA"
STATUS="$DATA/update-status.json"
HISTORY="$DATA/update-history.jsonl"
LOG="$DATA/update.log"
LOCK="$DATA/.update.lock"
START="$(date -Iseconds)"
LINES=()

log() { local l="[$(date '+%F %T')] $*"; echo "$l"; echo "$l" >> "$LOG"; LINES+=("$l"); }
# git est lancé avec le propriétaire du dossier (sinon les fichiers de .git deviendraient à root)
g() { if [ "$(id -un)" = "$REPO_USER" ]; then git "$@"; else sudo -u "$REPO_USER" -H git "$@"; fi; }
dc() { if docker compose version >/dev/null 2>&1; then docker compose "$@"; else docker-compose "$@"; fi; }

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1" 2>/dev/null || printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }
write_status() { # résultat, message, conseil
  local result="$1" message="$2" conseil="${3:-}" commits_json="[]" log_json="[]"
  if [ -n "${COMMITS:-}" ]; then commits_json="[$(while IFS= read -r c; do printf '%s,' "$(json_str "$c")"; done <<< "$COMMITS" | sed 's/,$//')]"; fi
  if [ "${#LINES[@]}" -gt 0 ]; then log_json="[$(for l in "${LINES[@]: -60}"; do printf '%s,' "$(json_str "$l")"; done | sed 's/,$//')]"; fi
  local j="{\"at\":$(json_str "$(date -Iseconds)"),\"started\":$(json_str "$START"),\"result\":$(json_str "$result"),\"message\":$(json_str "$message"),\"conseil\":$(json_str "$conseil"),\"from\":$(json_str "${OLD:-}"),\"to\":$(json_str "${NEW:-}"),\"commits\":$commits_json,\"log\":$log_json}"
  printf '%s\n' "$j" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS" && chmod 644 "$STATUS"
  # Historique (30 derniers passages), sans le journal complet
  printf '{"at":%s,"result":%s,"message":%s,"from":%s,"to":%s}\n' "$(json_str "$(date -Iseconds)")" "$(json_str "$result")" "$(json_str "$message")" "$(json_str "${OLD:-}")" "$(json_str "${NEW:-}")" >> "$HISTORY"
  tail -n 30 "$HISTORY" > "$HISTORY.tmp" && mv "$HISTORY.tmp" "$HISTORY" && chmod 644 "$HISTORY"
  tail -n 2000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
}
fail() { log "ÉCHEC : $1"; write_status "${3:-erreur}" "$1" "${2:-}"; exit 1; }

healthy() { # attend jusqu'à 120 s que le site réponde
  for _ in $(seq 1 40); do
    if curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null | grep -q '"ok":true'; then return 0; fi
    sleep 3
  done
  return 1
}
build_up() { g rev-parse --short HEAD > "$DATA/version.txt"; chmod 644 "$DATA/version.txt"; dc up -d --build >> "$LOG" 2>&1; }

# Un seul passage à la fois
exec 9>"$LOCK"
flock -n 9 || { echo "Une mise à jour est déjà en cours"; exit 0; }

log "Vérification des mises à jour (branche $BRANCH)…"
g fetch -q origin "$BRANCH" 2>>"$LOG" || fail "Impossible de joindre GitHub" "Vérifie la connexion Internet de la VM (ou les identifiants si le dépôt est privé)."
OLD="$(g rev-parse --short HEAD)"
REMOTE="$(g rev-parse --short "origin/$BRANCH")"

if [ "$OLD" = "$REMOTE" ]; then
  # Rien de neuf : on vérifie juste que le site tourne (et on le relance s'il est tombé)
  if healthy; then log "Déjà à jour ($OLD)"; NEW="$OLD"; write_status "a_jour" "Déjà à jour"; exit 0; fi
  log "Le site ne répond pas : relance du conteneur"
  build_up
  healthy && { NEW="$OLD"; write_status "ok" "Le site ne répondait plus : il a été relancé"; exit 0; }
  fail "Le site ne répond pas, même après relance" "Regarde « docker compose logs classe » sur la VM."
fi

COMMITS="$(g log --format='%s' "HEAD..origin/$BRANCH" | head -n 20)"
log "Nouvelle version disponible : $OLD → $REMOTE"

# Tes modifications locales (mots de passe, domaine dans docker-compose.yml…) sont mises de côté puis remises
STASHED=0
if [ -n "$(g status --porcelain --untracked-files=no)" ]; then
  g stash push -q -m "auto-update $START" >>"$LOG" 2>&1 && STASHED=1 && log "Réglages locaux mis de côté"
fi
if ! g merge -q --ff-only "origin/$BRANCH" >>"$LOG" 2>&1; then
  [ "$STASHED" = 1 ] && g stash pop -q >>"$LOG" 2>&1
  fail "Impossible d'appliquer la nouvelle version (historique différent)" "Sur la VM : cd $REPO && git status. Si tu as fait des commits sur la VM, pousse-les ou annule-les."
fi
if [ "$STASHED" = 1 ] && ! g stash pop -q >>"$LOG" 2>&1; then
  # Conflit entre tes réglages et la nouvelle version : on revient en arrière proprement
  g reset -q --hard "$OLD" 2>>"$LOG"; g stash pop -q >>"$LOG" 2>&1; NEW="$OLD"
  fail "Tes réglages locaux entrent en conflit avec la nouvelle version" "Mets tes réglages (mots de passe, domaine…) dans docker-compose.override.yml (voir README), puis relance : sudo bash scripts/auto-update.sh" "rollback"
fi
NEW="$(g rev-parse --short HEAD)"

log "Reconstruction et redémarrage…"
if build_up && healthy; then
  docker image prune -f >/dev/null 2>&1
  log "Mise à jour réussie : $OLD → $NEW"
  write_status "ok" "Mise à jour installée"
  exit 0
fi

# Ça ne démarre pas : retour à l'ancienne version
log "La nouvelle version ne répond pas : retour à $OLD"
[ -n "$(g status --porcelain --untracked-files=no)" ] && g stash push -q -m "auto-rollback $START" >>"$LOG" 2>&1 && RB=1 || RB=0
g reset -q --hard "$OLD"
[ "$RB" = 1 ] && g stash pop -q >>"$LOG" 2>&1
NEW="$OLD"
if build_up && healthy; then
  fail "La nouvelle version ne démarrait pas : l'ancienne a été remise en ligne" "Le détail est dans le journal ci-dessous. La mise à jour sera retentée la nuit prochaine." "rollback"
fi
fail "Le site ne redémarre pas, même avec l'ancienne version" "Sur la VM : cd $REPO && docker compose logs --tail 100 classe"
