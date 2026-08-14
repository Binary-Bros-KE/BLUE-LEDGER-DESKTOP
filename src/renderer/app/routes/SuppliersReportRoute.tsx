import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Truck } from "lucide-react";
import { categoricalColor } from "@renderer/shared/components/charts/chartTokens";
import { ReportExportMenu } from "@renderer/shared/components/ReportExportMenu";
import { ReportStorefrontFilter } from "@renderer/shared/components/ReportStorefrontFilter";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { useReportLocationFilter } from "@renderer/shared/hooks/use-report-location-filter";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast } from "@renderer/shared/lib/toast";
import type { DateRangeInput, SalesReportMode } from "@shared/types/report";
import type { ReportExportRequest, ReportExportSection } from "@shared/types/report-export";
import type { OutstandingPurchasesSummary, SupplierSpendRow } from "@shared/types/supplier-report";
import { OutstandingPurchasesSection } from "./reports/OutstandingPurchasesSection";
import { defaultAnchorForMode, rangeForAnchor, shiftAnchor, todayIso } from "./reports/salesReportDate";
import { SalesModeSelector } from "./reports/SalesModeSelector";
import { SupplierPurchaseHistorySection } from "./reports/SupplierPurchaseHistorySection";
import { SupplierSpendSection } from "./reports/SupplierSpendSection";

const STATUS_LABEL: Record<string, string> = {
  ordered: "Ordered",
  partially_received: "Partially Received",
  received: "Received",
};

function percentBars<T>(rows: T[], getValue: (row: T) => number): number[] {
  const max = Math.max(1, ...rows.map(getValue));
  return rows.map((row) => Math.max(2, (getValue(row) / max) * 100));
}

export function SuppliersReportRoute(): React.JSX.Element {
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

  const [spendBreakdown, setSpendBreakdown] = useState<SupplierSpendRow[] | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingPurchasesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: DateRangeInput, locationId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const [spendResult, outstandingResult] = await Promise.all([
        window.blueLedger.report.supplierSpendBreakdown({ ...range, locationId }),
        window.blueLedger.report.outstandingPurchases({ locationId }),
      ]);
      setSpendBreakdown(spendResult);
      setOutstanding(outstandingResult);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load the suppliers report");
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(resolvedRange, locationFilter.locationId);
  }, [resolvedRange.startDate, resolvedRange.endDate, locationFilter.locationId, load]);

  const reportExportRequest = useMemo<ReportExportRequest | null>(() => {
    if (!outstanding || !spendBreakdown) return null;

    const rawSections: Array<ReportExportSection | false> = [
      {
        type: "cards",
        title: "Outstanding Supplier Payments",
        cards: [
          {
            tone: "danger",
            label: "Total Outstanding",
            value: formatCents(outstanding.totalOutstandingCents),
            caption: "Sum of every unpaid purchase balance"
          },
          { tone: "teal", label: "Creditors", value: String(outstanding.creditorCount), caption: "Distinct suppliers you owe money to" }
        ]
      },
      spendBreakdown.length > 0 && {
        type: "bars",
        title: "Top Suppliers by Spend",
        items: spendBreakdown.slice(0, 10).map((row, index) => ({
          label: row.supplierName,
          value: formatCents(row.totalSpentCents),
          percent: percentBars(spendBreakdown.slice(0, 10), (r) => r.totalSpentCents)[index] ?? 2,
          color: categoricalColor(index)
        }))
      },
      spendBreakdown.length > 0 && {
        type: "table",
        title: "Supplier Spend — Detail",
        description: `${resolvedRange.startDate} to ${resolvedRange.endDate}`,
        columns: [
          { key: "supplier", header: "Supplier" },
          { key: "purchases", header: "Purchases", align: "right" },
          { key: "totalSpent", header: "Total Spent", align: "right" },
          { key: "percent", header: "% of Total", align: "right" }
        ],
        rows: spendBreakdown.map((row) => ({
          supplier: row.supplierName,
          purchases: String(row.purchaseCount),
          totalSpent: formatCents(row.totalSpentCents),
          percent: `${row.percentOfTotal.toFixed(1)}%`
        }))
      },
      outstanding.purchases.length > 0 && {
        type: "table",
        title: "Outstanding Purchases, Oldest First",
        description: "A live snapshot as of today — not scoped to the period above.",
        columns: [
          { key: "supplier", header: "Supplier" },
          { key: "poNumber", header: "PO Number" },
          { key: "status", header: "Status" },
          { key: "ordered", header: "Ordered" },
          { key: "total", header: "Total", align: "right" },
          { key: "paid", header: "Paid", align: "right" },
          { key: "balance", header: "Balance", align: "right" },
          { key: "daysOut", header: "Days Out", align: "right" }
        ],
        rows: outstanding.purchases.map((purchase) => ({
          supplier: purchase.supplierName,
          poNumber: purchase.purchaseNumber,
          status: STATUS_LABEL[purchase.status] ?? purchase.status,
          ordered: purchase.orderedAt ? new Date(purchase.orderedAt).toLocaleDateString() : "—",
          total: formatCents(purchase.grandTotalCents),
          paid: formatCents(purchase.amountPaidCents),
          balance: formatCents(purchase.balanceCents),
          daysOut: `${purchase.daysOutstanding}d`,
          ...(purchase.daysOutstanding > 30 ? { _tone: "danger" as const } : {})
        }))
      }
    ];
    const sections = rawSections.filter((section): section is ReportExportSection => Boolean(section));

    return {
      module: "reports",
      title: "Suppliers Report",
      subtitle: `${resolvedRange.startDate} to ${resolvedRange.endDate}`,
      sections,
      fileBaseName: `SuppliersReport_${resolvedRange.startDate}_to_${resolvedRange.endDate}`
    };
  }, [outstanding, spendBreakdown, resolvedRange]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-6 space-y-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Insights</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
            <Truck className="size-5 text-primary" aria-hidden="true" />
            Suppliers Report
          </h2>
          <p className="mt-1 text-xs font-semibold text-muted">
            Who you buy from the most for a period you pick, every outstanding supplier payment right now, and a
            full purchase history for any single supplier.
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
          {loading && !spendBreakdown && (
            <div className="flex min-h-[200px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          )}
          {spendBreakdown && <SupplierSpendSection rows={spendBreakdown} />}
        </div>
      </div>

      {outstanding && <OutstandingPurchasesSection summary={outstanding} />}

      <SupplierPurchaseHistorySection />
    </motion.div>
  );
}
