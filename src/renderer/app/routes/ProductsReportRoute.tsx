import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Package } from "lucide-react";
import { ReportExportMenu } from "@renderer/shared/components/ReportExportMenu";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast } from "@renderer/shared/lib/toast";
import type { DateRangeInput, SalesReportMode } from "@shared/types/report";
import type { ProductsPerformanceReport } from "@shared/types/product-report";
import type { ReportExportRequest, ReportExportSection } from "@shared/types/report-export";
import { BestSellingProductsTable } from "./reports/BestSellingProductsTable";
import { ProductSalesHistorySection } from "./reports/ProductSalesHistorySection";
import { defaultAnchorForMode, rangeForAnchor, shiftAnchor, todayIso } from "./reports/salesReportDate";
import { SalesModeSelector } from "./reports/SalesModeSelector";
import { SlowMovingProductsTable } from "./reports/SlowMovingProductsTable";

export function ProductsReportRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canExport = can("reports", "export");
  const [mode, setMode] = useState<SalesReportMode>("monthly");
  const [anchor, setAnchor] = useState<string>(() => defaultAnchorForMode("monthly"));
  const [customRange, setCustomRange] = useState<DateRangeInput>(() => ({
    startDate: shiftAnchor("daily", todayIso(), -29),
    endDate: todayIso(),
  }));

  function handleModeChange(nextMode: SalesReportMode): void {
    setMode(nextMode);
    if (nextMode !== "custom") setAnchor(defaultAnchorForMode(nextMode));
  }

  const resolvedRange = useMemo<DateRangeInput>(
    () => (mode === "custom" ? customRange : rangeForAnchor(mode, anchor)),
    [mode, anchor, customRange]
  );

  const [data, setData] = useState<ProductsPerformanceReport | null>(null);
  const [slowMovingLimit, setSlowMovingLimit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: DateRangeInput, limit: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.blueLedger.report.productsPerformance({ ...range, slowMovingLimit: limit });
      setData(result);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load the products report");
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(resolvedRange, slowMovingLimit);
  }, [resolvedRange.startDate, resolvedRange.endDate, slowMovingLimit, load]);

  const reportExportRequest = useMemo<ReportExportRequest | null>(() => {
    if (!data) return null;

    const totalQtySold = data.bestSelling.reduce((sum, row) => sum + row.quantitySold, 0);
    const totalRevenue = data.bestSelling.reduce((sum, row) => sum + row.revenueCents, 0);
    const totalProfit = data.bestSelling.reduce((sum, row) => sum + row.profitCents, 0);

    const rawSections: Array<ReportExportSection | false> = [
      {
        type: "tiles",
        title: "Period Summary",
        tiles: [
          { label: "Units Sold", value: String(totalQtySold) },
          { label: "Revenue", value: formatCents(totalRevenue) },
          { label: "Profit", value: formatCents(totalProfit) }
        ]
      },
      data.bestSelling.length > 0 && {
        type: "table",
        title: "Best Selling Products",
        columns: [
          { key: "product", header: "Product" },
          { key: "sku", header: "SKU" },
          { key: "category", header: "Category" },
          { key: "qtySold", header: "Qty Sold", align: "right" },
          { key: "revenue", header: "Revenue", align: "right" },
          { key: "profit", header: "Profit", align: "right" },
          { key: "margin", header: "Margin", align: "right" }
        ],
        rows: data.bestSelling.map((row) => ({
          product: row.productName,
          sku: row.sku,
          category: row.categoryName ?? "—",
          qtySold: String(row.quantitySold),
          revenue: formatCents(row.revenueCents),
          profit: formatCents(row.profitCents),
          margin: row.revenueCents > 0 ? `${((row.profitCents / row.revenueCents) * 100).toFixed(1)}%` : "—"
        }))
      },
      data.slowMoving.length > 0 && {
        type: "table",
        title: "Slowest Moving Products",
        description: "Fewest units sold in this period first — includes products with zero sales entirely.",
        columns: [
          { key: "product", header: "Product" },
          { key: "sku", header: "SKU" },
          { key: "category", header: "Category" },
          { key: "qtySold", header: "Qty Sold (Period)", align: "right" },
          { key: "revenue", header: "Revenue (Period)", align: "right" },
          { key: "lastSold", header: "Last Sold" }
        ],
        rows: data.slowMoving.map((row) => ({
          product: row.productName,
          sku: row.sku,
          category: row.categoryName ?? "—",
          qtySold: String(row.quantitySoldInPeriod),
          revenue: formatCents(row.revenueCentsInPeriod),
          lastSold:
            row.lastSoldAt === null
              ? "Never sold"
              : `${new Date(row.lastSoldAt).toLocaleDateString()}${row.daysSinceLastSale !== null ? ` (${row.daysSinceLastSale}d ago)` : ""}`,
          ...(row.quantitySoldInPeriod === 0 ? { _tone: "danger" as const } : {})
        }))
      }
    ];
    const sections = rawSections.filter((section): section is ReportExportSection => Boolean(section));

    return {
      module: "reports",
      title: "Products Report",
      subtitle: `${resolvedRange.startDate} to ${resolvedRange.endDate}`,
      sections,
      fileBaseName: `ProductsReport_${resolvedRange.startDate}_to_${resolvedRange.endDate}`
    };
  }, [data, resolvedRange]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-6 space-y-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Insights</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
            <Package className="size-5 text-primary" aria-hidden="true" />
            Products Report
          </h2>
          <p className="mt-1 text-xs font-semibold text-muted">
            Best sellers and slow movers for a period you pick, plus a full sales history for any single product.
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
              <BestSellingProductsTable rows={data.bestSelling} />
              <SlowMovingProductsTable rows={data.slowMoving} limit={slowMovingLimit} onLimitChange={setSlowMovingLimit} />
            </>
          )}
        </div>
      </div>

      <ProductSalesHistorySection />
    </motion.div>
  );
}
