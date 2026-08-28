import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { rateLimit, LIMITS } from "@/lib/auth/rate-limit";

/**
 * DELETE — revoke (permanently delete) a share link.
 *
 * The share must belong to a file owned by the authenticated user.
 * Cascading cleanup of the doma_sv_<hash> cookie is not possible from
 * the server (cookies are scoped per-path), but the cookie becomes
 * harmless once the share row is gone — every subsequent request
 * that relies on it will 404 at POST /api/share/[token] and 401 at
 * the download endpoint.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; token: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id, token } = await params;

  // Rate limit — 10 revokes/min per user.
  const rl = rateLimit(`share-revoke:${session.sub}`, LIMITS.shareCreate.limit, LIMITS.shareCreate.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте позже." },
      { status: 429 }
    );
  }

  // Confirm the file belongs to the caller (so users can't revoke
  // shares on files they don't own by guessing token + id pairs).
  const file = await db.fileNode.findFirst({
    where: { id, ownerId: session.sub },
    select: { id: true },
  });
  if (!file) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  // Find the share by token — it must be associated with this file.
  // The createdBy check is a defence-in-depth: even if a token ever
  // collided across files, only the original creator can revoke.
  const share = await db.share.findUnique({
    where: { token },
    select: { id: true, nodeId: true, createdBy: true },
  });
  if (!share || share.nodeId !== id || share.createdBy !== session.sub) {
    return NextResponse.json({ error: "Ссылка не найдена" }, { status: 404 });
  }

  await db.share.delete({ where: { id: share.id } });

  return NextResponse.json({ ok: true });
}
