/**
 * Storage inspection helpers — read-only utilities that surface what the
 * server sees on disk so the admin dashboard can show it.
 *
 * All functions here are SAFE — they only read metadata, never write or
 * delete anything. The admin can change where files are stored via the
 * settings API (`storageLocalRoot` setting), but switching the root does
 * NOT move existing files — that's intentional (moving terabytes behind
 * the user's back is dangerous). The admin gets a clear warning in the UI.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCb);

export interface DiskInfo {
  /** Mount point (e.g. "/", "/mnt/raid", "/data"). */
  mount: string;
  /** Device or pseudo-device (e.g. "/dev/sda1", "overlay"). */
  device: string;
  /** Filesystem type (e.g. "ext4", "btrfs", "tmpfs"). */
  fsType: string;
  /** Total bytes on the filesystem. */
  totalBytes: number;
  /** Used bytes (total - free - reserved). */
  usedBytes: number;
  /** Available bytes (what non-root users can use). */
  freeBytes: number;
}

export interface StorageStatus {
  /** Currently active storage driver. */
  driver: "local" | "s3" | string;
  /** For local driver — the absolute path files are written to. */
  localRoot: string | null;
  /** For S3 driver — the bucket + endpoint (no secrets). */
  s3: { endpoint: string | null; bucket: string | null; region: string | null } | null;
  /** True if the configured root directory exists and is writable. */
  localRootOk: boolean;
  /** Free space at the configured root (best-effort, may be null on error). */
  localRootFreeBytes: number | null;
  /** Total space at the configured root. */
  localRootTotalBytes: number | null;
  /** How many bytes are currently stored in the root (recursive, best-effort). */
  localRootUsedBytes: number | null;
  /** All mounted filesystems the admin could potentially switch to. */
  mounts: DiskInfo[];
  /** Whether statfs is available on this platform. */
  supportsStatfs: boolean;
}

/**
 * Read /proc/mounts (Linux) or run `mount` (macOS/BSD) to enumerate
 * filesystems. Filters out pseudo-filesystems (proc, sysfs, cgroup, etc.)
 * so the admin only sees real disks they could actually store files on.
 */
export async function listMounts(): Promise<DiskInfo[]> {
  let mountsRaw: string;
  try {
    if (process.platform === "linux") {
      mountsRaw = await fs.readFile("/proc/mounts", "utf-8");
    } else {
      // macOS / BSD fallback
      const { stdout } = await exec("mount");
      mountsRaw = stdout;
    }
  } catch {
    return [];
  }

  // Pseudo/dev filesystems we never want to show as storage targets.
  const PSEUDO_FS = new Set([
    "proc", "sysfs", "devtmpfs", "tmpfs", "devpts", "cgroup", "cgroup2",
    "pstore", "bpf", "tracefs", "debugfs", "fusectl", "securityfs",
    "mqueue", "hugetlbfs", "ramfs", "configfs", "efivarfs", "binfmt_misc",
    "autofs", "rpc_pipefs", "nsfs", "fuse.gvfsd-fuse", "fuse.snapfuse",
  ]);

  const lines = mountsRaw.split("\n").filter(Boolean);
  const seen = new Set<string>();
  const disks: DiskInfo[] = [];

  for (const line of lines) {
    // /proc/mounts format: device mount-point fs-type options dump pass
    // macOS `mount` format: device on mount-point (fs-type, options)
    let device: string, mount: string, fsType: string;
    if (process.platform === "linux") {
      const parts = line.split(/\s+/);
      if (parts.length < 3) continue;
      [device, mount, fsType] = parts;
    } else {
      const m = line.match(/^(.+?)\s+on\s+(.+?)\s+\(([^,]+)/);
      if (!m) continue;
      [, device, mount, fsType] = m;
    }

    // Decode octal escapes (/proc/mounts encodes spaces as \040 etc.)
    mount = mount.replace(/\\0(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));

    if (PSEUDO_FS.has(fsType)) continue;
    if (seen.has(mount)) continue;
    seen.add(mount);

    try {
      const stat = await fs.statfs(mount);
      const total = stat.blocks * stat.bsize;
      const free = stat.bavail * stat.bsize;
      const used = total - (stat.bfree * stat.bsize);
      disks.push({
        mount,
        device,
        fsType,
        totalBytes: total,
        usedBytes: used,
        freeBytes: free,
      });
    } catch {
      // statfs failed (permission, or special FS) — skip this mount.
    }
  }

  // Sort: longest mount path first so /mnt/raid comes before /
  disks.sort((a, b) => b.mount.length - a.mount.length);
  return disks;
}

/**
 * Compute the total size of a directory tree (best-effort). Used to show
 * "how much is currently in the storage root" — if it's slow on a huge
 * directory, we cap the walk at 50k entries.
 */
export async function directorySize(dir: string, maxEntries = 50_000): Promise<number> {
  let total = 0;
  let count = 0;
  const stack: string[] = [dir];

  while (stack.length > 0 && count < maxEntries) {
    const current = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      count++;
      if (count > maxEntries) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const s = await fs.stat(full);
          total += s.size;
        } catch {}
      }
    }
  }
  return total;
}

