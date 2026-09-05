-- Drop the hardcoded 50 GB Prisma default for User.quotaBytes.
-- The application always sets quota explicitly from settings.defaultQuotaBytes
-- on user creation; a schema default of 0 is only a placeholder.
-- Existing rows are unchanged — this only affects the column default for
-- future inserts that somehow omit quotaBytes.

-- SQLite cannot ALTER COLUMN defaults in-place; Prisma syncs the default via
-- schema. This migration is a no-op marker so `prisma migrate` history matches
-- schema.prisma after @default(53687091200) → @default(0).
SELECT 1;
