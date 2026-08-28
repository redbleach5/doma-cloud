/**
 * MIME helpers — guess type from filename and bucket into UI-friendly categories.
 */

import mime from "mime-types";

export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "code"
  | "markdown"
  | "office"
  | "archive"
  | "other";

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "py", "go", "rs", "java",
  "kt", "swift", "c", "h", "cpp", "hpp", "cc", "cs", "rb", "php", "sh", "bash",
  "zsh", "fish", "ps1", "sql", "yml", "yaml", "toml", "ini", "cfg", "dockerfile",
  "gitignore", "lua", "r", "scala", "clj", "ex", "exs", "erl", "hs", "ml",
  "elm", "vue", "svelte", "astro", "nix", "vim", "bat", "cmd",
]);

const OFFICE_EXT = new Set([
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf",
]);

const ARCHIVE_EXT = new Set([
  "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "tgz", "tbz2",
]);

export function guessMime(filename: string): string {
  const lower = filename.toLowerCase();
  // mime-types returns false for unknown — fall back to octet-stream.
  return mime.lookup(lower) || "application/octet-stream";
}

export function categorize(filename: string, mimeType?: string): FileCategory {
  const lower = filename.toLowerCase();
  const ext = lower.split(".").pop() ?? "";
  const mime = (mimeType ?? guessMime(filename)).toLowerCase();

  // Extension-based buckets before mime-prefix checks — mime-types maps .ts
  // to video/mp2t (MPEG Transport Stream), which would misclassify TypeScript.
  if (ext === "md" || ext === "markdown") return "markdown";
  if (CODE_EXT.has(ext)) return "code";
  if (OFFICE_EXT.has(ext)) return "office";
  if (ARCHIVE_EXT.has(ext)) return "archive";

  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (
    mime.startsWith("text/") ||
    [
      "txt", "log", "csv", "tsv", "ini", "cfg", "conf", "env", "gitignore",
      "editorconfig", "license", "readme",
    ].includes(ext)
  ) {
    return "text";
  }
  return "other";
}

/** Is this category previewable inline (no download required)? */
export function isPreviewable(category: FileCategory): boolean {
  return category !== "office" && category !== "archive" && category !== "other";
}
