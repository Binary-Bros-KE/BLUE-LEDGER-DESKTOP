import type { LogoRatio } from "@shared/types/logo";

/** Tailwind sizing classes for a logo preview box, shaped to match its declared aspect ratio so
 * wide/tall logos aren't cropped into a square. */
export function logoBoxClassName(ratio: LogoRatio | "" | null | undefined): string {
  if (ratio === "landscape") return "h-14 w-24";
  if (ratio === "portrait") return "h-20 w-14";
  return "size-16";
}

/** Same idea as logoBoxClassName, but sized for a tiny inline spot (e.g. the sidebar branch row). */
export function smallLogoBoxClassName(ratio: LogoRatio | "" | null | undefined): string {
  if (ratio === "landscape") return "h-4 w-7";
  if (ratio === "portrait") return "h-6 w-4";
  return "size-4";
}
