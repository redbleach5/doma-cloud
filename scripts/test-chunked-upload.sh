#!/usr/bin/env bash
# Test chunked upload with a 200MB file.
# Simulates what the browser does: split file into 5MB chunks, POST each one.

set -euo pipefail

FILE="/tmp/bigger.bin"
SIZE=$(stat -c%s "$FILE")
CHUNK_SIZE=$((5 * 1024 * 1024))
TOTAL_CHUNKS=$(( (SIZE + CHUNK_SIZE - 1) / CHUNK_SIZE ))
UPLOAD_ID="test-$(date +%s)"

echo "File: $FILE"
echo "Size: $SIZE bytes ($((SIZE / 1024 / 1024)) MB)"
echo "Chunks: $TOTAL_CHUNKS"
echo "Upload ID: $UPLOAD_ID"
echo "---"

for ((i=0; i<TOTAL_CHUNKS; i++)); do
  START=$((i * CHUNK_SIZE))
  END=$((START + CHUNK_SIZE))
  if [ $END -gt $SIZE ]; then END=$SIZE; fi
  CHUNK_FILE="/tmp/chunk-$i.bin"
  dd if="$FILE" of="$CHUNK_FILE" bs=1 skip=$START count=$((END - START)) 2>/dev/null

  RESPONSE=$(curl -s --max-time 60 -b /tmp/cookies.txt \
    -X POST "http://localhost:3000/api/files/upload-chunk" \
    -H "Content-Type: application/octet-stream" \
    -H "X-Upload-Id: $UPLOAD_ID" \
    -H "X-File-Name: bigger.bin" \
    -H "X-File-Size: $SIZE" \
    -H "X-File-Mime: application/octet-stream" \
    -H "X-Chunk-Index: $i" \
    -H "X-Chunk-Total: $TOTAL_CHUNKS" \
    --data-binary "@$CHUNK_FILE" 2>&1)

  echo "Chunk $((i+1))/$TOTAL_CHUNKS: $RESPONSE" | head -c 200
  echo ""
  rm -f "$CHUNK_FILE"

  # Print memory every 10 chunks
  if (( i % 10 == 0 )); then
    RSS=$(ps -o rss= -p $(pgrep -f "next-server" | head -1) 2>/dev/null | awk '{printf "%.0f", $1/1024}')
    echo "  → Server RSS: ${RSS} MB"
  fi
done

echo "---"
echo "Final server RSS:"
ps -o rss= -p $(pgrep -f "next-server" | head -1) 2>/dev/null | awk '{printf "%.0f MB\n", $1/1024}'
echo "Server still alive?"
ps aux | grep next | grep -v grep | head -2
