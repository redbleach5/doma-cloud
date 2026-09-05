// Consistent SQLite backup WITHOUT the sqlite3 CLI (uses bun:sqlite).
// Same contract as scripts/prod/backup.ps1:
//   - online-consistent copy of the DB (VACUUM INTO == sqlite3 .backup)
//   - .env copied next to it as backup.env (secrets travel with the backup)
//   - BACKUP.txt manifest with sha256
//   - retention: keep last DOMA_BACKUP_KEEP (default 7) backup-* dirs
// Run: bun scripts/prod/backup-node.mjs
import { Database } from "bun:sqlite";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..");
const envFile = path.join(root, ".env");
if (!existsSync(envFile)) {
  console.error("env file not found: " + envFile);
  process.exit(1);
}

const env = {};
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const dbUrl = env.DATABASE_URL || "file:./doma.db";
const dbPath = dbUrl.replace(/^file:/, "");
const dbAbs = path.isAbsolute(dbPath)
  ? dbPath
  : path.join(root, dbPath.replace(/^[.][\\/]+/, ""));

const keep = env.DOMA_BACKUP_KEEP ? parseInt(env.DOMA_BACKUP_KEEP, 10) : 7;
const backupDir = env.DOMA_BACKUP_DIR || path.join(root, "..", "doma-backups");
const backupRoot = path.isAbsolute(backupDir)
  ? backupDir
  : path.join(root, backupDir.replace(/^[.][\\/]+/, ""));

if (!existsSync(dbAbs)) {
  console.error("database not found: " + dbAbs);
  process.exit(1);
}

const stamp =
  new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19) + "-" + process.pid;
const out = path.join(backupRoot, "backup-" + stamp);
mkdirSync(out, { recursive: true });

// VACUUM INTO produces a fully checkpointed, consistent copy — safe while
// the server is running (WAL), same guarantee as `sqlite3 .backup`.
const db = new Database(dbAbs);
db.exec("PRAGMA busy_timeout = 5000");
const target = path.join(out, "doma.db").replace(/\\/g, "/");
db.exec(`VACUUM INTO '${target}'`);
db.close();

copyFileSync(envFile, path.join(out, "backup.env"));

const sha = createHash("sha256")
  .update(readFileSync(path.join(out, "doma.db")))
  .digest("hex");

writeFileSync(
  path.join(out, "BACKUP.txt"),
  `backup: ${out}\ndb: ${dbAbs}\nsha256: ${sha}\nfiles: no\n`
);

// Retention — newest `keep` survive.
const dirs = readdirSync(backupRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith("backup-"))
  .map((d) => d.name)
  .sort()
  .reverse();
for (const name of dirs.slice(keep)) {
  rmSync(path.join(backupRoot, name), { recursive: true, force: true });
}

console.log(`backup: ${out}`);
console.log(`db: ${dbAbs}`);
console.log(`sha256: ${sha}`);
console.log(`retention: last ${keep}`);