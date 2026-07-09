#!/usr/bin/env bash
# Run each test file in a separate Bun process for full isolation.
#
# Why: Bun runs test files in parallel within a single process by default.
# This means test files share:
#   - The PrismaClient instance (and thus the DB connection)
#   - The in-memory rate-limit buckets
#   - The mock cookie store
#   - The cached storage backend
#
# When one file's beforeEach resets the DB / cookies / rate-limiter, it
# wipes state that another file is mid-test using → flaky failures.
#
# Running each file in its own process eliminates ALL cross-file
# interference. The tradeoff is slower startup (one Bun process per file),
# but for a few hundred tests this adds <5 seconds total.

set -euo pipefail

# Directory to scan for test files. Default to tests/, override with $1.
TEST_DIR="${1:-tests}"

# Find all .test.ts and .test.tsx files under the target directory.
# Portable: avoid `mapfile` (requires bash 4+, macOS ships bash 3.2).
FILES=()
while IFS= read -r f; do
  FILES+=("$f")
done < <(find "$TEST_DIR" \( -name "*.test.ts" -o -name "*.test.tsx" \) -type f | sort)

if [ ${#FILES[@]} -eq 0 ]; then
  echo "No test files found under $TEST_DIR"
  exit 1
fi

PASS=0
FAIL=0
FAILED_FILES=()

for f in "${FILES[@]}"; do
  # Run each file in its own process. --max-concurrency 1 keeps tests
  # within the file serial too (avoids beforeEach overlap).
  if bun test --max-concurrency 1 "$f" > /tmp/test-output.$$ 2>&1; then
    # Extract the pass/fail summary line (format: " 36 pass\n 0 fail").
    PASS_LINE=$(grep -E "^\s*[0-9]+ pass" /tmp/test-output.$$ | tail -1 | xargs)
    FAIL_LINE=$(grep -E "^\s*[0-9]+ fail" /tmp/test-output.$$ | tail -1 | xargs)
    echo "  PASS  $f  ($PASS_LINE, $FAIL_LINE)"
    PASS=$((PASS + 1))
  else
    PASS_LINE=$(grep -E "^\s*[0-9]+ pass" /tmp/test-output.$$ | tail -1 | xargs)
    FAIL_LINE=$(grep -E "^\s*[0-9]+ fail" /tmp/test-output.$$ | tail -1 | xargs)
    echo "  FAIL  $f  ($PASS_LINE, $FAIL_LINE)"
    # Print the last 25 lines of output for debugging.
    tail -25 /tmp/test-output.$$
    FAIL=$((FAIL + 1))
    FAILED_FILES+=("$f")
  fi
done

rm -f /tmp/test-output.$$

echo ""
echo "============================================="
echo "Files: ${#FILES[@]} total, $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo ""
  echo "Failed files:"
  for f in "${FAILED_FILES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
echo "All test files passed."
