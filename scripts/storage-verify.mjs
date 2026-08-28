/**
 * Verify storage integrity: every non-directory FileNode must have its
 * physical file present at <root>/<storageKey>, and every file under
 * users/ must belong to some FileNode row (no cross-user strays).
 *
 * Usage:
 *   bun scripts/storage-verify.mjs [--orphans]   # --orphans also lists
 *                                                # files not tracked in DB
 */
import fs from "node:fs";
import path from "node:path";

const listOrphans = process.argv.includes("--orphans");

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

try {
  const rootSetting = await db.setting.findUnique({ where: { key: "storageLocalRoot" } });
  const root =
    rootSetting?.value ||
    process.env.STORAGE_LOCAL_ROOT ||
    path.join(process.cwd(), "storage-data");
  console.log(`Storage root: ${root}\n`);

  const nodes = await db.fileNode.findMany({
    where: { isDirectory: false },
    select: { id: true, ownerId: true, storageKey: true },
  });

  const knownKeys = new Set(nodes.map((n) => n.storageKey));
  let missingOnDisk = 0, wrongOwner = 0;

  for (const n of nodes) {
    if (!n.storageKey) continue;
    const full = path.join(root, n.storageKey.replace(/\//g, path.sep));
    if (!fs.existsSync(full)) {
      console.error(`✗ MISSING on disk: node=${n.id} owner=${n.ownerId} key=${n.storageKey}`);
      missingOnDisk++;
      continue;
    }
    const parts = n.storageKey.split("/");
    const ownerSegment = parts[0] === "users" ? parts[1] : parts[0];
    if (ownerSegment !== n.ownerId) {
      console.error(`✗ OWNER MISMATCH: node=${n.id} row-owner=${n.ownerId} key-owner=${ownerSegment}`);
      wrongOwner++;
    }
  }

  let orphanCount = 0;
  if (listOrphans) {
    console.log("\nFiles on disk not referenced by any FileNode:");
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch { continue; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(full);
        else {
          const rel = path.relative(root, full).split(path.sep).join("/");
          if (rel.includes(".tmp-")) continue; // temp artifacts are fine
          if (!knownKeys.has(rel)) {
            console.log(`  ? ${rel}`);
            orphanCount++;
          }
        }
      }
    }
    if (orphanCount === 0) console.log("  (none)");
  }

  console.log(
    `\nSummary: rows=${nodes.length} missingOnDisk=${missingOnDisk} ownerMismatches=${wrongOwner}` +
      (listOrphans ? ` orphans=${orphanCount}` : "")
  );
  process.exitCode = missingOnDisk + wrongOwner > 0 ? 1 : 0;
} finally {
  await db.$disconnect();
}
