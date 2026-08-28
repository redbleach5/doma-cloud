-- Add parentId+deletedAt index for shared-folder listing and descendant walks
-- that filter by parentId without ownerId.
CREATE INDEX IF NOT EXISTS "FileNode_parentId_deletedAt_idx" ON "FileNode"("parentId", "deletedAt");
