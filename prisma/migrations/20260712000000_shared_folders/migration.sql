-- Doma Cloud migration: shared folders + share model renames
--
-- This migration:
--   1. Renames Share.fileId → Share.nodeId (relation name change too).
--   2. Renames the Share→User back-relation from `user` to `creator`.
--   3. Adds optional `Share.label` for user-defined share notes.
--   4. Adds the new `SharedFolder` model (Google-Drive-style folder sharing
--      with a specific recipient + permission).
--   5. Adds supporting indexes (Share.expiresAt for cleanup cron,
--      Share.createdBy for "my links" list).
--
-- Safe to run on a populated DB: no data is lost, only renamed/extended.

-- ---------------------------------------------------------------------------
-- Step 1: rename Share.fileId → Share.nodeId
-- ---------------------------------------------------------------------------
-- SQLite supports `ALTER TABLE ... RENAME COLUMN` since 3.25.0.
ALTER TABLE "Share" RENAME COLUMN "fileId" TO "nodeId";

-- Step 2: rename the Share→User back-relation.
-- Prisma stores relation names in the _prisma_migrations metadata; renaming
-- the relation field doesn't change the DB schema for SQLite (the FK is on
-- `createdBy`, which already exists). So no DDL needed — only the Prisma
-- client picks up the new field name.

-- Step 3: add optional `label` column (NULL for existing rows).
ALTER TABLE "Share" ADD COLUMN "label" TEXT;

-- Step 4: create the SharedFolder table.
CREATE TABLE "SharedFolder" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "folderId"    TEXT NOT NULL,
    "ownerId"     TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "permission"  TEXT NOT NULL DEFAULT 'view',
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY ("folderId")    REFERENCES "FileNode"("id") ON DELETE CASCADE,
    FOREIGN KEY ("ownerId")     REFERENCES "User"("id")     ON DELETE CASCADE,
    FOREIGN KEY ("recipientId") REFERENCES "User"("id")     ON DELETE CASCADE
);

-- Unique constraint: one share per (folder, recipient) pair.
CREATE UNIQUE INDEX "SharedFolder_folderId_recipientId_key"
    ON "SharedFolder"("folderId", "recipientId");

-- Lookup indexes for the three main query patterns.
CREATE INDEX "SharedFolder_recipientId_idx" ON "SharedFolder"("recipientId");
CREATE INDEX "SharedFolder_ownerId_idx"     ON "SharedFolder"("ownerId");
CREATE INDEX "SharedFolder_folderId_idx"    ON "SharedFolder"("folderId");

-- ---------------------------------------------------------------------------
-- Step 5: supporting indexes on Share (cleanup cron + "my links" list)
-- ---------------------------------------------------------------------------
CREATE INDEX "Share_nodeId_idx"     ON "Share"("nodeId");
CREATE INDEX "Share_expiresAt_idx"  ON "Share"("expiresAt");
CREATE INDEX "Share_createdBy_idx"  ON "Share"("createdBy");

-- Drop the old index on the renamed column (best-effort — ignore if missing).
DROP INDEX IF EXISTS "Share_fileId_idx";
