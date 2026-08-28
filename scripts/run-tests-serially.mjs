/**
 * Run each test file in a separate Bun process for full isolation.
 * Cross-platform replacement for run-tests-serially.sh (no bash, /tmp, find).
 *
 * Why: Bun runs test files in parallel within a single process by default.
 * This means test files share:
 *   - The PrismaClient instance (and thus the DB connection)
 *   - The in-memory rate-limit buckets
 *   - The mock cookie store
 *   - The cached storage backend
 *
 * When one file's beforeEach resets the DB / cookies / rate-limiter, it
 * wipes state that another file is mid-test using → flaky failures.
 *
 * Usage: bun scripts/run-tests-serially.mjs [dir]   (default: tests)
 */
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";

const target = process.argv[2] ?? "tests";

/** Recursively collect *.test.ts / *.test.tsx under `dir`, sorted. */
function findTestFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTestFiles(full));
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = findTestFiles(target).sort();
if (files.length === 0) {
  console.error(`No test files found under ${target}`);
  process.exit(1);
}

const pass = [];
const fail = [];

for (const f of files) {
  // --max-concurrency 1 keeps tests within the file serial too
  // (avoids beforeEach overlap).
  const res = spawnSync("bun", ["test", "--max-concurrency", "1", f], {
    encoding: "utf8",
    // Merge output: bun prints results to both streams.
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = (res.stdout ?? "") + (res.stderr ?? "");
  const lines = output.split(/\r?\n/);
  const summary = (re) => {
    const m = lines.filter((l) => re.test(l)).pop();
    return m ? m.trim().replace(/\s+/g, " ") : "no summary";
  };
  const passLine = summary(/^\s*\d+ pass\b/);
  const failLine = summary(/^\s*\d+ fail\b/);

  if (res.status === 0) {
    console.log(`  PASS  ${f}  (${passLine}, ${failLine})`);
    pass.push(f);
  } else {
    console.log(`  FAIL  ${f}  (${passLine}, ${failLine})`);
    // Print the last 25 lines of output for debugging.
    console.log(lines.slice(-25).join("\n"));
    fail.push(f);
  }
}

console.log(
  `\n=============================================\n` +
    `Files: ${files.length} total, ${pass.length} passed, ${fail.length} failed`
);
if (fail.length > 0) {
  console.log(`\nFailed files:\n${fail.map((f) => `  - ${relative(".", f).split(sep).join("/")}`).join("\n")}`);
  process.exit(1);
}
console.log("All test files passed.");
