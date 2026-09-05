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
  /** False when the filesystem is mounted read-only or a write probe fails. */
  writable: boolean;
  /** Short hint when not writable (e.g. NTFS on macOS). */
  readOnlyReason: string | null;
}

export interface StorageStatus {
  /** Absolute path files are written to. */
  localRoot: string | null;
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
  if (process.platform === "win32") return listMountsWindows();
  return listMountsPosix();
}

/**
 * Windows: enumerate fixed and removable drives via PowerShell
 * (Get-CimInstance). Network drives are included too, but CD-ROM and
 * virtual drives are filtered out. Volumes without a letter can't be
 * addressed by users easily, so they're skipped.
 */
async function listMountsWindows(): Promise<DiskInfo[]> {
  const script =
    "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName," +
    "DriveType,FileSystem,Size,FreeSpace | ConvertTo-Json -Compress";
  let stdout: string;
  try {
    const { stdout: out } = await exec(`powershell -NoProfile -NonInteractive -Command "${script}"`);
    stdout = out.trim();
  } catch {
    return [];
  }

  if (!stdout || stdout === "null") return [];
  let raw: Array<Record<string, unknown>>;
  try {
    // Single object → wrap into array so both shapes work.
    const parsed: unknown = JSON.parse(stdout);
    raw = Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown>>)
      : [parsed as Record<string, unknown>];
  } catch {
    return [];
  }

  const num = (v: unknown): number =>
    typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10) || 0;

  const disks: DiskInfo[] = [];
  for (const d of raw) {
    const mount = String(d.DeviceID ?? ""); // e.g. "C:"
    if (!/^[A-Za-z]:$/.test(mount)) continue;

    const driveType = num(d.DriveType);
    // 2=removable, 3=fixed, 4=network. Skip 5 (CD-ROM) and others.
    if (driveType !== 2 && driveType !== 3 && driveType !== 4) continue;

    const total = num(d.Size);
    const free = num(d.FreeSpace);
    if (total <= 0) continue; // empty card reader / unmounted volume

    const fsType = String(d.FileSystem ?? "").trim() || "unknown";
    const writable = await probeWritable(mount + "\\");
    const label = String(d.VolumeName ?? "").trim();

    disks.push({
      mount,
      device: label ? `${mount} (${label})` : mount,
      fsType,
      totalBytes: total,
      usedBytes: Math.max(0, total - free),
      freeBytes: free,
      writable,
      readOnlyReason: writable ? null : readOnlyHint(fsType, mount),
    });
  }

  disks.sort((a, b) => b.mount.length - a.mount.length);
  return disks;
}

