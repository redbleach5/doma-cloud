-- Video metadata populated by ffprobe (best-effort, nullable for non-video
-- files and for videos probed before the columns existed).
ALTER TABLE "FileNode" ADD COLUMN "videoCodec" TEXT;
ALTER TABLE "FileNode" ADD COLUMN "videoWidth" INTEGER;
ALTER TABLE "FileNode" ADD COLUMN "videoHeight" INTEGER;
ALTER TABLE "FileNode" ADD COLUMN "durationMs" INTEGER;