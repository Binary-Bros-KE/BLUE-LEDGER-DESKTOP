import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Package } from "lucide-react";
import { ReportExportMenu } from "@renderer/shared/components/ReportExportMenu";
import { ReportStorefrontFilter } from "@renderer/shared/components/ReportStorefrontFilter";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { useReportLocationFilter } from "@renderer/shared/hooks/use-report-location-filter";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast } from "@renderer/shared/lib/toast";
import { formatDocumentDate } from "@shared/lib/date";
import type { DateRangeInput, SalesReportMode } from "@shared/types/report";
import type { ProductsPerformanceReport } from "@shared/types/product-report";
import type { ReportExportRequest, ReportExportSection } from "@shared/types/report-export";
import {
  BestSellingProductsTable,
  DEFAULT_BEST_SELLING_LIMIT,
  SORT_OPTIONS,
  sortAndLimitBestSelling,
  type BestSellingSortKey
} from "./reports/BestSellingProductsTable";
import { ProductSalesHistorySection } from "./reports/ProductSalesHistorySection";
import { defaultAnchorForMode, rangeForAnchor, shiftAnchor, todayIso } from "./reports/salesReportDate";
import { SalesModeSelector } from "./reports/SalesModeSelector";
import { SlowMovingProductsTable } from "./reports/SlowMovingProductsTable";

export function ProductsReportRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canExport = can("reports", "export");
  const locationFilter = useReportLocationFilter();
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
  // Lifted out of BestSellingProductsTable (rather than left as that component's own local state)
  // specifically so the export builder below can read the exact sort/limit the user picked on
  // screen — see sortAndLimitBestSelling's own doc comment for the bug this fixes.
  const [bestSellingSortKey, setBestSellingSortKey] = useState<BestSellingSortKey>("quantitySold");
  const [bestSellingLimit, setBestSellingLimit] = useState(DEFAULT_BEST_SELLING_LIMIT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: DateRangeInput, limit: number, locationId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.blueLedger.report.productsPerformance({ ...range, slowMovingLimit: limit, locationId });
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
    void load(resolvedRange, slowMovingLimit, locationFilter.locationId);
  }, [resolvedRange.startDate, resolvedRange.endDate, slowMovingLimit, locationFilter.locationId, load]);

  // Client-reported bug: exporting "Best Selling Products" always showed the full, default-ordered
  // list regardless of the on-screen sort ("By Profit" etc.) or "Show N" limit the user had just set
  // — because the export below used to read data.bestSelling directly, and sortKey/limit used to be
  // BestSellingProductsTable's own local state, invisible from here. This is the exact same
  // sorted-and-limited set the table itself renders, so the export always matches what's on screen.
  const bestSellingForExport = useMemo(
    () => (data ? sortAndLimitBestSelling(data.bestSelling, bestSellingSortKey, bestSellingLimit) : []),
    [data, bestSellingSortKey, bestSellingLimit]
  );

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
      bestSellingForExport.length > 0 && {
        type: "table",
        title: "Best Selling Products",
        description: `Sorted ${SORT_OPTIONS.find((o) => o.key === bestSellingSortKey)?.label.toLowerCase() ?? ""}, top ${bestSellingLimit} — matches the on-screen table.`,
        columns: [
          { key: "product", header: "Product" },
          { key: "sku", header: "SKU" },
          { key: "category", header: "Category" },
          { key: "qtySold", header: "Qty Sold", align: "right" },
          { key: "revenue", header: "Revenue", align: "right" },
          { key: "profit", header: "Profit", align: "right" },
          { key: "margin", header: "Margin", align: "right" }
        ],
        rows: bestSellingForExport.map((row) => ({
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
              : `${formatDocumentDate(row.lastSoldAt)}${row.daysSinceLastSale !== null ? ` (${row.daysSinceLastSale}d ago)` : ""}`,
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
  }, [data, resolvedRange, bestSellingForExport, bestSellingSortKey, bestSellingLimit]);

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
        <div className="flex flex-wrap items-center gap-3">
          <SalesModeSelector
            mode={mode}
            onModeChange={handleModeChange}
            anchor={anchor}
            onAnchorChange={setAnchor}
            customRange={customRange}
            onCustomRangeChange={setCustomRange}
          />
          <ReportStorefrontFilter filter={locationFilter} />
        </div>

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
              <BestSellingProductsTable
                rows={data.bestSelling}
                sortKey={bestSellingSortKey}
                onSortKeyChange={setBestSellingSortKey}
                limit={bestSellingLimit}
                onLimitChange={setBestSellingLimit}
              />
              <SlowMovingProductsTable rows={data.slowMoving} limit={slowMovingLimit} onLimitChange={setSlowMovingLimit} />
            </>
          )}
        </div>
      </div>

      <ProductSalesHistorySection />
    </motion.div>
  );
}
