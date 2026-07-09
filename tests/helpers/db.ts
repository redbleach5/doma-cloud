/**
 * Database test helpers.
 *
 * Provides:
 *   - resetDb()      — wipe all rows between tests for isolation
 *   - seedUser()     — create a user with sane defaults
 *   - seedFile()     — create a FileNode (file or directory)
 *   - seedShare()    — create a Share for a file
 *   - getTestDb()    — the shared PrismaClient for tests
 *
 * The test DB lives at prisma/test.db (see package.json `test` script).
 * It is created by `bun run test:setup` (prisma db push).
 */

import { db as libDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

// RE-USE the same PrismaClient instance the app uses (`@/lib/db`).
// `@/lib/db` caches the client on globalThis in non-production mode,
// so tests and API routes see the exact same connection — no lock
// conflicts, no stale reads.
export const db = libDb;

/** Wipe all rows from every table. Call in `beforeEach` for full isolation. */
export async function resetDb(): Promise<void> {
  // Order matters: delete shares first (FK → FileNode), then FileNode (FK → User), then User & Setting.
  // On SQLite TRUNCATE isn't available; DELETE is fast enough for tests.
  await db.share.deleteMany({});
  await db.fileNode.deleteMany({});
  await db.user.deleteMany({});
  await db.setting.deleteMany({});
}

export interface SeedUserInput {
  username?: string;
  displayName?: string;
  password?: string;
  role?: "admin" | "user";
  quotaBytes?: bigint;
  usedBytes?: bigint;
  birthday?: Date | null;
  tokenVersion?: number;
}

export interface SeedUserResult {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  passwordHash: string;
  quotaBytes: bigint;
  usedBytes: bigint;
  birthday: Date | null;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  // Convenience: the plaintext password (for login tests).
  password: string;
}

/** Create a user with sensible defaults. */
export async function seedUser(input: SeedUserInput = {}): Promise<SeedUserResult> {
  const username = input.username ?? `user-${Math.random().toString(36).slice(2, 10)}`;
  const password = input.password ?? "password123";
  const passwordHash = await hashPassword(password);
  const user = await db.user.create({
    data: {
      username,
      displayName: input.displayName ?? username,
      passwordHash,
      role: input.role ?? "user",
      quotaBytes: input.quotaBytes ?? 1024n * 1024n * 1024n * 100n, // 100 GB
      usedBytes: input.usedBytes ?? 0n,
      birthday: input.birthday ?? null,
      tokenVersion: input.tokenVersion ?? 0,
    },
  });
  return {
    ...user,
    role: user.role as "admin" | "user",
    password,
  };
}

export interface SeedFileInput {
  ownerId: string;
  parentId?: string | null;
  name?: string;
  isDirectory?: boolean;
  sizeBytes?: bigint;
  mimeType?: string;
  storageKey?: string;
  hashSha256?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

/** Create a FileNode (file or directory) for testing. */
export async function seedFile(input: SeedFileInput) {
  const isDirectory = input.isDirectory ?? false;
  const id = `file-${Math.random().toString(36).slice(2, 12)}`;
  return db.fileNode.create({
    data: {
      id,
      ownerId: input.ownerId,
      parentId: input.parentId ?? null,
      name: input.name ?? (isDirectory ? "folder" : "file.txt"),
      storageKey: input.storageKey ?? `${input.ownerId}/${id}/${input.name ?? "file.txt"}`,
      isDirectory,
      sizeBytes: input.sizeBytes ?? (isDirectory ? 0n : 100n),
      mimeType: input.mimeType ?? (isDirectory ? "inode/directory" : "text/plain"),
      hashSha256: input.hashSha256 ?? null,
      deletedAt: input.deletedAt ?? null,
      deletedBy: input.deletedBy ?? null,
    },
  });
}

export interface SeedShareInput {
  fileId: string;
  createdBy: string;
  token?: string;
  passwordHash?: string | null;
  expiresAt?: Date | null;
  maxViews?: number | null;
  oneTimeUse?: boolean;
  usedCount?: number;
}

/** Create a Share link for a file. */
export async function seedShare(input: SeedShareInput) {
  return db.share.create({
    data: {
      fileId: input.fileId,
      createdBy: input.createdBy,
      token: input.token ?? `tok-${Math.random().toString(36).slice(2, 26)}`,
      passwordHash: input.passwordHash ?? null,
      expiresAt: input.expiresAt ?? null,
      maxViews: input.maxViews ?? null,
      oneTimeUse: input.oneTimeUse ?? false,
      usedCount: input.usedCount ?? 0,
    },
  });
}

/** Create a session token for a user (for authenticated API tests). */
export async function makeSessionToken(user: {
  id: string;
  username: string;
  role: "admin" | "user";
  tokenVersion: number;
}): Promise<string> {
  const { signSession } = await import("@/lib/auth/session");
  return signSession({
    sub: user.id,
    username: user.username,
    role: user.role,
    ver: user.tokenVersion,
  });
}
