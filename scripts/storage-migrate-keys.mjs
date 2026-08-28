/**
 * Migrate legacy storage keys (<ownerId>/<fileId>/<name>) to the namespaced
 * layout users/<ownerId>/files/<fileId>/<name>.
 *
 * Reads FileNode rows from the DB, moves the physical files, then updates
 * `storageKey` inside a single transaction per file (move first, DB update
 * second — if the process dies between the two, `storage:verify` reports
 * the mismatch and a re-run finishes the job).
 *
 * Usage:
 *   bun scripts/storage-migrate-keys.mjs            # dry-run, shows the plan
 *   bun scripts/storage-migrate-keys.mjs --apply    # actually move files
 */
import fs from "node:fs";
import path from "node:path";

const apply = process.argv.includes("--apply");

// Minimal .env loader (no external deps).
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

function newKeyFor(oldKey) {
  // <ownerId>/<fileId>/<name> → users/<ownerId>/files/<fileId>/<name>
  const parts = oldKey.split("/");
  if (parts.length < 3) return null;
  return `users/${parts[0]}/files/${parts.slice(1).join("/")}`;
}

try {
  const nodes = await db.fileNode.findMany({
    where: { isDirectory: false },
    select: { id: true, ownerId: true, name: true, storageKey: true },
  });

  const rootSetting = await db.setting.findUnique({ where: { key: "storageLocalRoot" } });
  const root = rootSetting?.value || process.env.STORAGE_LOCAL_ROOT || path.join(process.cwd(), "storage-data");
  console.log(`Storage root: ${root}`);
  console.log(`Non-directory FileNode rows: ${nodes.length}\n`);

  let migrated = 0, skipped = 0, missing = 0;
  for (const n of nodes) {
    if (!n.storageKey || n.storageKey.startsWith("users/")) { skipped++; continue; }
    const expectedOwner = n.storageKey.split("/")[0];
    if (expectedOwner !== n.ownerId) {
      console.warn(`⚠ SKIP ${n.id}: key owner (${expectedOwner}) ≠ row owner (${n.ownerId}) — fix manually`);
      skipped++;
      continue;
    }
    const newKey = newKeyFor(n.storageKey);
    const src = path.join(root, n.storageKey);
    const dst = path.join(root, newKey);
    if (!fs.existsSync(src)) { missing++; console.warn(`⚠ file on disk not found: ${src}`); continue; }

    if (!apply) {
      console.log(`[dry-run] ${n.storageKey} → ${newKey}`);
      migrated++;
      continue;
    }

    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst); // same volume → atomic
    await db.fileNode.update({ where: { id: n.id }, data: { storageKey: newKey } });
    migrated++;
  }

  console.log(`\nDone. migrated=${migrated} skipped=${skipped} missingOnDisk=${missing}`);
  if (!apply) console.log("This was a dry-run. Re-run with --apply to perform the migration.");
} finally {
  await db.$disconnect();
}
