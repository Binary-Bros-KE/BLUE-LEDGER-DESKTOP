import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { cn } from "@renderer/shared/lib/cn";
import type { ExportColumn, ExportFormat, ExportListRequest } from "@shared/types/export";

const FORMAT_OPTIONS: Array<{ format: ExportFormat; label: string; icon: typeof FileText }> = [
  { format: "pdf", label: "Preview as PDF", icon: FileText },
  { format: "excel", label: "Export as EXCEL", icon: FileSpreadsheet },
  { format: "csv", label: "Export as CSV", icon: FileDown }
];

function defaultKeySet(columns: ExportColumn[], defaultCheckedKeys?: string[]): Set<string> {
  if (!defaultCheckedKeys) return new Set(columns.map((column) => column.key));
  const allowed = new Set(defaultCheckedKeys);
  return new Set(columns.filter((column) => allowed.has(column.key)).map((column) => column.key));
}

/**
 * Reusable export trigger for any filtered list — Receipts/Invoices/Quotations today, meant to be
 * dropped into Products/Reports later. The caller owns formatting: `request` should already be
 * fully display-formatted (currency symbols, dates, labels) since the main process just writes
 * whatever strings it's given.
 *
 * `selectableFields`: when set, picking a format doesn't export immediately — it shows a checkbox
 * step so the user can drop columns first (e.g. hide buying price) and choose whether the summary
 * stats block comes along too (unchecking a column that a stat also totals — e.g. Line Total vs.
 * the Subtotal/Total stats — is pointless if the stats print anyway, so that's its own checkbox,
 * off by default same as everything else). `rows` are left untouched; every export path only reads
 * the keys present in `columns`, so filtering `columns` alone is enough to drop a field everywhere.
 * `defaultCheckedKeys`: which column keys start checked (everything else starts unchecked); omit to
 * start with every column checked.
 */
export function ExportMenu({
  request,
  disabled,
  selectableFields,
  defaultCheckedKeys
}: {
  request: ExportListRequest;
  disabled?: boolean;
  selectableFields?: boolean;
  defaultCheckedKeys?: string[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [pendingFormat, setPendingFormat] = useState<ExportFormat | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => defaultKeySet(request.columns, defaultCheckedKeys));
  const [includeStats, setIncludeStats] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setPendingFormat(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function runExport(format: ExportFormat, columns: ExportColumn[], withStats: boolean): Promise<void> {
    setOpen(false);
    setPendingFormat(null);
    setExporting(format);
    try {
      const scopedRequest: ExportListRequest = {
        ...request,
        columns,
        stats: withStats ? (request.stats ?? []) : []
      };
      if (format === "pdf") {
        // Opens in the in-app preview window instead of a save dialog — the window appearing IS the
        // feedback, same as every document preview button, so no success toast here.
        await window.blueLedger.export.toPdf(scopedRequest);
      } else {
        const savedPath =
          format === "excel"
            ? await window.blueLedger.export.toExcel(scopedRequest)
            : await window.blueLedger.export.toCsv(scopedRequest);
        if (savedPath) showSuccessToast(`${request.title} exported`);
      }
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to export"));
    } finally {
      setExporting(null);
    }
  }

  function handleFormatClick(format: ExportFormat): void {
    if (selectableFields) {
      setSelectedKeys(defaultKeySet(request.columns, defaultCheckedKeys));
      setIncludeStats(false);
      setPendingFormat(format);
      return;
    }
    void runExport(format, request.columns, true);
  }

  function toggleKey(key: string): void {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const hasStats = Boolean(request.stats && request.stats.length > 0);

  const isBusy = exporting !== null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || isBusy}
        onClick={() => {
          setOpen((prev) => !prev);
          setPendingFormat(null);
        }}
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-md border border-line bg-white px-3.5 text-xs font-extrabold uppercase tracking-wide text-ink shadow-none transition hover:bg-soft focus:outline-none focus:ring-4 focus:ring-accent/20",
          (disabled || isBusy) && "cursor-not-allowed opacity-50"
        )}
      >
        <Download className="size-3.5" aria-hidden="true" />
        {isBusy ? "Exporting..." : "Export"}
        <ChevronDown className="size-3" aria-hidden="true" />
      </button>

      {open && pendingFormat === null && (
        <div className="absolute right-0 z-20 mt-1.5 w-64 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg">
          {FORMAT_OPTIONS.map(({ format, label, icon: Icon }) => (
            <button
              key={format}
              type="button"
              onClick={() => handleFormatClick(format)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-ink transition hover:bg-soft cursor-pointer"
            >
              <Icon className="size-3.5 text-primary" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      )}

      {open && pendingFormat !== null && (
        <div className="absolute right-0 z-20 mt-1.5 w-72 overflow-hidden rounded-lg border border-line bg-white p-3 shadow-lg">
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-ink">Fields to include</p>
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {request.columns.map((column) => (
              <label
                key={column.key}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-xs font-semibold text-ink hover:bg-soft cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedKeys.has(column.key)}
                  onChange={() => toggleKey(column.key)}
                  className="size-3.5 accent-accent"
                />
                {column.header}
              </label>
            ))}
          </div>
          {hasStats && (
            <label className="mt-1 flex items-center gap-2 rounded border-t border-line px-1.5 py-1.5 pt-2.5 text-xs font-bold text-ink hover:bg-soft cursor-pointer">
              <input
                type="checkbox"
                checked={includeStats}
                onChange={() => setIncludeStats((prev) => !prev)}
                className="size-3.5 accent-accent"
              />
              Include Summary Stats
            </label>
          )}
          <div className="mt-3 flex items-center justify-end gap-3 border-t border-line pt-2">
            <button
              type="button"
              onClick={() => setPendingFormat(null)}
              className="text-xs font-bold text-muted hover:underline cursor-pointer"
            >
              Back
            </button>
            <button
              type="button"
              disabled={selectedKeys.size === 0}
              onClick={() =>
                void runExport(
                  pendingFormat,
                  request.columns.filter((column) => selectedKeys.has(column.key)),
                  includeStats
                )
              }
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-extrabold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              Export
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
