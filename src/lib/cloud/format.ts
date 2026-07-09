/**
 * Helpers for human-friendly file size and date formatting.
 */

export function formatBytes(bytes: number | bigint | string): string {
  const n = typeof bytes === "bigint" ? Number(bytes) : Number(bytes);
  if (!isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} Б`;
  const units = ["КБ", "МБ", "ГБ", "ТБ", "ПБ"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length);
  const val = n / Math.pow(1024, i);
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i - 1]}`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "только что";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} дн назад`;
  if (day < 30) return `${Math.floor(day / 7)} нед назад`;
  return formatDate(d);
}
