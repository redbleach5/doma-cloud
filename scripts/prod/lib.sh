#!/usr/bin/env bash
# Shared helpers for scripts/prod/*.sh
# shellcheck disable=SC2034

set -euo pipefail

PROD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMA_ROOT="$(cd "$PROD_DIR/../.." && pwd)"

doma_load_env() {
  local env_file="${DOMA_ENV_FILE:-$DOMA_ROOT/.env}"
  if [[ ! -f "$env_file" ]]; then
    echo "error: env file not found: $env_file" >&2
    echo "  Copy .env.example → .env and set secrets first." >&2
    return 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
  DOMA_ENV_FILE="$env_file"
}

doma_db_path() {
  local url="${DATABASE_URL:-file:./doma.db}"
  local path="${url#file:}"
  # Relative to project root when not absolute
  if [[ "$path" != /* ]]; then
    path="$DOMA_ROOT/${path#./}"
  fi
  printf '%s' "$path"
}

doma_storage_root() {
  local root="${STORAGE_LOCAL_ROOT:-./storage-data}"
  if [[ "$root" != /* ]]; then
    root="$DOMA_ROOT/${root#./}"
  fi
  printf '%s' "$root"
}

doma_base_url() {
  local port="${PORT:-3000}"
  local host="${DOMA_HEALTH_HOST:-127.0.0.1}"
  printf 'http://%s:%s' "$host" "$port"
}

doma_backup_root() {
  local dir="${DOMA_BACKUP_DIR:-$DOMA_ROOT/../doma-backups}"
  if [[ "$dir" != /* ]]; then
    dir="$DOMA_ROOT/${dir#./}"
  fi
  mkdir -p "$dir"
  printf '%s' "$(cd "$dir" && pwd)"
}

doma_require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: required command not found: $cmd" >&2
    return 1
  fi
}
