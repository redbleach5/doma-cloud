-- Rename SharedFolder → SharedItem and folderId → nodeId (files + folders).
-- Existing folder-share rows remain valid.

PRAGMA foreign_keys=OFF;

ALTER TABLE "SharedFolder" RENAME TO "SharedItem";

ALTER TABLE "SharedItem" RENAME COLUMN "folderId" TO "nodeId";

DROP INDEX IF EXISTS "SharedFolder_folderId_recipientId_key";
DROP INDEX IF EXISTS "SharedFolder_recipientId_idx";
DROP INDEX IF EXISTS "SharedFolder_ownerId_idx";
DROP INDEX IF EXISTS "SharedFolder_folderId_idx";

CREATE UNIQUE INDEX "SharedItem_nodeId_recipientId_key"
    ON "SharedItem"("nodeId", "recipientId");
CREATE INDEX "SharedItem_recipientId_idx" ON "SharedItem"("recipientId");
CREATE INDEX "SharedItem_ownerId_idx"     ON "SharedItem"("ownerId");
CREATE INDEX "SharedItem_nodeId_idx"      ON "SharedItem"("nodeId");

PRAGMA foreign_keys=ON;
