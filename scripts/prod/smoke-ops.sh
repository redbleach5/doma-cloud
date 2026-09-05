#!/usr/bin/env bash
# Smoke: backup + restore --dry-run against a temp sqlite + .env (no live service).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

doma_require_cmd sqlite3

tmp="$(mktemp -d "${TMPDIR:-/tmp}/doma-ops-XXXXXX")"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

db="$tmp/doma.db"
storage="$tmp/storage"
backups="$tmp/backups"
env_file="$tmp/.env"

mkdir -p "$storage" "$backups"
echo "hello" > "$storage/marker.txt"

sqlite3 "$db" <<'SQL'
CREATE TABLE Setting (key TEXT PRIMARY KEY, value TEXT, updatedAt TEXT);
INSERT INTO Setting VALUES ('smoke','1', datetime('now'));
SQL

cat > "$env_file" <<EOF
DOMA_JWT_SECRET=smoke-test-secret-at-least-32-chars-long
CRON_SECRET=smoke-cron-secret-hex-hex-hex-hex
DATABASE_URL=file:$db
STORAGE_LOCAL_ROOT=$storage
PORT=3000
EOF

export DOMA_ENV_FILE="$env_file"
export DOMA_BACKUP_DIR="$backups"
export DOMA_BACKUP_KEEP=3

echo "==> smoke backup"
"$SCRIPT_DIR/backup.sh"

latest="$(ls -1d "$backups"/backup-* | sort | tail -1)"
[[ -f "$latest/doma.db" ]]
[[ -f "$latest/MANIFEST.txt" ]]
[[ -f "$latest/backup.env" ]]

echo "==> smoke restore --dry-run"
"$SCRIPT_DIR/restore.sh" "$latest" --dry-run

echo "==> smoke backup --with-files"
"$SCRIPT_DIR/backup.sh" --with-files
latest2="$(ls -1d "$backups"/backup-* | sort | tail -1)"
[[ -d "$latest2/storage" ]]
[[ -f "$latest2/storage/marker.txt" ]]

echo "✓ smoke-ops OK ($tmp cleaned on exit)"
