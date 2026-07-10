import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/session";
import { rateLimit, getClientIp, LIMITS } from "@/lib/auth/rate-limit";
import { categorize } from "@/lib/cloud/mime";
import { z } from "zod";
import { shareCookieHashSuffix } from "@/app/api/files/download/[id]/route";

const BodySchema = z.object({
  password: z.string().max(200).optional(),
});

/** TTL for the verified-password cookie (24h). */
const VERIFIED_TTL = 60 * 60 * 24;

/** TTL for the granted-slot cookie (10 min) — short, just long enough to download. */
const SLOT_TTL = 60 * 10;

function isSecureCookie(): boolean {
  return (
    process.env.NODE_ENV === "production" && process.env.DOMA_INSECURE_COOKIE !== "1"
  );
}

/**
 * Verify a share link and return metadata for the public preview page.
 *
 * On successful password verification, sets a cookie so subsequent media
 * Range requests to /api/files/download/[id]?token=... don't need to
 * re-send the password.
 *
 * maxViews / oneTimeUse enforcement:
 *   - We do NOT delete the share on oneTimeUse. Instead we treat oneTimeUse
 *     as maxViews=1 if maxViews is null, and use the same atomic conditional
 *     UPDATE on `usedCount`. This lets the granted viewer actually download
 *     the file (the previous implementation deleted the share before the
 *     download started, so the download route returned 403).
 *   - The atomic UPDATE (`usedCount = usedCount + 1 WHERE usedCount < maxViews`)
 *     prevents the race where N parallel requests all pass the check before
 *     any increment runs.
 *   - After granting the slot, we set a short-lived `doma_sd_<hash>` cookie
 *     that the download route can check IF we ever need to re-validate
 *     (currently unused — see download route for the rationale).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Rate limit share password attempts — 20 per minute per IP+token.
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

  // Don't serve shares for trashed files.
  if (share.file.deletedAt) {
    return NextResponse.json({ error: "Файл больше не доступен" }, { status: 410 });
  }

  // Effective view cap — oneTimeUse acts as maxViews=1 when maxViews is null.
  const effectiveMaxViews = share.oneTimeUse
    ? (share.maxViews ?? 1)
    : share.maxViews;

  // Pre-check (cheap path) — if the limit is already reached, return 410
  // without doing the password verify work.
  if (effectiveMaxViews !== null && share.usedCount >= effectiveMaxViews) {
    return NextResponse.json({ error: "Лимит просмотров исчерпан" }, { status: 410 });
  }

  // If password-protected, verify it.
  let passwordVerified = false;
  if (share.passwordHash) {
    const suffix = shareCookieHashSuffix(share.token);
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

  // ATOMIC check-and-increment to prevent race conditions on maxViews.
  //
  // The previous code did check-then-increment in two separate queries, so N
  // parallel requests could all pass the maxViews check before any increment
  // ran — resulting in usedCount exceeding maxViews.
  //
  // This conditional UPDATE is atomic in SQLite: it only increments if
  // usedCount < effectiveMaxViews. If 0 rows are affected, the limit was hit
  // between our pre-check and now — return 410.
  if (effectiveMaxViews !== null) {
    const result = await db.$executeRaw`
      UPDATE Share
      SET usedCount = usedCount + 1
      WHERE id = ${share.id}
        AND usedCount < ${effectiveMaxViews}
    `;
    if (result === 0) {
      return NextResponse.json({ error: "Лимит просмотров исчерпан" }, { status: 410 });
    }
  } else {
    await db.share.update({
      where: { id: share.id },
      data: { usedCount: { increment: 1 } },
    });
  }

  // NOTE: we deliberately do NOT delete the share on oneTimeUse. The download
  // route re-reads the share row to check expiry / password cookie, and if the
  // row is gone it returns 403 — which meant oneTimeUse shares could be
  // verified but never actually downloaded. The atomic increment above is
  // sufficient: a second verify attempt will hit `usedCount >= effectiveMaxViews`
  // and return 410.

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
      maxViews: effectiveMaxViews,
      usedCount: share.usedCount + 1, // reflect the increment we just did
      hasPassword: !!share.passwordHash,
    },
    downloadUrl: `/api/files/download/${file.id}?token=${share.token}`,
  });

  // Set the verified-password cookie (or no-password marker) so subsequent
  // Range requests pass through without re-sending the password.
  if (passwordVerified || !share.passwordHash) {
    const suffix = shareCookieHashSuffix(share.token);
    response.cookies.set(`doma_sv_${suffix}`, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureCookie(),
      path: "/",
      maxAge: VERIFIED_TTL,
    });
  }

  return response;
}
