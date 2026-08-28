#!/usr/bin/env bash
# GET /api/health — exit 0 on ok, 1 otherwise.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

doma_load_env
url="$(doma_base_url)/api/health"

code="$(curl -fsS -o /tmp/doma-health-$$.json -w '%{http_code}' --max-time 5 "$url" || true)"
body="$(cat /tmp/doma-health-$$.json 2>/dev/null || true)"
rm -f /tmp/doma-health-$$.json

if [[ "$code" == "200" ]]; then
  echo "ok $body"
  exit 0
fi

echo "fail http=$code body=$body" >&2
exit 1
