#!/usr/bin/env bash
# Uninstall Doma launchd agents.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: macOS only" >&2
  exit 1
fi

AGENTS_DIR="${HOME}/Library/LaunchAgents"
LABELS=(com.doma.cloud com.doma.cloud.backup com.doma.cloud.cron)

for label in "${LABELS[@]}"; do
  dst="$AGENTS_DIR/${label}.plist"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || \
    launchctl unload "$dst" 2>/dev/null || true
  rm -f "$dst"
  echo "✓ removed $label"
done

echo "Done. Process may take a moment to exit; check: pgrep -fl standalone/server"
