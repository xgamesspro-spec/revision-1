#!/usr/bin/env bash
# Installe la mise à jour automatique de Classe CEVEDOM sur la VM (à lancer UNE fois) :
#   sudo bash scripts/install-auto-update.sh               → chaque nuit à 3 h 30
#   sudo bash scripts/install-auto-update.sh --heure 04:15 → autre heure
#   sudo bash scripts/install-auto-update.sh --profils "https turn"   (profils docker compose utilisés)
#   sudo bash scripts/install-auto-update.sh --desinstaller
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="classe-cevedom-update"
HEURE="03:30"
PROFILS=""
PROFILS_SET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --heure) HEURE="$2"; shift 2 ;;
    --profils) PROFILS="$2"; PROFILS_SET=1; shift 2 ;;
    --desinstaller)
      systemctl disable --now "$NAME.timer" 2>/dev/null || true
      rm -f "/etc/systemd/system/$NAME.service" "/etc/systemd/system/$NAME.timer" "/etc/cron.d/$NAME"
      systemctl daemon-reload 2>/dev/null || true
      echo "✅ Mise à jour automatique désinstallée."; exit 0 ;;
    *) echo "Option inconnue : $1"; exit 1 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "Lance-moi avec sudo : sudo bash scripts/install-auto-update.sh"; exit 1; }
[[ "$HEURE" =~ ^[0-2][0-9]:[0-5][0-9]$ ]] || { echo "Heure invalide (format HH:MM)"; exit 1; }
for c in git docker curl flock; do command -v "$c" >/dev/null || { echo "Il manque la commande « $c » sur la VM."; exit 1; }; done
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || { echo "$REPO n'est pas un dépôt git (clone-le avec git clone)."; exit 1; }
OWNER="$(stat -c %U "$REPO")"

# Profils docker compose : on reprend ceux qui tournent déjà (https, turn, antivirus…)
if [ "$PROFILS_SET" = 0 ]; then
  RUNNING="$(docker ps --format '{{.Image}} {{.Names}}' 2>/dev/null || true)"
  echo "$RUNNING" | grep -q caddy && PROFILS="$PROFILS https"
  echo "$RUNNING" | grep -q coturn && PROFILS="$PROFILS turn"
  echo "$RUNNING" | grep -q clamav && PROFILS="$PROFILS antivirus"
  PROFILS="$(echo "$PROFILS" | xargs)"
fi

cat > "$REPO/.auto-update.conf" <<EOF
# Réglages de la mise à jour automatique (non publié sur GitHub)
BRANCH=main
COMPOSE_PROFILES="$(echo "$PROFILS" | tr ' ' ',')"
HEALTH_URL=http://127.0.0.1:3000/api/health
REPO_USER=$OWNER
EOF
chown "$OWNER" "$REPO/.auto-update.conf"
chmod +x "$REPO/scripts/auto-update.sh"

if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then
  cat > "/etc/systemd/system/$NAME.service" <<EOF
[Unit]
Description=Mise à jour automatique de Classe CEVEDOM depuis GitHub
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
WorkingDirectory=$REPO
ExecStart=/usr/bin/env bash $REPO/scripts/auto-update.sh
TimeoutStartSec=1800
EOF
  cat > "/etc/systemd/system/$NAME.timer" <<EOF
[Unit]
Description=Chaque nuit : mise à jour de Classe CEVEDOM

[Timer]
OnCalendar=*-*-* $HEURE:00
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$NAME.timer" >/dev/null
  PLANIF="minuteur systemd ($NAME.timer)"
else
  H="${HEURE%%:*}"; M="${HEURE##*:}"
  echo "$((10#$M)) $((10#$H)) * * * root /usr/bin/env bash $REPO/scripts/auto-update.sh >/dev/null 2>&1" > "/etc/cron.d/$NAME"
  PLANIF="tâche cron (/etc/cron.d/$NAME)"
fi

echo "✅ Mise à jour automatique installée : chaque nuit vers $HEURE ($PLANIF)."
echo "   Profils docker compose : ${PROFILS:-aucun}"
echo "   Premier passage maintenant…"
bash "$REPO/scripts/auto-update.sh" || true
echo
echo "👉 Le résultat s'affiche sur le site : 🛠️ Maintenance (modérateurs). Tu es aussi prévenu par notification."
echo "   Lancer une mise à jour à la main : sudo bash $REPO/scripts/auto-update.sh"
echo "   Voir le prochain passage : systemctl list-timers $NAME.timer"
