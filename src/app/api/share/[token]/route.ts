import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/session";
import { rateLimit, getClientIp, LIMITS } from "@/lib/auth/rate-limit";
import { categorize } from "@/lib/cloud/mime";
import { z } from "zod";

const BodySchema = z.object({
  password: z.string().max(200).optional(),
});

/** TTL for the verified-password cookie (24h). */
const VERIFIED_TTL = 60 * 60 * 24;

/** Cookie suffix hash — must match the one in download/[id]/route.ts. */
function hashSuffix(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * Verify a share link and return metadata for the public preview page.
 *
 * On successful password verification, sets a cookie so subsequent media
 * Range requests to /api/files/download/[id]?token=... don't need to
 * re-send the password.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Rate limit share password attempts — 20 per minute per IP+token.
  // This blocks brute-forcing the share password.
  const ip = getClientIp(req);
  const rl = rateLimit(`share:${ip}:${token}`, LIMITS.shareVerify.limit, LIMITS.shareVerify.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте через минуту." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const share = await db.share.findUnique({
    where: { token },
    include: { file: true },
  });
  if (!share) {
    return NextResponse.json({ error: "Ссылка не найдена" }, { status: 404 });
  }
  if (share.expiresAt && share.expiresAt < new Date()) {
    return NextResponse.json({ error: "Срок действия истёк" }, { status: 410 });
  }
  if (share.maxViews && share.usedCount >= share.maxViews) {
    return NextResponse.json({ error: "Лимит просмотров исчерпан" }, { status: 410 });
  }

  // #4 — Don't serve shares for trashed files.
  if (share.file.deletedAt) {
    return NextResponse.json({ error: "Файл больше не доступен" }, { status: 410 });
  }

  // If password-protected, verify it.
  let passwordVerified = false;
  if (share.passwordHash) {
    // Check if the caller already has a valid verified cookie for this share.
    const suffix = hashSuffix(share.token);
    const existingCookie = req.cookies.get(`doma_sv_${suffix}`)?.value;
    if (existingCookie === "1") {
      passwordVerified = true;
    } else {
      const body = await req.json().catch(() => ({}));
      const parsed = BodySchema.safeParse(body);
      if (!parsed.success || !parsed.data.password) {
        return NextResponse.json(
          { error: "Требуется пароль", needsPassword: true },
          { status: 401 }
        );
      }
      const ok = await verifyPassword(parsed.data.password, share.passwordHash);
      if (!ok) {
        return NextResponse.json({ error: "Неверный пароль" }, { status: 403 });
      }
      passwordVerified = true;
    }
  }

  const file = share.file;

  // #6 — ATOMIC check-and-increment to prevent race conditions.
  // The original code did check-then-increment in two separate queries,
  // so N parallel requests could all pass the maxViews check before any
  // increment ran — resulting in usedCount exceeding maxViews.
  //
  // This conditional UPDATE is atomic in SQLite: it only increments if
  // usedCount < maxViews (or maxViews is NULL). If 0 rows are affected,
  // the limit was hit between our check and now — return 410.
  if (share.maxViews !== null) {
    const result = await db.$executeRaw`
      UPDATE Share
      SET usedCount = usedCount + 1
      WHERE id = ${share.id}
        AND usedCount < ${share.maxViews}
    `;
    if (result === 0) {
      // Another request grabbed the last view between our check and now.
      return NextResponse.json({ error: "Лимит просмотров исчерпан" }, { status: 410 });
    }
  } else {
    // No maxViews limit — just increment.
    await db.share.update({
      where: { id: share.id },
      data: { usedCount: { increment: 1 } },
    });
  }

  // #2 — ONE-TIME USE. After incrementing, delete the share so it can
  // never be opened again. The current response still returns the file
  // metadata + download URL, so the current viewer can access the file —
  // but nobody else can.
  if (share.oneTimeUse) {
    await db.share.delete({ where: { id: share.id } }).catch(() => undefined);
  }

  const response = NextResponse.json({
    file: {
      id: file.id,
      name: file.name,
      sizeBytes: file.sizeBytes.toString(),
      mimeType: file.mimeType,
      category: categorize(file.name, file.mimeType),
    },
    share: {
      expiresAt: share.expiresAt,
      maxViews: share.maxViews,
      usedCount: share.usedCount + 1, // reflect the increment we just did
      hasPassword: !!share.passwordHash,
    },
    downloadUrl: `/api/files/download/${file.id}?token=${share.token}`,
  });

  // If we just verified the password (or the share has none), set the
  // verified cookie so subsequent Range requests pass through.
  if (passwordVerified || !share.passwordHash) {
    const suffix = hashSuffix(share.token);
    response.cookies.set(`doma_sv_${suffix}`, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: VERIFIED_TTL,
    });
  }

  return response;
}
