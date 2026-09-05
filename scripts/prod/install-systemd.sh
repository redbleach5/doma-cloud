#!/usr/bin/env bash
# Install Doma systemd unit + backup/cron timers (Linux).
# Prefers user systemd when no sudo; uses system units with sudo otherwise.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "error: systemd install is for Linux. Use install-launchd.sh on macOS." >&2
  exit 1
fi

doma_require_cmd bun
doma_require_cmd systemctl

if [[ ! -f "$DOMA_ROOT/.env" ]]; then
  echo "error: $DOMA_ROOT/.env missing — copy .env.example and set secrets" >&2
  exit 1
fi
if [[ ! -f "$DOMA_ROOT/.next/standalone/server.js" ]]; then
  echo "error: build missing — run: bun run build" >&2
  exit 1
fi

BUN_BIN="$(command -v bun)"
BUN_DIR="$(dirname "$BUN_BIN")"
HOME_DIR="${HOME}"
USER_NAME="$(id -un)"
GROUP_NAME="$(id -gn)"

USE_USER=0
if [[ "${1:-}" == "--user" ]] || ! command -v sudo >/dev/null 2>&1; then
  USE_USER=1
elif [[ "$(id -u)" -eq 0 ]]; then
  USE_USER=0
else
  # Default: system units if we can sudo, else user
  if sudo -n true 2>/dev/null; then
    USE_USER=0
  else
    echo "Installing as user units (pass --system with sudo for system-wide)."
    USE_USER=1
  fi
fi

if [[ "${1:-}" == "--system" ]]; then
  USE_USER=0
fi

render() {
  local src="$1"
  local dst="$2"
  sed \
    -e "s|__DOMA_ROOT__|$DOMA_ROOT|g" \
    -e "s|__BUN_DIR__|$BUN_DIR|g" \
    -e "s|__HOME__|$HOME_DIR|g" \
    -e "s|__USER__|$USER_NAME|g" \
    -e "s|__GROUP__|$GROUP_NAME|g" \
    "$src" > "$dst"
}

UNITS=(
  doma-cloud.service
  doma-cloud-backup.service
  doma-cloud-backup.timer
  doma-cloud-cron.service
  doma-cloud-cron.timer
)

chmod +x "$DOMA_ROOT"/scripts/prod/*.sh

if [[ "$USE_USER" -eq 1 ]]; then
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  mkdir -p "$UNIT_DIR"
  for u in "${UNITS[@]}"; do
    render "$DOMA_ROOT/deploy/systemd/$u" "$UNIT_DIR/$u"
  done
  systemctl --user daemon-reload
  systemctl --user enable --now doma-cloud.service
  systemctl --user enable --now doma-cloud-backup.timer
  systemctl --user enable --now doma-cloud-cron.timer
  echo "✓ user systemd units enabled"
  echo "  Status: systemctl --user status doma-cloud"
  echo "  Linger (survive logout): sudo loginctl enable-linger $USER_NAME"
else
  for u in "${UNITS[@]}"; do
    tmp="$(mktemp)"
    render "$DOMA_ROOT/deploy/systemd/$u" "$tmp"
    sudo cp "$tmp" "/etc/systemd/system/$u"
    rm -f "$tmp"
  done
  sudo systemctl daemon-reload
  sudo systemctl enable --now doma-cloud.service
  sudo systemctl enable --now doma-cloud-backup.timer
  sudo systemctl enable --now doma-cloud-cron.timer
  echo "✓ system systemd units enabled"
  echo "  Status: systemctl status doma-cloud"
fi

echo "  Health: bun run prod:health"
echo "  Uninstall: scripts/prod/uninstall-systemd.sh [--user|--system]"
