/**
 * Create/refresh the SQLite test database used by `bun run test:*`.
 *
 * Why a script instead of an inline `DATABASE_URL=... prisma db push`:
 * Prisma resolves RELATIVE SQLite URLs against the schema directory
 * (prisma/), not against cwd — so `file:./prisma/test.db` silently
 * creates prisma/prisma/test.db. That bug shipped a red CI run: push
 * "succeeded" into the wrong file while tests/preload.ts points at the
 * absolute prisma/test.db, and every test failed with
 * "The table `main.Share` does not exist in the current database."
 * Here the URL is always absolute (computed from the project root),
 * so the push lands exactly where the tests look, on every OS.
 *
 * After the push the schema is verified by opening the file with
 * bun:sqlite and asserting every model table exists — a silent
 * mismatch now fails here with a clear message instead of a cryptic
 * Prisma error in every test file.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DB = resolve(PROJECT_ROOT, "prisma/test.db");

// Prisma accepts forward slashes on all platforms (README documents
// `file:D:/doma/...`), so normalize Windows separators.
const databaseUrl = `file:${TEST_DB.replace(/\\/g, "/")}`;

const push = spawnSync("bun", ["prisma", "db", "push", "--skip-generate"], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: "inherit",
});
if (push.status !== 0) {
  console.error(`prisma db push failed with exit code ${push.status}`);
  process.exit(push.status ?? 1);
}

// ---- Verify: every model must exist as a table in prisma/test.db ----
const REQUIRED_TABLES = ["User", "FileNode", "Share", "SharedItem", "Setting"];

let tables;
try {
  const db = new Database(TEST_DB, { readonly: true });
  tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  db.close();
} catch (e) {
  console.error(`\nERROR: cannot open ${TEST_DB} — db push did not create it here.`);
  console.error(String(e));
  process.exit(1);
}

const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
if (missing.length > 0) {
  console.error(`\nERROR: ${TEST_DB} is missing tables: ${missing.join(", ")}`);
  console.error(`Tables found: ${tables.join(", ")}`);
  process.exit(1);
}
console.log(`\nTest database ready: ${TEST_DB}`);
console.log(`Verified tables: ${REQUIRED_TABLES.join(", ")}`);
