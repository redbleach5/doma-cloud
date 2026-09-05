#!/usr/bin/env bash
# Consistent SQLite backup (+ optional storage rsync) with retention.
#
# Usage:
#   ./scripts/prod/backup.sh [--with-files]
#
# Env:
#   DOMA_BACKUP_DIR   default: <repo>/../doma-backups
#   DOMA_BACKUP_KEEP  default: 7
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

WITH_FILES=0
for arg in "$@"; do
  case "$arg" in
    --with-files) WITH_FILES=1 ;;
    -h|--help)
      echo "Usage: $0 [--with-files]"
      exit 0
      ;;
    *)
      echo "error: unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

doma_load_env
doma_require_cmd sqlite3

db="$(doma_db_path)"
storage="$(doma_storage_root)"
backup_root="$(doma_backup_root)"
keep="${DOMA_BACKUP_KEEP:-7}"
stamp="$(date +%Y%m%d-%H%M%S)-$$"
out="$backup_root/backup-$stamp"

if [[ ! -f "$db" ]]; then
  echo "error: database not found: $db" >&2
  exit 1
fi

mkdir -p "$out"

echo "==> Backup → $out"
echo "    db:      $db"
echo "    storage: $storage"

# Online-consistent copy (no service stop required).
sqlite3 "$db" ".backup '$out/doma.db'"

cp "$DOMA_ENV_FILE" "$out/backup.env"

sha=""
if command -v shasum >/dev/null 2>&1; then
  sha="$(shasum -a 256 "$out/doma.db" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  sha="$(sha256sum "$out/doma.db" | awk '{print $1}')"
fi

storage_du="missing"
if [[ -d "$storage" ]]; then
  storage_du="$(du -sh "$storage" 2>/dev/null | awk '{print $1}')"
fi

if [[ "$WITH_FILES" -eq 1 ]]; then
  doma_require_cmd rsync
  if [[ ! -d "$storage" ]]; then
    echo "error: storage root missing: $storage" >&2
    exit 1
  fi
  echo "==> rsync storage (--with-files)"
  mkdir -p "$out/storage"
  rsync -a --delete "$storage/" "$out/storage/"
fi

{
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "hostname=$(hostname 2>/dev/null || echo unknown)"
  echo "doma_root=$DOMA_ROOT"
  echo "database_url=${DATABASE_URL:-}"
  echo "database_path=$db"
  echo "storage_local_root=$storage"
  echo "storage_du=$storage_du"
  echo "sqlite_sha256=$sha"
  echo "with_files=$WITH_FILES"
  echo "keep=$keep"
} > "$out/MANIFEST.txt"

# Retention: keep newest N backup-* dirs
kept=0
while IFS= read -r d; do
  [[ -z "$d" ]] && continue
  kept=$((kept + 1))
  if [[ "$kept" -gt "$keep" ]]; then
    echo "==> Retention: removing $d (keep=$keep)"
    rm -rf "$d"
  fi
done < <(ls -1d "$backup_root"/backup-* 2>/dev/null | sort -r)

echo "✓ Backup complete: $out"
echo "  Manifest: $out/MANIFEST.txt"
if [[ "$WITH_FILES" -eq 0 ]]; then
  echo "  Note: files not included. Back up $storage separately, or re-run with --with-files."
fi
