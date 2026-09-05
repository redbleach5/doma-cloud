#!/usr/bin/env bash
# Run all cleanup cron endpoints (trash, uploads, share).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

doma_load_env

if [[ -z "${CRON_SECRET:-}" || "$CRON_SECRET" == "replace-me-with-a-random-cron-secret" ]]; then
  echo "error: set a real CRON_SECRET in .env" >&2
  exit 1
fi

base="$(doma_base_url)"
failed=0

for path in trash-cleanup uploads-cleanup share-cleanup; do
  echo "==> POST /api/cron/$path"
  if curl -fsS -X POST "$base/api/cron/$path" \
      -H "X-Cron-Secret: $CRON_SECRET" \
      --max-time 120; then
    echo
  else
    echo "error: cron $path failed" >&2
    failed=1
  fi
done

exit "$failed"
