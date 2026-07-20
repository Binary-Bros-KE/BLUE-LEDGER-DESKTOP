import type { PermissionModuleKey } from "@shared/types/role";

export type ReportCardTone = "primary" | "teal" | "danger" | "success" | "warning";

/** A colorful headline figure, styled like the on-screen OverviewCard — the caller pre-formats
 * everything (currency symbols, percentages) since the renderer just lays strings out. */
export type ReportExportCard = {
  label: string;
  value: string;
  caption?: string;
  tone: ReportCardTone;
};

/** A plain white KPI tile, styled like the on-screen ReportStatTile. */
export type ReportExportTile = {
  label: string;
  value: string;
};

/** One row of a horizontal progress-bar comparison — `percent` (0-100) is precomputed by the
 * caller from `value / max(values) * 100`, matching how HorizontalBarList sizes its bars. */
export type ReportExportBarItem = {
  label: string;
  sublabel?: string;
  value: string;
  percent: number;
  /** Omit for a single-hue magnitude bar (the default); pass a hex color per item for a
   * categorical comparison (e.g. payment methods), matching HorizontalBarList's two modes. */
  color?: string;
};

export type ReportExportColumn = { key: string; header: string; align?: "left" | "right" | "center" };

/** `_tone` highlights the row (e.g. an overdue invoice, a low-stock product) the same way the
 * on-screen table tints it with a danger/warning background. */
export type ReportExportTableRow = Record<string, string> & { _tone?: "danger" | "warning" };

export type ReportExportSection =
  | { type: "cards"; title?: string; cards: ReportExportCard[] }
  | { type: "tiles"; title?: string; tiles: ReportExportTile[] }
  | { type: "bars"; title: string; description?: string; items: ReportExportBarItem[] }
  | {
      type: "table";
      title: string;
      description?: string;
      columns: ReportExportColumn[];
      rows: ReportExportTableRow[];
    };

/**
 * A whole report page's worth of sections — richer than ExportListRequest (a single flat table)
 * because a report is a composition of stat cards, bar comparisons, and several distinct tables,
 * not one list. PDF renders this as a close visual match to the on-screen report (colorful cards,
 * real progress bars); Excel renders it as a Summary sheet plus one clean table sheet per
 * table/bars section — no CSV option, since a multi-section report has no single flat row shape
 * a CSV could represent.
 */
export type ReportExportRequest = {
  module: PermissionModuleKey;
  title: string;
  subtitle?: string;
  sections: ReportExportSection[];
  fileBaseName: string;
};
