import { NextRequest, NextResponse } from "next/server";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { getSession } from "@/lib/auth/session";
import { getStorage } from "@/lib/storage";
import { rateLimit, getClientIp, LIMITS } from "@/lib/auth/rate-limit";
import { resolveNodeAccess } from "@/lib/cloud/tree";

const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

/**
 * POST /api/files/zip — stream a zip of accessible files.
 *
 * Accepts:
 *   - JSON `{ ids: string[] }`
 *   - form `ids=id1,id2,...` (browser form download — no JS blob buffer)
 *
 * Directories are rejected. Auth via session cookie (works with form POST).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const ip = getClientIp(req);
  const rl = rateLimit(`download:${ip}`, LIMITS.download.limit, LIMITS.download.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте позже." },
      { status: 429 }
    );
  }

  const ids = await parseIds(req);
  if (!ids) {
    return NextResponse.json({ error: "Укажите ids (JSON массив или form ids=a,b)" }, { status: 400 });
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: "Список файлов пуст" }, { status: 400 });
  }
  if (ids.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Слишком много файлов (макс. ${MAX_FILES})` },
      { status: 413 }
    );
  }

  const uniqueIds = [...new Set(ids)];
  const files: Array<{ id: string; name: string; storageKey: string; sizeBytes: bigint }> = [];
  let total = 0n;

  for (const id of uniqueIds) {
    const access = await resolveNodeAccess(session.sub, id);
    if (!access || access.node.deletedAt) {
      return NextResponse.json({ error: "Файл недоступен" }, { status: 404 });
    }
    if (access.node.isDirectory) {
      return NextResponse.json(
        { error: "Папки в архив не входят — выберите только файлы" },
        { status: 400 }
      );
    }
    total += access.node.sizeBytes;
    if (total > BigInt(MAX_TOTAL_BYTES)) {
      return NextResponse.json({ error: "Слишком большой объём для архива" }, { status: 413 });
    }
    files.push({
      id: access.node.id,
      name: access.node.name,
      storageKey: access.node.storageKey,
      sizeBytes: access.node.sizeBytes,
    });
  }

  const storage = await getStorage();
  const passthrough = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 5 } });

  archive.on("error", (err) => {
    passthrough.destroy(err);
  });
  archive.pipe(passthrough);

  const usedNames = new Map<string, number>();
  const uniqueName = (name: string) => {
    const n = usedNames.get(name) ?? 0;
    usedNames.set(name, n + 1);
    if (n === 0) return name;
    const dot = name.lastIndexOf(".");
    if (dot > 0) return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
    return `${name} (${n})`;
  };

  (async () => {
    try {
      for (const f of files) {
        const stream = await storage.get(f.storageKey);
        archive.append(stream, { name: uniqueName(f.name) });
      }
      await archive.finalize();
    } catch (err) {
      archive.abort();
      passthrough.destroy(err instanceof Error ? err : new Error("zip failed"));
    }
  })();

  const webStream = Readable.toWeb(passthrough) as ReadableStream;
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="doma-${stamp}.zip"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function parseIds(req: NextRequest): Promise<string[] | null> {
  const ct = req.headers.get("content-type") ?? "";

  if (ct.includes("application/json")) {
    try {
      const body = await req.json();
      const ids = (body as { ids?: unknown })?.ids;
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return null;
      return ids;
    } catch {
      return null;
    }
  }

  // form-urlencoded / multipart from browser form download
  try {
    const form = await req.formData();
    const raw = form.get("ids");
    if (typeof raw !== "string" || !raw.trim()) return null;
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}
