#!/bin/bash
# Package Doma Cloud into a distributable archive.
# Excludes: node_modules, .next, db files, storage-data, dev logs, .zscripts.

set -euo pipefail

PROJECT_DIR="/home/z/my-project"
OUTPUT_DIR="/home/z/my-project/download"
ARCHIVE_NAME="doma-cloud"
VERSION=$(date +%Y%m%d)
ARCHIVE="${OUTPUT_DIR}/${ARCHIVE_NAME}-${VERSION}.tar.gz"

mkdir -p "$OUTPUT_DIR"

echo "Packaging Doma Cloud → $ARCHIVE"

# Create the archive, excluding build/runtime artifacts.
# We keep: src/, prisma/, public/, mini-services/, scripts/,
#          config files, Docker files, README.
# We exclude: node_modules, .next, db/*.db*, storage-data,
#             .zscripts, dev.log, *.log, .git
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
  --exclude='bun.lock' \
  --exclude='mini-services/webdav/node_modules' \
  --exclude='mini-services/webdav/bun.lock' \
  src/ \
  prisma/ \
  public/ \
  mini-services/ \
  scripts/ \
  package.json \
  tsconfig.json \
  next.config.ts \
  tailwind.config.ts \
  postcss.config.mjs \
  components.json \
  eslint.config.mjs \
  Caddyfile \
  Caddyfile.prod \
  Dockerfile \
  docker-compose.yml \
  .env.example \
  README.md

# Show the result.
SIZE=$(du -h "$ARCHIVE" | cut -f1)
FILES=$(tar tzf "$ARCHIVE" | wc -l)
echo "✓ Archive created: $ARCHIVE"
echo "  Size: $SIZE"
echo "  Files: $FILES"
echo ""
echo "Contents (top-level):"
tar tzf "$ARCHIVE" | head -20
echo "..."
echo ""
echo "To extract:"
echo "  tar xzf ${ARCHIVE_NAME}-${VERSION}.tar.gz"
echo "  cd ${ARCHIVE_NAME}/  # (or wherever you extracted)"
echo "  cp .env.example .env  # edit secrets"
echo "  docker compose up -d --build"
