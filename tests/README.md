# Doma Cloud — Test Suite

This directory contains the test suite for the Doma Cloud application, built with
[Bun's built-in test runner](https://bun.com/docs/test) (`bun:test`).

## Quick Start

```bash
# One-time: create the test database
bun run test:setup

# Run all tests
bun run test

# Run only unit tests (fast, no DB)
bun run test:unit
```

## Test Organization

```
tests/
├── preload.ts                    # Runs before every test file; sets env vars + installs mocks + happy-dom
├── helpers/
│   ├── db.ts                     # PrismaClient (shared with app), resetDb(), seedUser/File/Share
│   ├── mock-cookies.ts           # Mock for next/headers cookies() — uses AsyncLocalStorage
│   ├── mock-request.ts           # buildRequest() / callRoute() helpers for API route tests
│   ├── storage.ts                # makeTempStorage() — fresh temp dir per test
│   └── react.ts                  # resetDom() helper for React component tests
├── unit/                         # Pure-function tests (no DB, no mocks)
│   ├── format.test.ts            # formatBytes, formatDate, formatRelative
│   ├── mime.test.ts              # guessMime, categorize, isPreviewable
│   ├── utils.test.ts             # cn (className combiner)
│   ├── tree-pure.test.ts         # sanitizeName
│   ├── storage-key.test.ts       # buildStorageKey
│   ├── rate-limit.test.ts        # rateLimit, getClientIp, LIMITS
│   ├── password.test.ts          # hashPassword, verifyPassword (argon2id)
│   ├── session.test.ts           # signSession, verifySession (JWT), getSecret behavior
│   ├── store.test.ts             # useCloudStore (Zustand) — path, view, layout, upload
│   └── toast-reducer.test.ts     # toast reducer (ADD/UPDATE/DISMISS/REMOVE)
└── integration/                  # DB + storage + API route + component tests
    ├── settings.test.ts          # getSetting, getAllSettings, setSetting
    ├── tree-db.test.ts           # listChildren, computeDirectorySize, purgeSubtree, ensureDirectory
    ├── storage.test.ts           # LocalFileStorage: put/get/delete/stat, path traversal, stream errors
    ├── components/
    │   ├── empty-state.test.tsx  # EmptyState component (files/trash views)
    │   ├── file-icon.test.tsx    # FileIcon component (all categories + icon selection)
    │   ├── breadcrumbs.test.tsx  # Breadcrumbs component (navigation, popTo)
    │   └── query-provider.test.tsx # QueryProvider wrapper
    ├── hooks/
    │   ├── use-mobile.test.tsx   # useIsMobile hook (breakpoint detection)
    │   └── use-toast.test.tsx    # useToast hook (add/dismiss/update toasts)
    └── api/
        ├── auth.test.ts          # POST /api/auth/{login,register,logout}
        ├── basic.test.ts         # GET /api/{me,setup/status,public-settings}
        ├── files.test.ts         # /api/files/{list,mkdir,upload,rename,[id]}
        ├── share-download.test.ts # /api/files/[id]/share, /api/share/[token], /api/files/download/[id]
        ├── admin.test.ts         # /api/admin/{users,settings,stats,recompute-quotas}
        └── profile-cron.test.ts  # /api/profile, /api/profile/password, /api/cron/trash-cleanup
```

## How It Works

### Test Isolation

Each test file runs in its **own Bun process** (see `scripts/run-tests-serially.sh`).
This ensures full isolation:

- **Database**: Each process gets its own PrismaClient connection. `beforeEach`
  calls `resetDb()` to wipe all rows.
- **Rate limiter**: The in-memory `buckets` Map is per-process.
  `__clearRateLimitBucketsForTests()` clears it between tests.
- **Mock cookies**: Uses `AsyncLocalStorage` so each test's cookie store is
  isolated.
- **Storage**: `makeTempStorage()` creates a fresh temp directory per test;
  `cleanupTempStorage()` removes it in `afterEach`.

### Mocking `next/headers`

The biggest challenge in testing Next.js App Router routes is that `cookies()`
from `next/headers` reads from a request context that doesn't exist in tests.

The preload script installs a mock via `mock.module("next/headers", ...)` that
returns a configurable in-memory cookie store. The `buildRequest()` helper
automatically syncs any `cookies` you pass to both the `NextRequest` object AND
the mock store.

### API Route Testing Pattern

```typescript
import { POST as login } from "@/app/api/auth/login/route";
import { callRoute } from "../../helpers/mock-request";
import { seedUser } from "../../helpers/db";

it("logs in successfully", async () => {
  await seedUser({ username: "alice", password: "password123" });
  const { response, data } = await callRoute(login, {
    method: "POST",
    body: { username: "alice", password: "password123" },
    cookies: { doma_session: token }, // optional, for authenticated routes
  });
  expect(response.status).toBe(200);
});
```

## Findings (Bugs / Quirks Documented by Tests)

The tests document several real behaviors (some are bugs) in the existing code:

1. **`.ts` files categorized as "video"** (`mime.test.ts`): The `mime-types`
   library returns `video/mp2t` for `.ts` (MPEG Transport Stream), and the
   mime-prefix check in `categorize()` runs before `CODE_EXT`. TypeScript
   files are therefore misclassified.

2. **Case-insensitive username duplicate check is broken** (`auth.test.ts`):
   The register route tries `findFirst({ where: { username: { equals: username.toLowerCase() } } })`,
   but SQLite's default comparison is case-sensitive, so registering "alice"
   when "Alice" exists succeeds (should be a 409).

3. **`sanitizeName` order-of-operations** (`tree-pure.test.ts`): Leading dots
   are stripped BEFORE whitespace is trimmed, so `"  ..foo"` → `"..foo"`
   (dots survive because they're not at position 0 when the strip runs).

4. **`sanitizeName` on all-forbidden input**: `sanitizeName("\\")` returns
   `"_"` (not `"untitled"`), because the backslash is replaced with `_`
   before the empty-fallback check.

5. **Session role refresh**: `getSession()` returns the role from the DB (not
   the JWT), so role changes take effect immediately. Token-version checking
   still invalidates old sessions after password changes.

6. **FileIcon colors are overridden by text-muted-foreground** (`file-icon.test.tsx`):
   The `iconFor()` helper in `src/components/cloud/file-icon.tsx` defines a
   local `const className = "text-muted-foreground"` and passes it as the
   second argument to `cn(categoryColor, className)`. Because `twMerge`
   keeps the LAST conflicting class, the muted-foreground ALWAYS wins over
   the per-category color. All non-folder icons appear in muted gray instead
   of their intended category color. Fix: pass the muted-foreground class
   only for the fallback case, or restructure the cn() call.

## Adding New Tests

1. **Unit test** (pure function): Add to `tests/unit/`. No DB, no mocks needed.
2. **Integration test** (DB-dependent): Add to `tests/integration/`. Use
   `resetDb()` in `beforeEach`, `seedUser/File/Share` for setup.
3. **API route test**: Add to `tests/integration/api/`. Use `callRoute()` with
   `cookies: { doma_session: token }` for authenticated routes. Call
   `__clearRateLimitBucketsForTests()` in `beforeEach` if the route uses
   rate limiting.

Run `bun run test:setup` after modifying `prisma/schema.prisma` to sync the
test DB.
