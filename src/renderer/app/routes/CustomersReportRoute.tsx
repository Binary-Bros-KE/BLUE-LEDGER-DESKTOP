import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Users } from "lucide-react";
import { categoricalColor } from "@renderer/shared/components/charts/chartTokens";
import { ReportExportMenu } from "@renderer/shared/components/ReportExportMenu";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import type { DateRangeInput, SalesReportMode } from "@shared/types/report";
import type { OutstandingInvoicesSummary, TopCustomerRow } from "@shared/types/customer-report";
import type { ReportExportRequest, ReportExportSection } from "@shared/types/report-export";
import { CustomerPurchaseHistorySection } from "./reports/CustomerPurchaseHistorySection";
import { OutstandingInvoicesSection } from "./reports/OutstandingInvoicesSection";
import { defaultAnchorForMode, rangeForAnchor, shiftAnchor, todayIso } from "./reports/salesReportDate";
import { SalesModeSelector } from "./reports/SalesModeSelector";
import { TopCustomersTable } from "./reports/TopCustomersTable";

export function CustomersReportRoute(): React.JSX.Element {
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

  const [topCustomers, setTopCustomers] = useState<TopCustomerRow[] | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingInvoicesSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: DateRangeInput) => {
    setLoading(true);
    setError(null);
    try {
      const [topCustomersResult, outstandingResult] = await Promise.all([
        window.blueLedger.report.topCustomers(range),
        window.blueLedger.report.outstandingInvoices(),
      ]);
      setTopCustomers(topCustomersResult);
      setOutstanding(outstandingResult);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load the customers report"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(resolvedRange);
  }, [resolvedRange.startDate, resolvedRange.endDate, load]);

  const reportExportRequest = useMemo<ReportExportRequest | null>(() => {
    if (!topCustomers) return null;

    function percentBars<T>(rowsIn: T[], getValue: (row: T) => number): number[] {
      const max = Math.max(1, ...rowsIn.map(getValue));
      return rowsIn.map((row) => Math.max(2, (getValue(row) / max) * 100));
    }

    const rawSections: Array<ReportExportSection | false | null> = [
      outstanding && {
        type: "cards",
        title: "Outstanding Customer Invoices",
        cards: [
          {
            tone: "primary",
            label: "Total Outstanding",
            value: formatCents(outstanding.totalOutstandingCents),
            caption: "Sum of every unpaid invoice balance"
          },
          { tone: "teal", label: "Debtors", value: String(outstanding.debtorCount), caption: "Distinct customers who owe money" },
          { tone: "danger", label: "Overdue Invoices", value: String(outstanding.overdueCount), caption: "Past their due date, still unpaid" }
        ]
      },
      topCustomers.length > 0 && {
        type: "bars",
        title: "Top Customers by Revenue",
        items: topCustomers.slice(0, 10).map((row, index) => ({
          label: row.customerName,
          value: formatCents(row.revenueCents),
          percent: percentBars(topCustomers.slice(0, 10), (r) => r.revenueCents)[index] ?? 2,
          color: categoricalColor(index)
        }))
      },
      topCustomers.length > 0 && {
        type: "table",
        title: "Top Customers — Detail",
        description: `${resolvedRange.startDate} to ${resolvedRange.endDate}`,
        columns: [
          { key: "customer", header: "Customer" },
          { key: "phone", header: "Phone" },
          { key: "transactions", header: "Transactions", align: "right" },
          { key: "revenue", header: "Revenue", align: "right" },
          { key: "avgSale", header: "Avg Sale", align: "right" },
          { key: "percent", header: "% of Total", align: "right" }
        ],
        rows: topCustomers.map((row) => ({
          customer: row.customerName,
          phone: row.phone ?? "—",
          transactions: String(row.transactionCount),
          revenue: formatCents(row.revenueCents),
          avgSale: formatCents(row.averageSaleCents),
          percent: `${row.percentOfTotal.toFixed(1)}%`
        }))
      },
      outstanding && outstanding.invoices.length > 0 && {
        type: "table",
        title: "Outstanding Invoices, Oldest First",
        description: "A live snapshot as of today — not scoped to the period above.",
        columns: [
          { key: "customer", header: "Customer" },
          { key: "document", header: "Document" },
          { key: "issued", header: "Issued" },
          { key: "due", header: "Due" },
          { key: "total", header: "Total", align: "right" },
          { key: "paid", header: "Paid", align: "right" },
          { key: "balance", header: "Balance", align: "right" }
        ],
        rows: outstanding.invoices.map((invoice) => ({
          customer: invoice.customerName,
          document: invoice.documentNumber ?? "—",
          issued: new Date(invoice.completedAt).toLocaleDateString(),
          due: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—",
          total: formatCents(invoice.grandTotalCents),
          paid: formatCents(invoice.amountPaidCents),
          balance: formatCents(invoice.balanceCents),
          ...(invoice.isOverdue ? { _tone: "danger" as const } : {})
        }))
      }
    ];
    const sections = rawSections.filter((section): section is ReportExportSection => Boolean(section));

    return {
      module: "reports",
      title: "Customers Report",
      subtitle: `${resolvedRange.startDate} to ${resolvedRange.endDate}`,
      sections,
      fileBaseName: `CustomersReport_${resolvedRange.startDate}_to_${resolvedRange.endDate}`
    };
  }, [topCustomers, outstanding, resolvedRange]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-6 space-y-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Insights</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
            <Users className="size-5 text-primary" aria-hidden="true" />
            Customers Report
          </h2>
          <p className="mt-1 text-xs font-semibold text-muted">
            Top customers for a period you pick, every outstanding invoice right now, and a full purchase history for
            any single customer.
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
          {loading && !topCustomers && (
            <div className="flex min-h-[200px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          )}
          {topCustomers && <TopCustomersTable rows={topCustomers} />}
        </div>
      </div>

      {outstanding && <OutstandingInvoicesSection summary={outstanding} />}

      <CustomerPurchaseHistorySection />
    </motion.div>
  );
}
