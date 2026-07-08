import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

async function enableWal(prisma: PrismaClient) {
  // WAL mode = concurrent readers + one writer. Without this, SQLite locks
  // the whole DB during writes, which would make the UI freeze while a
  // family member uploads a video.
  // busy_timeout = 5s — wait instead of immediately throwing "database is locked".
  // synchronous = NORMAL — safe with WAL, much faster than FULL.
  try {
    // PRAGMA journal_mode returns a row — use $queryRawUnsafe, not $executeRawUnsafe.
    await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
    await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL");
    await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON");
  } catch (err) {
    console.error("[db] Failed to set SQLite pragmas:", err);
  }
}

export const db = globalForPrisma.prisma ?? new PrismaClient({ log: ["error", "warn"] });

if (!globalForPrisma.prisma) {
  enableWal(db);
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