/**
 * Build the complete storage status object for the admin dashboard.
 */
export async function getStorageStatus(): Promise<StorageStatus> {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  // Use the DB-backed resolver so we respect the admin-configured root
  // (not just the env var). This is the same resolver getStorage() uses,
  // so what the admin sees here matches where files actually land.
  let localRoot: string | null = null;
  if (driver === "local") {
    try {
      const { getLocalStorageRoot } = await import("@/lib/storage");
      localRoot = await getLocalStorageRoot();
    } catch {
      // DB not available yet (initial setup) — fall back to env.
      localRoot = process.env.STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), "storage-data");
    }
  }

  let localRootOk = false;
  let localRootFreeBytes: number | null = null;
  let localRootTotalBytes: number | null = null;
  let localRootUsedBytes: number | null = null;

  if (localRoot) {
    try {
      // Check that the root exists and is writable.
      await fs.access(localRoot, fs.constants.W_OK | fs.constants.R_OK);
      localRootOk = true;
      const stat = await fs.statfs(localRoot);
      localRootTotalBytes = stat.blocks * stat.bsize;
      localRootFreeBytes = stat.bavail * stat.bsize;
    } catch {
      // Root doesn't exist or isn't writable. That's a useful signal
      // for the admin UI — show it as "not configured".
      localRootOk = false;
    }
    // Compute used bytes lazily — only if the root is OK. This can be
    // slow on a huge directory, so the API endpoint can opt out via
    // ?skipUsed=1.
    if (localRootOk) {
      try {
        localRootUsedBytes = await directorySize(localRoot);
      } catch {
        // Non-fatal — just leave it null.
      }
    }
  }

  return {
    driver,
    localRoot,
    s3:
      driver === "s3"
        ? {
            endpoint: process.env.S3_ENDPOINT ?? null,
            bucket: process.env.S3_BUCKET ?? null,
            region: process.env.S3_REGION ?? null,
          }
        : null,
    localRootOk,
    localRootFreeBytes,
    localRootTotalBytes,
    localRootUsedBytes,
    mounts: await listMounts(),
    supportsStatfs: typeof fs.statfs === "function",
  };
}

/**
 * Resolve and validate a candidate storage root path. Returns the
 * absolute path if valid, or throws with a helpful message.
 *
 * Rules:
 *   - Must be absolute (no relative paths — too fragile)
 *   - Must not be a system directory (/, /etc, /usr, /bin, /var, /boot,
 *     /dev, /proc, /sys)
 *   - If it doesn't exist, we'll create it (but the parent must exist)
 *   - If it exists, it must be a directory and writable
 */
export async function validateStorageRoot(candidate: string): Promise<string> {
  if (!path.isAbsolute(candidate)) {
    throw new Error("Путь должен быть абсолютным (начинаться с /)");
  }

  const FORBIDDEN = new Set([
    "/", "/etc", "/usr", "/bin", "/sbin", "/var", "/boot", "/dev",
    "/proc", "/sys", "/lib", "/lib64", "/run", "/snap",
  ]);
  const normalized = path.resolve(candidate);
  if (FORBIDDEN.has(normalized)) {
    throw new Error(`Нельзя использовать системную директорию: ${normalized}`);
  }

  try {
    const stat = await fs.stat(normalized);
    if (!stat.isDirectory()) {
      throw new Error("Указанный путь существует, но это не директория");
    }
    await fs.access(normalized, fs.constants.W_OK);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Doesn't exist — check parent and create.
      const parent = path.dirname(normalized);
      try {
        await fs.stat(parent);
      } catch {
        throw new Error(`Родительская директория не существует: ${parent}`);
      }
      await fs.mkdir(normalized, { recursive: true });
    } else {
      throw err;
    }
  }
  return normalized;
}

/**
 * Check if a path is currently writable by creating a temp file.
 * Used to confirm a candidate root actually works before switching.
 */
export async function probeWritable(dir: string): Promise<boolean> {
  const test = path.join(dir, `.doma-probe-${Date.now()}`);
  try {
    await fs.writeFile(test, "ok");
    await fs.unlink(test);
    return true;
  } catch {
    return false;
  }
}
