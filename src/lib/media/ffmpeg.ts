/**
 * Optional ffmpeg/ffprobe integration — video poster frames + metadata.
 *
 * Binaries are resolved in order:
 *   1. FFMPEG_PATH / FFPROBE_PATH env vars
 *   2. <cwd>/tools/ffmpeg/bin/ffmpeg.exe (+ .exe-less variant)
 *   3. well-known project location (this self-hosted deployment)
 *   4. bare names via PATH (verified by actually running `-version`)
 * When nothing is found every helper returns null and the app keeps working
 * exactly as before — ffmpeg is strictly an enhancement, never a dependency
 * of uploads or previews.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";

// Last-resort fallback for a known local deployment layout. Override with
// DOMA_PROJECT_ROOT (e.g. on a Linux mini-PC: DOMA_PROJECT_ROOT=/opt/doma)
// or, better, point FFMPEG_PATH/FFPROBE_PATH at the binaries directly —
// on Linux an `apt install ffmpeg` is found via PATH automatically.
const PROJECT_FALLBACK = process.env.DOMA_PROJECT_ROOT || "C:\\doma-cloud-main";
const TOOL_BIN_DIR = path.join("tools", "ffmpeg", "bin");

interface FfmpegBins {
  ffmpeg: string;
  ffprobe: string;
}

let cache: { bins: FfmpegBins | null; at: number } | null = null;
const NEGATIVE_TTL_MS = 60_000;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bare-name (PATH) candidates can't be verified with fs.access — run them.
 * Without this, locateFfmpeg() would report "found" on machines that have no
 * ffmpeg in PATH at all (e.g. CI): the returned bare name fails only later at
 * spawn time, so skip-guards like `if (!bins) return` in the video-poster
 * test never trigger. `-version` exits 0 on every real ffmpeg/ffprobe build
 * and is cheap; a missing binary surfaces as an ENOENT error / null status.
 */
function runsOnPath(bin: string): boolean {
  const r = spawnSync(bin, ["-version"], { timeout: 5_000, windowsHide: true });
  return r.status === 0;
}

export async function locateFfmpeg(): Promise<FfmpegBins | null> {
  if (cache && Date.now() - cache.at < (cache.bins ? Infinity : NEGATIVE_TTL_MS)) {
    return cache.bins;
  }

  const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);
  const cwdDir = path.resolve(process.cwd(), TOOL_BIN_DIR);
  const fallbackDir = path.join(PROJECT_FALLBACK, TOOL_BIN_DIR);

  const candidates: FfmpegBins[] = [];
  if (process.env.FFMPEG_PATH && process.env.FFPROBE_PATH) {
    candidates.push({ ffmpeg: process.env.FFMPEG_PATH, ffprobe: process.env.FFPROBE_PATH });
  }
  for (const dir of [cwdDir, fallbackDir]) {
    candidates.push({
      ffmpeg: path.join(dir, exe("ffmpeg")),
      ffprobe: path.join(dir, exe("ffprobe")),
    });
  }
  candidates.push({ ffmpeg: exe("ffmpeg"), ffprobe: exe("ffprobe") });

  for (const c of candidates) {
    if (c.ffmpeg.includes(path.sep) && !(await exists(c.ffmpeg))) continue;
    if (c.ffprobe.includes(path.sep) && !(await exists(c.ffprobe))) continue;
    if (!c.ffmpeg.includes(path.sep) && !runsOnPath(c.ffmpeg)) continue;
    if (!c.ffprobe.includes(path.sep) && !runsOnPath(c.ffprobe)) continue;
    cache = { bins: c, at: Date.now() };
    return c;
  }
  cache = { bins: null, at: Date.now() };
  return null;
}

/** Is video poster generation available at all? */
export async function ffmpegAvailable(): Promise<boolean> {
  return (await locateFfmpeg()) !== null;
}

function runProcess(bin: string, args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let stderr = "";
    let settled = false;
    const done = (err: Error | null, data?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(data ?? Buffer.alloc(0));
    };
    const timer = setTimeout(() => {
      child.kill();
      done(new Error(`${path.basename(bin)} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(0, 16_000);
    });
    child.on("error", (e) => done(e));
    child.on("close", (code) => {
      if (code !== 0) {
        done(new Error(`${path.basename(bin)} exited ${code}: ${stderr.slice(-400)}`));
        return;
      }
      done(null, Buffer.concat(chunks));
    });
  });
}

export interface VideoProbe {
  codec: string;
  width: number;
  height: number;
  durationMs: number | null;
}

/** Pure parse — unit-testable without spawning ffprobe. */
export function parseProbeJson(json: string): VideoProbe | null {
  let parsed: {
    streams?: { codec_name?: string; width?: number; height?: number; duration?: string }[];
    format?: { duration?: string };
  };
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const stream = parsed?.streams?.[0];
  if (!stream?.codec_name) return null;
  const durationRaw = parsed?.format?.duration ?? stream.duration;
  const durationSec = durationRaw ? parseFloat(durationRaw) : NaN;
  return {
    codec: stream.codec_name,
    width: typeof stream.width === "number" ? stream.width : 0,
    height: typeof stream.height === "number" ? stream.height : 0,
    durationMs:
      Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec * 1000) : null,
  };
}

/** ffprobe a local video file. Returns null when ffmpeg is absent or probe fails. */
export async function probeVideo(filePath: string, timeoutMs = 20_000): Promise<VideoProbe | null> {
  const bins = await locateFfmpeg();
  if (!bins) return null;
  try {
    const out = await runProcess(
      bins.ffprobe,
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,duration:format=duration",
        filePath,
      ],
      timeoutMs
    );
    return parseProbeJson(out.toString("utf-8"));
  } catch {
    return null;
  }
}

/**
 * Extract a single poster frame as MJPEG bytes. Seeking ~1/3 into the video
 * avoids the black first frame many recordings start with. Retries from 0s
 * when the seek target turns out to be broken on odd files.
 */
export async function extractPosterFrame(
  filePath: string,
  durationMs: number | null,
  timeoutMs = 30_000
): Promise<Buffer | null> {
  const bins = await locateFfmpeg();
  if (!bins) return null;
  const seek = durationMs && durationMs > 3_000 ? (durationMs / 1000 / 3).toFixed(2) : "0";
  // Pre-downscale in ffmpeg (~480px) so the final sharp resize to 64-256px
  // is a small step, not a giant leap from 4K — much sharper thumbnails.
  // q:v 3 = high-quality MJPEG (scale 1=best, 31=worst).
  const vf = "scale='min(480,iw)':min'(480,ih)':force_original_aspect_ratio=decrease";
  const buildArgs = (s: string) => [
    "-nostdin",
    "-v",
    "error",
    "-ss",
    s,
    "-i",
    filePath,
    "-frames:v",
    "1",
    "-vf",
    vf,
    "-q:v",
    "3",
    "-vcodec",
    "mjpeg",
    "-f",
    "image2pipe",
    "pipe:1",
  ];
  try {
    return await runProcess(bins.ffmpeg, buildArgs(seek), timeoutMs);
  } catch {
    if (seek === "0") return null;
    try {
      return await runProcess(bins.ffmpeg, buildArgs("0"), timeoutMs);
    } catch {
      return null;
    }
  }
}

// ---- Tiny concurrency limiter: grid pages fire dozens of poster requests at
// once; ffmpeg spawns must not stampede the CPU / USB disk. Max 2 in flight.
let active = 0;
const waiters: (() => void)[] = [];
const MAX_CONCURRENT = 2;

export async function withMediaSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}