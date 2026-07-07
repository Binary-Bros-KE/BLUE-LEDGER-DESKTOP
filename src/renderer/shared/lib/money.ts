/** Converts a decimal amount string (e.g. "250.50") typed by the user into integer cents. Empty/invalid input becomes 0. */
export function toCents(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

/** Converts integer cents into a decimal string suitable for a text input, e.g. 25050 -> "250.50". */
export function fromCents(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

/** Formats integer cents for display, e.g. 25050 -> "250.50". Always 2 decimal places, no currency symbol. */
export function formatCents(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "—";
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
