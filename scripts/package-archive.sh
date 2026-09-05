#!/bin/bash
# Package Doma Cloud into a distributable archive.
# Excludes: node_modules, .next, db files, storage-data, dev logs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${DOMA_ARCHIVE_OUTPUT:-"$PROJECT_DIR/../download"}"
ARCHIVE_NAME="doma-cloud"
VERSION=$(date +%Y%m%d)
ARCHIVE="${OUTPUT_DIR}/${ARCHIVE_NAME}-${VERSION}.tar.gz"

mkdir -p "$OUTPUT_DIR"

echo "Packaging Doma Cloud → $ARCHIVE"
echo "  Project: $PROJECT_DIR"
echo "  Output:  $OUTPUT_DIR"

cd "$PROJECT_DIR"

tar czf "$ARCHIVE" \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='db/*.db' \
  --exclude='db/*.db-shm' \
  --exclude='db/*.db-wal' \
  --exclude='storage-data' \
  --exclude='.zscripts' \
  --exclude='dev.log' \
  --exclude='server.log' \
  --exclude='*.log' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='patch' \
  src/ \
  prisma/ \
  public/ \
  scripts/ \
  package.json \
  bun.lock \
  tsconfig.json \
  next.config.ts \
  postcss.config.mjs \
  components.json \
  eslint.config.mjs \
  Caddyfile \
  deploy/ \
  .env.example \
  README.md

SIZE=$(du -h "$ARCHIVE" | cut -f1)
FILES=$(tar tzf "$ARCHIVE" | wc -l)
echo "✓ Archive created: $ARCHIVE"
echo "  Size: $SIZE"
echo "  Files: $FILES"
echo ""
echo "To extract and run:"
echo "  tar xzf ${ARCHIVE_NAME}-${VERSION}.tar.gz"
echo "  cp .env.example .env   # edit secrets"
echo "  bun install && bun run db:push && bun run build && bun run start"
