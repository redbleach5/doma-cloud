import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  resolveNodeAccess,
  resolveFolderAccess,
  hasPermission,
} from "@/lib/cloud/tree";
import { z } from "zod";

/**
 * PATCH /api/files/[id]/move — move a file or folder into a different parent.
 *
 * Body: { parentId: string | null, sharedFolderId?: string }
 *   - null → move to root (owner) or to the share root (shared recipient)
 *   - string → move into the folder with this id
 *
 * Authorization:
 *   - Owner: full control over their own nodes.
 *   - Shared recipient with at least `upload` permission: may rearrange
 *     nodes INSIDE the shared subtree (but not the share root itself, and
 *     never outside the share).
 *
 * Cycle protection: refuses to move a folder into itself or any of its
 * descendants (same deletedAt timestamp for the whole subtree).
 *
 * Name collisions: if a non-trashed node with the same name already
 * exists in the destination, returns 409 (no silent overwrite).
 */
const BodySchema = z.object({
  parentId: z.string().nullable(),
  sharedFolderId: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Неверные параметры" }, { status: 422 });
  }
  const requestedParentId = parsed.data.parentId;

  const access = await resolveNodeAccess(session.sub, id);
  if (!access || access.node.deletedAt) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }

  const { node, ctx } = access;
  const ownerId = node.ownerId;

  // Resolve the effective destination parent, enforcing share boundaries.
  let effectiveParentId: string | null;
  if (ctx.kind === "shared") {
    if (!hasPermission(ctx, "upload")) {
      return NextResponse.json(
        { error: "Недостаточно прав — нужна permission 'upload' или 'edit'" },
        { status: 403 }
      );
    }
    // Recipients must not move the share root itself.
    if (node.id === ctx.rootFolderId) {
      return NextResponse.json(
        { error: "Нельзя переместить корень расшаренной папки — это может только владелец" },
        { status: 403 }
      );
    }

    if (requestedParentId === null) {
      effectiveParentId = ctx.rootFolderId;
    } else {
      const dest = await resolveFolderAccess(session.sub, requestedParentId);
      if (
        !dest ||
        dest.kind !== "shared" ||
        dest.rootFolderId !== ctx.rootFolderId
      ) {
        return NextResponse.json(
          { error: "Целевая папка вне области доступа" },
          { status: 403 }
        );
      }
      if (!hasPermission(dest, "upload")) {
        return NextResponse.json(
          { error: "Недостаточно прав на целевую папку" },
          { status: 403 }
        );
      }
      effectiveParentId = requestedParentId;
    }
  } else {
    // Owner path — destination must also belong to the caller (checked
    // inside the transaction below for non-null parents).
    effectiveParentId = requestedParentId;
  }

  // No-op move — same parent.
  if (effectiveParentId === node.parentId) {
    return NextResponse.json({ ok: true, moved: false });
  }

  // Wrap the cycle check + collision check + share re-check + update in a
  // single transaction. Without this, two concurrent moves could each pass
  // the cycle check and together create a cycle, or both pass the collision
  // check and the second one would silently overwrite. SQLite's serialised
  // writes inside a transaction make the check-then-update atomic.
  //
  // We ALSO re-check the SharedFolder row inside the transaction for shared
  // moves — the owner may have revoked the share between the outer
  // resolveNodeAccess call and now (TOCTOU). Without this re-check the
  // recipient's move would succeed against a revoked share.
  try {
    await db.$transaction(async (tx) => {
      // Shared-recipient move: re-verify the share still exists.
      if (ctx.kind === "shared") {
        const share = await tx.sharedItem.findFirst({
          where: { nodeId: ctx.rootFolderId, recipientId: session.sub },
          select: { id: true, permission: true },
        });
        if (!share) {
          throw new MoveError(403, "Поделиться больше не доступно");
        }
        if (share.permission !== "upload" && share.permission !== "edit") {
          throw new MoveError(403, "Недостаточно прав — нужна permission 'upload' или 'edit'");
        }
      }

      // Re-validate destination parent INSIDE the transaction.
      if (effectiveParentId !== null) {
        const parent = await tx.fileNode.findFirst({
          where: {
            id: effectiveParentId,
            ownerId,
            deletedAt: null,
          },
          select: { id: true, isDirectory: true },
        });
        if (!parent) {
          throw new MoveError(404, "Целевая папка не найдена");
        }
        if (!parent.isDirectory) {
          throw new MoveError(422, "Целевой узел не является папкой");
        }

        // Cycle protection: walk up the destination's ancestor chain.
        if (node.isDirectory) {
          let cursor: string | null = effectiveParentId;
          while (cursor !== null) {
            if (cursor === id) {
              throw new MoveError(
                422,
                "Нельзя переместить папку внутрь себя или её потомка"
              );
            }
            const ancestor = await tx.fileNode.findUnique({
              where: { id: cursor },
              select: { parentId: true },
            });
            cursor = ancestor?.parentId ?? null;
          }
        }
      }

      // Name-collision check (re-run inside the transaction).
      const sibling = await tx.fileNode.findFirst({
        where: {
          ownerId,
          parentId: effectiveParentId,
          name: node.name,
          deletedAt: null,
          id: { not: id },
        },
        select: { id: true },
      });
      if (sibling) {
        throw new MoveError(409, `В целевой папке уже есть «${node.name}»`);
      }

      await tx.fileNode.update({
        where: { id },
        data: { parentId: effectiveParentId },
      });
    });
  } catch (err) {
    if (err instanceof MoveError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  return NextResponse.json({ ok: true, moved: true });
}

class MoveError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "MoveError";
  }
}
