import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { cn } from "@renderer/shared/lib/cn";
import type { ReportExportRequest } from "@shared/types/report-export";

type ReportExportFormat = "pdf" | "excel";

const FORMAT_OPTIONS: Array<{ format: ReportExportFormat; label: string; icon: typeof FileText }> = [
  { format: "pdf", label: "Export as PDF", icon: FileText },
  { format: "excel", label: "Export as Excel", icon: FileSpreadsheet }
];

/**
 * Export trigger for a full multi-section report (Sales/Inventory/Products/Customers/Suppliers
 * Report) — deliberately PDF/Excel only, no CSV: a report is cards + bars + several tables, not
 * one flat list a CSV row shape could represent. PDF mirrors the on-screen report visually; Excel
 * re-presents the same insight as clean tabular sheets.
 */
export function ReportExportMenu({
  request,
  disabled
}: {
  request: ReportExportRequest;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<ReportExportFormat | null>(null);
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

  async function handleExport(format: ReportExportFormat): Promise<void> {
    setOpen(false);
    setExporting(format);
    try {
      const savedPath =
        format === "pdf"
          ? await window.blueLedger.reportExport.toPdf(request)
          : await window.blueLedger.reportExport.toExcel(request);
      if (savedPath) {
        showSuccessToast(`${request.title} exported`);
      }
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to export report"));
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
        {isBusy ? "Exporting..." : "Export Report"}
        <ChevronDown className="size-3" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1.5 w-48 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg">
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
