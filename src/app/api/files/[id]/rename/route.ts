import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { sanitizeName, resolveNodeAccess, hasPermission } from "@/lib/cloud/tree";
import { z } from "zod";

const BodySchema = z.object({ name: z.string().min(1).max(240) });

/**
 * PATCH — rename a file or folder.
 *
 * Authorization:
 *   - Owner: full control.
 *   - Shared recipient with `edit`: may rename nodes inside a shared folder,
 *     and may rename a directly shared *file* (the share root is the file).
 *     Folder share roots remain owner-only to rename.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Неверное имя" }, { status: 422 });
  }

  const access = await resolveNodeAccess(session.sub, id);
  if (!access || access.node.deletedAt) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  // Shared recipient must have edit permission. Folder share roots stay
  // owner-only; directly shared files may be renamed by the recipient.
  if (access.ctx.kind === "shared") {
    if (!hasPermission(access.ctx, "edit")) {
      return NextResponse.json(
        { error: "Недостаточно прав — нужна permission 'edit'" },
        { status: 403 }
      );
    }
    if (
      access.node.id === access.ctx.rootFolderId &&
      access.node.isDirectory
    ) {
      return NextResponse.json(
        { error: "Нельзя переименовать корень расшаренной папки — это может только владелец" },
        { status: 403 }
      );
    }
  }

  const newName = sanitizeName(parsed.data.name);
  // Avoid duplicate names in the same parent — check against the OWNER's
  // namespace (children of the parent belong to the owner, not the recipient).
  const dup = await db.fileNode.findFirst({
    where: {
      ownerId: access.node.ownerId,
      parentId: access.node.parentId,
      name: newName,
      id: { not: id },
      deletedAt: null,
    },
  });
  if (dup) {
    return NextResponse.json({ error: "Имя уже занято" }, { status: 409 });
  }

  await db.fileNode.update({ where: { id }, data: { name: newName } });
  return NextResponse.json({ ok: true, name: newName });
}
