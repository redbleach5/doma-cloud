/**
 * User lookup helpers.
 *
 * SQLite string comparison is case-sensitive by default, so Prisma's
 * `mode: "insensitive"` is unavailable. Use `lower()` for username lookups.
 */

import { db } from "@/lib/db";
import type { User } from "@prisma/client";

/** Find a user by username, case-insensitively. */
export async function findUserByUsername(
  username: string
): Promise<User | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM User WHERE lower(username) = lower(${username}) LIMIT 1
  `;
  if (!rows[0]) return null;
  return db.user.findUnique({ where: { id: rows[0].id } });
}

/** True if any user already owns this username (case-insensitive). */
export async function isUsernameTaken(username: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM User WHERE lower(username) = lower(${username}) LIMIT 1
  `;
  return rows.length > 0;
}
