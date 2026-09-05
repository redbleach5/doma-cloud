import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/session";
import { rateLimit, getClientIp, LIMITS } from "@/lib/auth/rate-limit";
import { categorize } from "@/lib/cloud/mime";
import { z } from "zod";
import { shareVerifiedCookieKey, shareViewedCookieKey, shareEffectiveMaxViews } from "@/lib/auth/share-cookie";

const BodySchema = z.object({
  password: z.string().max(200).optional(),
});

/** TTL for the verified-password cookie (24h). */
const VERIFIED_TTL = 60 * 60 * 24;

/**
 * TTL for the "viewed" cookie. Once a browser has viewed a share, re-loads
 * of the public page within this window do NOT increment usedCount. This
 * fixes the bug where refreshing the page 5 times burned all 5 maxViews
 * without the user ever actually downloading anything.
 *
 * The previous "verified" cookie already had a 24h TTL, but it was set
 * unconditionally (even for non-password shares) AND did not prevent the
 * usedCount increment — it only suppressed the password prompt. We now use
 * a separate `doma_svd_<hash>` ("share viewed") cookie that the increment
 * path checks before bumping usedCount.
 */
const VIEWED_TTL = 60 * 60 * 24; // 24h

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
 *     UPDATE on `usedCount`.
 *   - The atomic UPDATE (`usedCount = usedCount + 1 WHERE usedCount < maxViews`)
 *     prevents the race where N parallel requests all pass the check before
 *     any increment runs.
 *   - Refresh-safe: if the browser already has the `doma_svd_<hash>` cookie
 *     (set on first successful verify), the usedCount is NOT incremented
 *     again within the VIEWED_TTL window. This fixes the bug where refreshing
 *     the share page 5 times burned all 5 maxViews.
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
    include: { node: true },
  });
  if (!share) {
    return NextResponse.json({ error: "Ссылка не найдена" }, { status: 404 });
  }
  if (share.expiresAt && share.expiresAt < new Date()) {
    return NextResponse.json({ error: "Срок действия истёк" }, { status: 410 });
  }

  // Don't serve shares for trashed files.
  if (share.node.deletedAt) {
    return NextResponse.json({ error: "Файл больше не доступен" }, { status: 410 });
  }

  // Effective view cap — oneTimeUse acts as maxViews=1 when maxViews is null.
  const effectiveMaxViews = shareEffectiveMaxViews(share);

  // Pre-check (cheap path) — if the limit is already reached, return 410
  // without doing the password verify work.
  if (effectiveMaxViews !== null && share.usedCount >= effectiveMaxViews) {
    return NextResponse.json({ error: "Лимит просмотров исчерпан" }, { status: 410 });
  }

  // If password-protected, verify it.
  let passwordVerified = false;
  if (share.passwordHash) {
    const cookieKey = shareVerifiedCookieKey(share.token);
    const existingCookie = req.cookies.get(cookieKey)?.value;
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

  const file = share.node;

  // ---- Refresh-safe usedCount increment ----
  //
  // If this browser has already viewed the share within VIEWED_TTL, do NOT
  // increment usedCount again. This prevents the bug where a single user
  // refreshing the page 5 times burned all 5 maxViews without downloading
  // anything.
  //
  // We still return the share metadata + download URL — the user just
  // doesn't consume a new "view slot" on every refresh.
  const viewedCookieKey = shareViewedCookieKey(share.token);
  const alreadyViewed = req.cookies.get(viewedCookieKey)?.value === "1";
  let newUsedCount = share.usedCount;

  if (!alreadyViewed) {
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
    newUsedCount = share.usedCount + 1;
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
      maxViews: effectiveMaxViews,
      usedCount: newUsedCount,
      hasPassword: !!share.passwordHash,
    },
    downloadUrl: `/api/files/download/${file.id}?token=${share.token}`,
  });

  // Set the verified-password cookie (or no-password marker) so subsequent
  // Range requests pass through without re-sending the password.
  // Scope the cookie to /api/ to avoid sending it on every app request.
  if (passwordVerified || !share.passwordHash) {
    const cookieKey = shareVerifiedCookieKey(share.token);
    response.cookies.set(cookieKey, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureCookie(),
      path: "/api/",
      maxAge: VERIFIED_TTL,
    });
  }

  // Always set the "viewed" cookie after a successful verify so refreshes
  // don't re-increment usedCount. Same /api/ scope.
  response.cookies.set(viewedCookieKey, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookie(),
    path: "/api/",
    maxAge: VIEWED_TTL,
  });

  return response;
}
