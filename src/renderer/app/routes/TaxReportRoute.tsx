import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Receipt } from "lucide-react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ReportExportMenu } from "@renderer/shared/components/ReportExportMenu";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast } from "@renderer/shared/lib/toast";
import { taxBreakdownLabel } from "@shared/lib/tax-calculation";
import type { DateRangeInput, SalesReportMode } from "@shared/types/report";
import type { ReportExportRequest, ReportExportSection } from "@shared/types/report-export";
import type { TaxReport, TaxTopProductRow } from "@shared/types/tax-report";
import { defaultAnchorForMode, rangeForAnchor, shiftAnchor, todayIso } from "./reports/salesReportDate";
import { SalesModeSelector } from "./reports/SalesModeSelector";

function TopProductsTable({ title, rows }: { title: string; rows: TaxTopProductRow[] }): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">{title}</p>
      <div className="mt-1.5 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[680px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[40%]" />
            <col className="w-[12%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead>
            <tr className="bg-primary text-white">
              <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Product</th>
              <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Qty</th>
              <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Net</th>
              <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Tax</th>
              <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Gross</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.productId}-${row.taxType}`} className="border-t border-line odd:bg-white even:bg-soft/50">
                <td className="px-3 py-2 text-xs font-bold text-ink">
                  <p className="line-clamp-2 leading-snug" title={row.productName}>
                    {row.productName}
                  </p>
                  <p className="mt-0.5 font-semibold text-muted">{row.sku}</p>
                </td>
                <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">{row.quantitySold}</td>
                <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">{formatCents(row.netCents)}</td>
                <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">{formatCents(row.taxCents)}</td>
                <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-ink">{formatCents(row.grossCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TaxReportRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canExport = can("reports", "export");

  const [mode, setMode] = useState<SalesReportMode>("monthly");
  const [anchor, setAnchor] = useState<string>(() => defaultAnchorForMode("monthly"));
  const [customRange, setCustomRange] = useState<DateRangeInput>(() => ({
    startDate: shiftAnchor("daily", todayIso(), -29),
    endDate: todayIso()
  }));

  function handleModeChange(nextMode: SalesReportMode): void {
    setMode(nextMode);
    if (nextMode !== "custom") setAnchor(defaultAnchorForMode(nextMode));
  }

  const resolvedRange = useMemo<DateRangeInput>(
    () => (mode === "custom" ? customRange : rangeForAnchor(mode, anchor)),
    [mode, anchor, customRange]
  );

  const [data, setData] = useState<TaxReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: DateRangeInput) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.blueLedger.report.taxBreakdown(range);
      setData(result);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load the tax report");
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(resolvedRange);
  }, [resolvedRange.startDate, resolvedRange.endDate, load]);

  const reportExportRequest = useMemo<ReportExportRequest | null>(() => {
    if (!data) return null;

    const rawSections: Array<ReportExportSection | false> = [
      {
        type: "tiles",
        title: "Period Summary",
        tiles: [
          { label: "Net", value: formatCents(data.totalNetCents) },
          { label: "Tax", value: formatCents(data.totalTaxCents) },
          { label: "Gross", value: formatCents(data.totalGrossCents) }
        ]
      },
      {
        type: "table",
        title: "Tax Breakdown by Category",
        columns: [
          { key: "category", header: "Category" },
          { key: "lines", header: "Lines", align: "right" },
          { key: "net", header: "Net", align: "right" },
          { key: "tax", header: "Tax", align: "right" },
          { key: "gross", header: "Gross", align: "right" }
        ],
        rows: data.byCategory.map((entry) => ({
          category: taxBreakdownLabel(entry.taxType, { vatRatePercent: data.vatRatePercent, pricesTaxInclusive: true }),
          lines: String(entry.lineCount),
          net: formatCents(entry.netCents),
          tax: formatCents(entry.taxCents),
          gross: formatCents(entry.grossCents)
        }))
      },
      data.topTaxedProducts.length > 0 && {
        type: "table",
        title: "Top 10 Most-Taxed Products",
        columns: [
          { key: "product", header: "Product" },
          { key: "sku", header: "SKU" },
          { key: "qty", header: "Qty", align: "right" },
          { key: "net", header: "Net", align: "right" },
          { key: "tax", header: "Tax", align: "right" },
          { key: "gross", header: "Gross", align: "right" }
        ],
        rows: data.topTaxedProducts.map((row) => ({
          product: row.productName,
          sku: row.sku,
          qty: String(row.quantitySold),
          net: formatCents(row.netCents),
          tax: formatCents(row.taxCents),
          gross: formatCents(row.grossCents)
        }))
      },
      data.topZeroRatedProducts.length > 0 && {
        type: "table",
        title: "Top 10 Zero-Rated Products",
        columns: [
          { key: "product", header: "Product" },
          { key: "sku", header: "SKU" },
          { key: "qty", header: "Qty", align: "right" },
          { key: "gross", header: "Revenue", align: "right" }
        ],
        rows: data.topZeroRatedProducts.map((row) => ({
          product: row.productName,
          sku: row.sku,
          qty: String(row.quantitySold),
          gross: formatCents(row.grossCents)
        }))
      },
      data.topExemptedProducts.length > 0 && {
        type: "table",
        title: "Top 10 Exempted Products",
        columns: [
          { key: "product", header: "Product" },
          { key: "sku", header: "SKU" },
          { key: "qty", header: "Qty", align: "right" },
          { key: "gross", header: "Revenue", align: "right" }
        ],
        rows: data.topExemptedProducts.map((row) => ({
          product: row.productName,
          sku: row.sku,
          qty: String(row.quantitySold),
          gross: formatCents(row.grossCents)
        }))
      }
    ];
    const sections = rawSections.filter((section): section is ReportExportSection => Boolean(section));

    return {
      module: "reports",
      title: "Tax Report",
      subtitle: `${resolvedRange.startDate} to ${resolvedRange.endDate}`,
      sections,
      fileBaseName: `TaxReport_${resolvedRange.startDate}_to_${resolvedRange.endDate}`
    };
  }, [data, resolvedRange]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-6 space-y-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Insights</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
            <Receipt className="size-5 text-primary" aria-hidden="true" />
            Tax Report
          </h2>
          <p className="mt-1 text-xs font-semibold text-muted">
            Tax collected by category for a period you pick, plus the top products in each.
          </p>
        </div>
        {canExport && reportExportRequest && <ReportExportMenu request={reportExportRequest} />}
      </div>

      <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <SalesModeSelector
          mode={mode}
          onModeChange={handleModeChange}
          anchor={anchor}
          onAnchorChange={setAnchor}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
        />

        {error && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
        )}

        <div className={cn("mt-5 space-y-4 transition-opacity", loading && "opacity-60")}>
          {loading && !data && (
            <div className="flex min-h-[200px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          )}
          {data && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatTile icon={Receipt} label="Net" value={formatCents(data.totalNetCents)} tone="primary" />
                <StatTile icon={Receipt} label="Tax" value={formatCents(data.totalTaxCents)} tone="accent" />
                <StatTile icon={Receipt} label="Gross" value={formatCents(data.totalGrossCents)} tone="warning" />
              </div>

              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Breakdown by Category</p>
                {data.byCategory.length === 0 ? (
                  <p className="mt-2 text-xs font-semibold text-muted">No taxable sales in this period.</p>
                ) : (
                  <div className="mt-1.5 overflow-x-auto rounded-lg border border-line">
                    <table className="w-full min-w-[500px] table-fixed border-collapse text-sm">
                      <thead>
                        <tr className="bg-primary text-white">
                          <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Category</th>
                          <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Lines</th>
                          <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Net</th>
                          <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Tax</th>
                          <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Gross</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.byCategory.map((entry) => (
                          <tr key={entry.taxType} className="border-t border-line odd:bg-white even:bg-soft/50">
                            <td className="px-3 py-2">
                              <DashedPill tone="accent">
                                {taxBreakdownLabel(entry.taxType, { vatRatePercent: data.vatRatePercent, pricesTaxInclusive: true })}
                              </DashedPill>
                            </td>
                            <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">{entry.lineCount}</td>
                            <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">{formatCents(entry.netCents)}</td>
                            <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">{formatCents(entry.taxCents)}</td>
                            <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-ink">{formatCents(entry.grossCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <TopProductsTable title="Top 10 Most-Taxed Products" rows={data.topTaxedProducts} />
              <TopProductsTable title="Top 10 Zero-Rated Products" rows={data.topZeroRatedProducts} />
              <TopProductsTable title="Top 10 Exempted Products" rows={data.topExemptedProducts} />
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
