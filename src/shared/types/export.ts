import type { PermissionModuleKey } from "@shared/types/role";

export type ExportFormat = "csv" | "excel" | "pdf";

export type ExportColumn = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
};

export type ExportStat = {
  label: string;
  value: string;
};

/**
 * Generic contract for exporting any filtered list (Receipts, Invoices, Quotations today;
 * Products/Reports later). The renderer formats every cell/stat to its final display string
 * (currency symbols, dates, labels) so the main process stays a dumb table/PDF writer with no
 * per-feature formatting knowledge.
 */
export type ExportListRequest = {
  module: PermissionModuleKey;
  title: string;
  subtitle?: string;
  columns: ExportColumn[];
  rows: Array<Record<string, string>>;
  stats?: ExportStat[];
  fileBaseName: string;
};
