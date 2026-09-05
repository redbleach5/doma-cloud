#!/usr/bin/env bash
# Install Doma launchd agents (app + daily backup + cleanup cron).
# macOS only. Run from a login user that should own the service.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: launchd install is for macOS. Use install-systemd.sh on Linux." >&2
  exit 1
fi

doma_require_cmd bun
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
AGENTS_DIR="$HOME_DIR/Library/LaunchAgents"
mkdir -p "$AGENTS_DIR"

render() {
  local src="$1"
  local dst="$2"
  sed \
    -e "s|__DOMA_ROOT__|$DOMA_ROOT|g" \
    -e "s|__BUN_DIR__|$BUN_DIR|g" \
    -e "s|__HOME__|$HOME_DIR|g" \
    "$src" > "$dst"
}

LABELS=(com.doma.cloud com.doma.cloud.backup com.doma.cloud.cron)

for label in "${LABELS[@]}"; do
  src="$DOMA_ROOT/deploy/launchd/${label}.plist"
  dst="$AGENTS_DIR/${label}.plist"
  if [[ ! -f "$src" ]]; then
    echo "error: missing template $src" >&2
    exit 1
  fi
  # Unload if already loaded
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || \
    launchctl unload "$dst" 2>/dev/null || true
  render "$src" "$dst"
  launchctl bootstrap "gui/$(id -u)" "$dst" 2>/dev/null || launchctl load "$dst"
  echo "✓ loaded $label → $dst"
done

chmod +x "$DOMA_ROOT"/scripts/prod/*.sh

echo
echo "Doma launchd installed."
echo "  App:    launchctl print gui/$(id -u)/com.doma.cloud"
echo "  Health: bun run prod:health"
echo "  Logs:   $DOMA_ROOT/server.log"
echo "  Uninstall: bun run prod:uninstall-launchd  (or scripts/prod/uninstall-launchd.sh)"
