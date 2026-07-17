/**
 * Chart color tokens for Blue Ledger reports, derived per the dataviz method:
 * sequential = the app's own accent blue (single hue, magnitude only, never a
 * per-bar gradient on nominal categories); categorical = the validated 8-hue
 * default order, confirmed against this app's real surface color
 * (`node scripts/validate_palette.js "…" --mode light --surface "#fffdf7"`) —
 * all six checks pass; three light-mode slots sit below 3:1 contrast, so
 * every categorical chart here ships direct value labels + a table view
 * alongside the color (the required "relief" channel).
 */
export const CHART_SEQUENTIAL_HUE = "#2b5fd9"; // matches --color-accent
export const CHART_SEQUENTIAL_HUE_SOFT = "rgba(43, 95, 217, 0.12)"; // area wash / track

export const CHART_CATEGORICAL_PALETTE = [
  "#2a78d6", // blue
  "#008300", // green
  "#e87ba4", // magenta
  "#eda100", // yellow
  "#1baf7a", // aqua
  "#eb6834", // orange
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

export const CHART_GRIDLINE = "#ddd5c2"; // --color-line, one step off the app surface
export const CHART_AXIS_TEXT = "#83795f"; // --color-muted

export function categoricalColor(index: number): string {
  return CHART_CATEGORICAL_PALETTE[index % CHART_CATEGORICAL_PALETTE.length] ?? CHART_SEQUENTIAL_HUE;
}
