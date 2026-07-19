import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { cn } from "@renderer/shared/lib/cn";
import type { ExportFormat, ExportListRequest } from "@shared/types/export";

const FORMAT_OPTIONS: Array<{ format: ExportFormat; label: string; icon: typeof FileText }> = [
  { format: "pdf", label: "Export as PDF", icon: FileText },
  { format: "excel", label: "Export as EXCEL", icon: FileSpreadsheet },
  { format: "csv", label: "Export as CSV", icon: FileDown }
];

/**
 * Reusable export trigger for any filtered list — Receipts/Invoices/Quotations today, meant to be
 * dropped into Products/Reports later. The caller owns formatting: `request` should already be
 * fully display-formatted (currency symbols, dates, labels) since the main process just writes
 * whatever strings it's given.
 */
export function ExportMenu({
  request,
  disabled
}: {
  request: ExportListRequest;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleExport(format: ExportFormat): Promise<void> {
    setOpen(false);
    setExporting(format);
    try {
      const savedPath =
        format === "pdf"
          ? await window.blueLedger.export.toPdf(request)
          : format === "excel"
            ? await window.blueLedger.export.toExcel(request)
            : await window.blueLedger.export.toCsv(request);
      if (savedPath) {
        showSuccessToast(`${request.title} exported`);
      }
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to export"));
    } finally {
      setExporting(null);
    }
  }

  const isBusy = exporting !== null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || isBusy}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-md border border-line bg-white px-3.5 text-xs font-extrabold uppercase tracking-wide text-ink shadow-none transition hover:bg-soft focus:outline-none focus:ring-4 focus:ring-accent/20",
          (disabled || isBusy) && "cursor-not-allowed opacity-50"
        )}
      >
        <Download className="size-3.5" aria-hidden="true" />
        {isBusy ? "Exporting..." : "Export"}
        <ChevronDown className="size-3" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1.5 w-64 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg">
          {FORMAT_OPTIONS.map(({ format, label, icon: Icon }) => (
            <button
              key={format}
              type="button"
              onClick={() => void handleExport(format)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-ink transition hover:bg-soft cursor-pointer"
            >
              <Icon className="size-3.5 text-primary" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
