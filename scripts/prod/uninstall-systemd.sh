#!/usr/bin/env bash
# Uninstall Doma systemd units.
set -euo pipefail

if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "error: Linux only" >&2
  exit 1
fi

UNITS=(
  doma-cloud.service
  doma-cloud-backup.service
  doma-cloud-backup.timer
  doma-cloud-cron.service
  doma-cloud-cron.timer
)

USE_USER=1
if [[ "${1:-}" == "--system" ]]; then
  USE_USER=0
elif [[ "${1:-}" == "--user" ]]; then
  USE_USER=1
elif [[ -f /etc/systemd/system/doma-cloud.service ]]; then
  USE_USER=0
fi

if [[ "$USE_USER" -eq 1 ]]; then
  for u in "${UNITS[@]}"; do
    systemctl --user disable --now "$u" 2>/dev/null || true
    rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$u"
  done
  systemctl --user daemon-reload
  echo "✓ user units removed"
else
  for u in "${UNITS[@]}"; do
    sudo systemctl disable --now "$u" 2>/dev/null || true
    sudo rm -f "/etc/systemd/system/$u"
  done
  sudo systemctl daemon-reload
  echo "✓ system units removed"
fi
