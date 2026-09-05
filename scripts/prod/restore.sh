#!/usr/bin/env bash
# Restore SQLite (and optional storage) from a backup directory.
#
# Usage:
#   ./scripts/prod/restore.sh <backup-dir> [--dry-run] [--with-files]
#
# Stop the Doma service before a real restore (launchctl/systemctl).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

DRY_RUN=0
WITH_FILES=0
BACKUP_DIR=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --with-files) WITH_FILES=1 ;;
    -h|--help)
      echo "Usage: $0 <backup-dir> [--dry-run] [--with-files]"
      exit 0
      ;;
    *)
      if [[ -z "$BACKUP_DIR" ]]; then
        BACKUP_DIR="$arg"
      else
        echo "error: unexpected arg: $arg" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$BACKUP_DIR" ]]; then
  echo "Usage: $0 <backup-dir> [--dry-run] [--with-files]" >&2
  exit 1
fi

if [[ "$BACKUP_DIR" != /* ]]; then
  BACKUP_DIR="$PWD/$BACKUP_DIR"
fi

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "error: backup dir not found: $BACKUP_DIR" >&2
  exit 1
fi

manifest="$BACKUP_DIR/MANIFEST.txt"
src_db="$BACKUP_DIR/doma.db"

if [[ ! -f "$manifest" ]]; then
  echo "error: missing MANIFEST.txt in $BACKUP_DIR" >&2
  exit 1
fi
if [[ ! -f "$src_db" ]]; then
  echo "error: missing doma.db in $BACKUP_DIR" >&2
  exit 1
fi

doma_load_env
db="$(doma_db_path)"
storage="$(doma_storage_root)"

echo "==> Restore from $BACKUP_DIR"
echo "    target db:      $db"
echo "    target storage: $storage"
echo "---- MANIFEST ----"
cat "$manifest"
echo "------------------"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "✓ Dry-run OK — would restore sqlite → $db"
  if [[ "$WITH_FILES" -eq 1 ]]; then
    if [[ -d "$BACKUP_DIR/storage" ]]; then
      echo "  would rsync $BACKUP_DIR/storage/ → $storage/"
    else
      echo "error: --with-files but no storage/ in backup" >&2
      exit 1
    fi
  fi
  echo
  echo "Next (real restore):"
  echo "  1. Stop service (launchctl/systemctl)"
  echo "  2. $0 $BACKUP_DIR [--with-files]"
  echo "  3. Start service"
  echo "  4. bun run prod:health"
  exit 0
fi

echo
echo "WARNING: This overwrites the live database at:"
echo "  $db"
echo "Stop Doma first so SQLite is idle (WAL must not be mid-write)."
read -r -p "Type RESTORE to continue: " confirm
if [[ "$confirm" != "RESTORE" ]]; then
  echo "Aborted."
  exit 1
fi

mkdir -p "$(dirname "$db")"
# Remove WAL/SHM so restored main db is authoritative
rm -f "${db}-wal" "${db}-shm"
cp "$src_db" "$db"

if [[ -f "$BACKUP_DIR/backup.env" ]]; then
  echo "==> backup.env present — compare secrets with live .env if paths/secrets changed"
  echo "    $BACKUP_DIR/backup.env"
fi

if [[ "$WITH_FILES" -eq 1 ]]; then
  if [[ ! -d "$BACKUP_DIR/storage" ]]; then
    echo "error: --with-files but no storage/ in backup" >&2
    exit 1
  fi
  doma_require_cmd rsync
  mkdir -p "$storage"
  rsync -a --delete "$BACKUP_DIR/storage/" "$storage/"
  echo "✓ Storage restored → $storage"
fi

echo "✓ Database restored → $db"
echo
echo "Checklist:"
echo "  1. Start Doma (launchctl load / systemctl start doma-cloud)"
echo "  2. bun run prod:health"
echo "  3. Log in as admin and open a known folder"
echo "  4. If schema was older than this checkout: bun run db:push (rare)"
