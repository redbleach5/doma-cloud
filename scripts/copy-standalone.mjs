/**
 * Copy static assets into the standalone server output after `next build`.
 *
 * `next build` with `output: "standalone"` does NOT copy public/ or
 * .next/static into .next/standalone — the app would 404 on assets.
 * Replaces the previous `cp ... || xcopy ...` shell snippet, which only
 * worked on Unix (and broke `bun run build` on Windows).
 */
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const jobs = [
  { from: path.join(root, ".next", "static"), to: path.join(root, ".next", "standalone", ".next", "static") },
  { from: path.join(root, "public"), to: path.join(root, ".next", "standalone", "public") },
];

for (const { from, to } of jobs) {
  if (!existsSync(from)) {
    console.warn(`[copy-standalone] skip missing: ${path.relative(root, from)}`);
    continue;
  }
  cpSync(from, to, { recursive: true });
  console.log(`[copy-standalone] copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}
