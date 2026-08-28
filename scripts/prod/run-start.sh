#!/usr/bin/env bash
# Start Doma in production with .env loaded (for launchd/systemd).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

cd "$DOMA_ROOT"
doma_load_env

export NODE_ENV=production
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

if [[ ! -f "$DOMA_ROOT/.next/standalone/server.js" ]]; then
  echo "error: missing .next/standalone/server.js — run: bun run build" >&2
  exit 1
fi

exec bun "$DOMA_ROOT/.next/standalone/server.js"