/** POSIX (Linux / macOS / BSD): parse /proc/mounts or `mount` output. */
async function listMountsPosix(): Promise<DiskInfo[]> {
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

  // macOS system volumes / recoverypaths that look like disks but aren't
  // sensible storage roots for user files.
  const SKIP_PREFIXES = [
    "/System/",
    "/private/",
    "/dev/",
  ];
  const SKIP_EXACT = new Set([
    "/dev", "/home", "/net", "/Network", "/Volumes",
  ]);

  const lines = mountsRaw.split("\n").filter(Boolean);
  const seen = new Set<string>();
  const disks: DiskInfo[] = [];

  for (const line of lines) {
    // /proc/mounts format: device mount-point fs-type options dump pass
    // macOS `mount` format: device on mount-point (fs-type, options…)
    let device: string, mount: string, fsType: string;
    let options = "";
    if (process.platform === "linux") {
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      [device, mount, fsType, options] = parts;
    } else {
      const m = line.match(/^(.+?)\s+on\s+(.+?)\s+\(([^)]+)\)/);
      if (!m) continue;
      [, device, mount, options] = m;
      fsType = options.split(",")[0]?.trim() ?? "";
    }

    // Decode octal escapes (/proc/mounts encodes spaces as \040 etc.)
    mount = mount.replace(/\\0(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));

    if (PSEUDO_FS.has(fsType)) continue;
    if (SKIP_EXACT.has(mount)) continue;
    if (SKIP_PREFIXES.some((p) => mount.startsWith(p))) continue;
    if (seen.has(mount)) continue;
    seen.add(mount);

    const optSet = new Set(
      options.split(",").map((o) => o.trim().toLowerCase()).filter(Boolean)
    );
    const flaggedRo = optSet.has("ro") || optSet.has("read-only");

    try {
      const stat = await fs.statfs(mount);
      const total = stat.blocks * stat.bsize;
      const free = stat.bavail * stat.bsize;
      const used = total - (stat.bfree * stat.bsize);

      let writable = !flaggedRo;
      let readOnlyReason: string | null = null;

      if (flaggedRo) {
        readOnlyReason = readOnlyHint(fsType, mount);
      } else {
        // Mount flags can lie (or omit ro); probe an actual write.
        writable = await probeWritable(mount);
        if (!writable) {
          readOnlyReason = readOnlyHint(fsType, mount);
        }
      }

      disks.push({
        mount,
        device,
        fsType,
        totalBytes: total,
        usedBytes: used,
        freeBytes: free,
        writable,
        readOnlyReason,
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
 * System directories that must never become a storage root.
 * Platform-aware: POSIX list vs Windows drive roots and system folders.
 */
function isForbiddenRoot(normalized: string): boolean {
  if (process.platform === "win32") {
    // The drive root itself (C:\) — too dangerous to store user data there
    // alongside the OS, and wiping it by accident would be catastrophic.
    if (/^[A-Za-z]:\\?$/.test(normalized)) return true;
    const forbiddenSegments = new Set([
      "windows", "program files", "program files (x86)",
      "programdata", "system volume information",
    ]);
    const segments = normalized.toLowerCase().split(/[\\/]+/).filter(Boolean);
    // Drive root (C:) or a top-level system folder are forbidden;
    // a nested folder like E:\archive\Users is fine.
    if (segments.length <= 1) return true; // drive root
    return forbiddenSegments.has(segments[1] ?? "");
  }
  const FORBIDDEN = new Set([
    "/", "/etc", "/usr", "/bin", "/sbin", "/var", "/boot", "/dev",
    "/proc", "/sys", "/lib", "/lib64", "/run", "/snap",
  ]);
  return FORBIDDEN.has(normalized);
}

/** Human-readable reason a volume can't be used for Doma storage. */
function readOnlyHint(fsType: string, mount: string): string {
  const ft = fsType.toLowerCase();
  if (process.platform === "win32") {
    if (ft === "" || ft === "unknown") {
      return "Том не отформатирован или файловая система не распознана.";
    }
    return "Диск только для чтения — проверьте защиту от записи или права доступа.";
  }
  if (ft === "ntfs" || ft.includes("ntfs")) {
    return "NTFS на macOS обычно только для чтения. Отформатируйте диск как APFS или exFAT в Дисковой утилите.";
  }
  if (mount.startsWith("/Volumes/")) {
    return "Том смонтирован только для чтения (извлеките и подключите снова, или проверьте Disk Utility).";
  }
  return "Файловая система только для чтения";
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
  let localRoot: string | null = null;
  try {
    const { getLocalStorageRoot } = await import("@/lib/storage");
    localRoot = await getLocalStorageRoot();
  } catch {
    localRoot = process.env.STORAGE_LOCAL_ROOT ?? path.join(process.cwd(), "storage-data");
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
    localRoot,
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
    const hint =
      process.platform === "win32"
        ? "Путь должен быть абсолютным (например, D:\\doma-storage)"
        : "Путь должен быть абсолютным (начинаться с /)";
    throw new Error(hint);
  }

  const normalized = path.resolve(candidate);
  if (isForbiddenRoot(normalized)) {
    throw new Error(`Нельзя использовать системную директорию: ${normalized}`);
  }

  try {
    const stat = await fs.stat(normalized);
    if (!stat.isDirectory()) {
      throw new Error("Указанный путь существует, но это не директория");
    }
    await fs.access(normalized, fs.constants.W_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Doesn't exist — check parent and create.
      const parent = path.dirname(normalized);
      try {
        await fs.stat(parent);
      } catch {
        throw new Error(`Родительская директория не существует: ${parent}`);
      }
      try {
        await fs.mkdir(normalized, { recursive: true });
      } catch (mkdirErr) {
        throw mapFsError(mkdirErr, normalized);
      }
    } else if (err instanceof Error && err.message.startsWith("Указанный")) {
      throw err;
    } else {
      throw mapFsError(err, normalized);
    }
  }
  return normalized;
}

function mapFsError(err: unknown, target: string): Error {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EROFS") {
    return new Error(
      `Диск только для чтения (${target}). На macOS NTFS почти всегда read-only — ` +
        `переформатируйте в APFS или exFAT через Дисковую утилиту, либо укажите другой том.`
    );
  }
  if (code === "EACCES" || code === "EPERM") {
    return new Error(`Нет прав на запись в ${target}`);
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
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
