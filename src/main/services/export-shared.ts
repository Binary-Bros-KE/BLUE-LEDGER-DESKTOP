/** Small helpers shared by export-service.ts (flat-list exports) and report-export-service.ts
 * (multi-section report exports) — kept in one place so the two never drift. */

export const BRAND_NAVY = "#061e64";
export const BRAND_TEAL = "#0e7a5a";
export const BRAND_DANGER = "#ad3a29";
export const BRAND_SUCCESS = "#15915f";
export const BRAND_WARNING = "#c1791f";
export const BRAND_GOLD = "#83795f";
export const BRAND_BORDER = "#ddd5c2";
export const BRAND_SOFT = "#f1ede1";
export const INK = "#1c1710";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Appends a to-the-second timestamp so repeated exports (e.g. re-exporting after tweaking a
 * filter) never collide on the same default file name — without this, the save dialog reprompts
 * "file already exists" on every export in the same day. */
export function timestampedFileName(baseName: string, extension: string): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${baseName}_${stamp}.${extension}`;
}

export function generatedAtLabel(): string {
  return new Date().toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}
