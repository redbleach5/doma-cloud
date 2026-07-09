# Doma Cloud — Test Suite Patch

This patch adds a comprehensive test suite to the doma-cloud project.
It was generated against commit `HEAD` of `https://github.com/redbleach5/doma-cloud.git`.

## Patch Stats

- **25 test files**, **426 tests**, all passing
- ~5000 lines of test code
- 0 production-code regressions (3 minimal test-only helpers added to src/)
- 6 real bugs/quirks documented as regression guards

## What's Covered

| Layer | Files | Tests |
|-------|-------|-------|
| Unit (pure functions) | 10 | 139 |
| Integration (DB + storage) | 3 | 59 |
| API routes | 6 | 188 |
| React components | 4 | 48 |
| React hooks | 2 | 15 |
| Helpers + infrastructure | 5 | — |
| **Total** | **25 + 5** | **426** |

## Applying the Patch

```bash
# 1. From the root of your doma-cloud checkout:
git apply doma-cloud-tests.patch

# 2. Install the new dev dependencies (happy-dom, testing-library):
bun install

# 3. Generate the Prisma client + create the test database:
bunx prisma generate
bunx prisma db push --skip-generate   # uses DATABASE_URL from tests/preload.ts

# 4. Run the tests:
bun run test
```

If `git apply` fails (e.g. the patch was generated against a newer commit
than your checkout), use `git apply --3way` to attempt a 3-way merge.

## What's New

### Test infrastructure
- `bunfig.toml` — Bun test configuration with preload
- `tests/preload.ts` — sets env vars, mocks `next/headers`, installs happy-dom
- `tests/helpers/` — `db.ts`, `mock-cookies.ts`, `mock-request.ts`, `storage.ts`, `react.ts`
- `scripts/run-tests-serially.sh` — runs each test file in its own process for isolation
- `tsconfig.test.json` — separate typecheck config for tests

### Production-code changes (minimal, test-only)
- `src/lib/storage/index.ts` — added `resetStorageCache()` export (1 function, 5 lines)
- `src/lib/auth/rate-limit.ts` — added `__clearRateLimitBucketsForTests()` export (1 function, 4 lines)
- `tsconfig.json` — added `tests` to `exclude` (tests have their own tsconfig)
- `.gitignore` — added test artifacts (test.db, storage-data-test/, tsbuildinfo)
- `package.json` — added test scripts + 3 dev dependencies (@testing-library/react, @testing-library/jest-dom, happy-dom)

## Running Tests

```bash
bun run test              # all 426 tests (runs each file in its own process)
bun run test:unit         # only the 139 fast unit tests (no DB)
bun run test:integration  # only the DB/API/component tests
bun run test:setup        # recreate the test database after schema changes
bun run typecheck         # typecheck the app
bun run typecheck:test    # typecheck the tests
```

## Bugs Documented by the Tests

The tests pin 6 real behaviors in the existing code (5 bugs + 1 subtle design choice).
See `tests/README.md` for the full list with fix suggestions.

## Troubleshooting

**"Cannot find module 'bun:test'"** — make sure you're running with Bun, not Node:
```bash
bun run test   # NOT npm test
```

**"Unable to open the database file"** — the test DB is auto-created at
`prisma/test.db` by the preload script. If you see this, run `bun run test:setup`
once to create it.

**Tests pass individually but fail when run together** — this is expected; use
`bun run test` (which runs `scripts/run-tests-serially.sh`) rather than
`bun test` directly. The serial script gives each test file its own process
for full isolation of the DB, rate-limiter, and cookie store.
