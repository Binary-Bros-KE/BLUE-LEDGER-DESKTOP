import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3 } from "lucide-react";
import { categoricalColor } from "@renderer/shared/components/charts/chartTokens";
import { HorizontalBarList } from "@renderer/shared/components/charts/HorizontalBarList";
import { TrendAreaChart } from "@renderer/shared/components/charts/TrendAreaChart";
import { ReportExportMenu } from "@renderer/shared/components/ReportExportMenu";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import type { ReportExportRequest, ReportExportSection } from "@shared/types/report-export";
import type {
  CancelledPurchasesReport,
  DateRangeInput,
  SalesByEmployeeRow,
  SalesByPaymentMethodRow,
  SalesByStorefrontRow,
  SalesFinancialOverview,
  SalesReportMode,
  SalesTransactionKind,
  SalesTransactionRow,
  SalesTrendWindowResult,
} from "@shared/types/report";
import { AccuracyLimitationsNotice } from "./reports/AccuracyLimitationsNotice";
import { CancelledPurchasesSection } from "./reports/CancelledPurchasesSection";
import { DebtorsCreditorsSection } from "./reports/DebtorsCreditorsSection";
import { FinancialOverviewCards } from "./reports/FinancialOverviewCards";
import { ReportStatTile } from "./reports/ReportStatTile";
import { RevenueExpenseBreakdown } from "./reports/RevenueExpenseBreakdown";
import { defaultAnchorForMode, rangeForAnchor, shiftAnchor, todayIso, trendWindowInputForMode } from "./reports/salesReportDate";
import { SalesModeSelector } from "./reports/SalesModeSelector";
import { SalesReportNotes } from "./reports/SalesReportNotes";
import { TransactionsList } from "./reports/TransactionsList";
import { VoidsAndReturnsSection } from "./reports/VoidsAndReturnsSection";

function money(cents: number): string {
  return formatCents(cents);
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }): React.JSX.Element {
  return (
    <div>
      <h3 className="text-base font-extrabold text-ink">{title}</h3>
      {description && <p className="mt-0.5 text-xs font-semibold text-muted">{description}</p>}
    </div>
  );
}

/** Storefront/Employee/Payment-Method breakdowns sum each sale's face value —
 * they don't net out approved refunds the way Total Revenue does. Silent the
 * rest of the time (most periods have no refunds); when one exists, this
 * makes the gap traceable instead of a second unexplained mismatch. */
function GrossVsNetFootnote({ overview }: { overview: SalesFinancialOverview }): React.JSX.Element | null {
  if (overview.returnRefundCents <= 0) return null;
  const grossCents = overview.retailWholesaleRevenueCents + overview.invoicePaymentRevenueCents;
  return (
    <p className="mt-2 text-[11px] font-semibold text-muted">
      Shows {money(grossCents)} gross, before {money(overview.returnRefundCents)} in approved refunds — Total Revenue above
      ({money(overview.totalRevenueCents)}) is net of those.
    </p>
  );
}

const TRANSACTION_KIND_LABEL: Record<SalesTransactionKind, string> = {
  retail_sale: "Retail Sale",
  wholesale_sale: "Wholesale Sale",
  invoice: "Invoice",
};

function transactionStatusLabel(row: Pick<SalesTransactionRow, "amountCents" | "amountPaidCents">): string {
  return row.amountPaidCents >= row.amountCents ? "Paid" : "Partially Paid";
}

const TREND_TITLE: Record<SalesReportMode, string> = {
  daily: "Total Revenue Trend — 5 days before and after the selected day",
  weekly: "Total Revenue Trend — nearby weeks",
  monthly: "Total Revenue Trend — nearby months",
  yearly: "Total Revenue Trend — nearby years",
  custom: "Total Revenue Trend across the selected range",
};

export function SalesReportRoute(): React.JSX.Element {
  const setActiveNavKey = useUiStore((state) => state.setActiveNavKey);
  const { can } = usePermissions();
  const canExport = can("reports", "export");

  const [mode, setMode] = useState<SalesReportMode>("daily");
  const [anchor, setAnchor] = useState<string>(() => defaultAnchorForMode("daily"));
  const [customRange, setCustomRange] = useState<DateRangeInput>(() => ({
    startDate: shiftAnchor("daily", todayIso(), -6),
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
  const trendInput = useMemo(() => trendWindowInputForMode(mode, anchor, customRange), [mode, anchor, customRange]);

  const [overview, setOverview] = useState<SalesFinancialOverview | null>(null);
  const [transactions, setTransactions] = useState<SalesTransactionRow[]>([]);
  const [trendWindow, setTrendWindow] = useState<SalesTrendWindowResult | null>(null);
  const [byStorefront, setByStorefront] = useState<SalesByStorefrontRow[]>([]);
  const [byEmployee, setByEmployee] = useState<SalesByEmployeeRow[]>([]);
  const [byPaymentMethod, setByPaymentMethod] = useState<SalesByPaymentMethodRow[]>([]);
  const [cancelledPurchases, setCancelledPurchases] = useState<CancelledPurchasesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: DateRangeInput, trend: typeof trendInput) => {
    setLoading(true);
    setError(null);
    try {
      const [overviewResult, transactionsResult, trendResult, storefrontResult, employeeResult, paymentResult, cancelledPurchasesResult] =
        await Promise.all([
          window.blueLedger.report.salesFinancialOverview(range),
          window.blueLedger.report.salesTransactions(range),
          window.blueLedger.report.salesTrendWindow(trend),
          window.blueLedger.report.salesByStorefront(range),
          window.blueLedger.report.salesByEmployee(range),
          window.blueLedger.report.salesByPaymentMethod(range),
          window.blueLedger.report.cancelledPurchases(range),
        ]);
      setOverview(overviewResult);
      setTransactions(transactionsResult);
      setTrendWindow(trendResult);
      setByStorefront(storefrontResult);
      setByEmployee(employeeResult);
      setByPaymentMethod(paymentResult);
      setCancelledPurchases(cancelledPurchasesResult);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load the sales report"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(resolvedRange, trendInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedRange.startDate, resolvedRange.endDate, JSON.stringify(trendInput), load]);

  const trendPoints = useMemo(
    () => trendWindow?.points.map((p) => ({ label: p.periodLabel, value: p.revenueCents, isSelected: p.isSelected })) ?? [],
    [trendWindow]
  );

  const storefrontBars = useMemo(
    () => byStorefront.map((row) => ({ key: row.locationId, label: row.locationName, value: row.revenueCents })),
    [byStorefront]
  );
  const employeeBars = useMemo(
    () =>
      byEmployee.map((row) => ({
        key: row.employeeId,
        label: row.employeeName,
        sublabel: row.branchName ?? undefined,
        value: row.revenueCents,
      })),
    [byEmployee]
  );
  const paymentBars = useMemo(
    () =>
      byPaymentMethod.map((row, index) => ({
        key: row.paymentMethodId ?? `other-${index}`,
        label: row.paymentMethodName,
        value: row.revenueCents,
      })),
    [byPaymentMethod]
  );

  const reportExportRequest = useMemo<ReportExportRequest | null>(() => {
    if (!overview) return null;

    function deltaCaption(formula: string, deltaPercent: number | null): string {
      if (deltaPercent === null) return formula;
      const sign = deltaPercent > 0 ? "+" : "";
      return `${formula} · ${sign}${deltaPercent.toFixed(1)}% vs previous period`;
    }

    function percentBars<T>(rows: T[], getValue: (row: T) => number): number[] {
      const max = Math.max(1, ...rows.map(getValue));
      return rows.map((row) => Math.max(2, (getValue(row) / max) * 100));
    }

    const rawSections: Array<ReportExportSection | false> = [
      {
        type: "cards",
        title: "Financial Overview",
        cards: [
          {
            tone: "primary",
            label: "Total Revenue",
            value: money(overview.totalRevenueCents),
            caption: deltaCaption(
              "Retail/wholesale sales + invoice payments actually received",
              overview.totalRevenueChangePercent
            )
          },
          {
            tone: "teal",
            label: "Net Revenue",
            value: money(overview.netRevenueCents),
            caption: deltaCaption("(Sale price − cost of goods) on the cash collected so far", overview.netRevenueChangePercent)
          },
          {
            tone: "danger",
            label: "Total Expenses",
            value: money(overview.totalExpensesCents),
            caption: deltaCaption("Expenses + supplier payments + salaries actually paid", overview.totalExpensesChangePercent)
          },
          {
            tone: overview.netProfitCents >= 0 ? "success" : "danger",
            label: "Net Profit",
            value: money(overview.netProfitCents),
            caption: deltaCaption("Net Revenue − Total Expenses", overview.netProfitChangePercent)
          }
        ]
      },
      {
        type: "tiles",
        tiles: [
          { label: "Transactions", value: String(overview.transactionCount) },
          { label: "Average Sale", value: money(overview.averageSaleCents) },
          { label: "Items Sold", value: String(overview.itemsSold) },
          ...(overview.spansMultipleDays
            ? [{ label: "Average Daily Revenue", value: money(overview.averageDailyRevenueCents) }]
            : [])
        ]
      },
      {
        type: "bars",
        title: "Sales by Payment Method",
        items: byPaymentMethod.map((row, index) => ({
          label: row.paymentMethodName,
          value: money(row.revenueCents),
          percent: percentBars(byPaymentMethod, (r) => r.revenueCents)[index] ?? 2,
          color: categoricalColor(index)
        }))
      },
      overview.topProducts.length > 0 && {
        type: "table",
        title: "Top 10 Products Sold",
        columns: [
          { key: "product", header: "Product" },
          { key: "qty", header: "Qty Sold", align: "right" },
          { key: "revenue", header: "Revenue", align: "right" }
        ],
        rows: overview.topProducts.map((product) => ({
          product: product.productName,
          qty: String(product.quantitySold),
          revenue: money(product.revenueCents)
        }))
      },
      {
        type: "bars",
        title: "Sales by Storefront",
        items: byStorefront.map((row, index) => ({
          label: row.locationName,
          value: money(row.revenueCents),
          percent: percentBars(byStorefront, (r) => r.revenueCents)[index] ?? 2
        }))
      },
      byStorefront.length > 0 && {
        type: "table",
        title: "Sales by Storefront — Detail",
        columns: [
          { key: "storefront", header: "Storefront" },
          { key: "transactions", header: "Transactions", align: "right" },
          { key: "revenue", header: "Revenue", align: "right" },
          { key: "avgSale", header: "Avg Sale", align: "right" },
          { key: "percent", header: "% of Total", align: "right" }
        ],
        rows: byStorefront.map((row) => ({
          storefront: row.locationName,
          transactions: String(row.transactionCount),
          revenue: money(row.revenueCents),
          avgSale: money(row.averageSaleCents),
          percent: `${row.percentOfTotal.toFixed(1)}%`
        }))
      },
      {
        type: "bars",
        title: "Sales by Employee",
        items: byEmployee.map((row, index) => ({
          label: row.employeeName,
          sublabel: row.branchName ?? undefined,
          value: money(row.revenueCents),
          percent: percentBars(byEmployee, (r) => r.revenueCents)[index] ?? 2
        }))
      },
      byEmployee.length > 0 && {
        type: "table",
        title: "Sales by Employee — Detail",
        columns: [
          { key: "employee", header: "Employee" },
          { key: "branch", header: "Branch" },
          { key: "transactions", header: "Transactions", align: "right" },
          { key: "revenue", header: "Revenue", align: "right" },
          { key: "avgSale", header: "Avg Sale", align: "right" },
          { key: "percent", header: "% of Total", align: "right" }
        ],
        rows: byEmployee.map((row) => ({
          employee: row.employeeName,
          branch: row.branchName ?? "—",
          transactions: String(row.transactionCount),
          revenue: money(row.revenueCents),
          avgSale: money(row.averageSaleCents),
          percent: `${row.percentOfTotal.toFixed(1)}%`
        }))
      },
      overview.expensesByCategory.length > 0 && {
        type: "table",
        title: "Expenses by Category",
        columns: [
          { key: "category", header: "Category" },
          { key: "count", header: "Times Paid", align: "right" },
          { key: "total", header: "Total", align: "right" },
          { key: "percent", header: "% of Total", align: "right" }
        ],
        rows: overview.expensesByCategory.map((entry) => ({
          category: entry.name,
          count: String(entry.documentCount),
          total: money(entry.totalCents),
          percent: `${entry.percentOfTotal.toFixed(1)}%`
        }))
      },
      overview.purchasesBySupplier.length > 0 && {
        type: "table",
        title: "Purchases by Supplier",
        columns: [
          { key: "supplier", header: "Supplier" },
          { key: "count", header: "Times Paid", align: "right" },
          { key: "total", header: "Total", align: "right" },
          { key: "percent", header: "% of Total", align: "right" }
        ],
        rows: overview.purchasesBySupplier.map((entry) => ({
          supplier: entry.name,
          count: String(entry.documentCount),
          total: money(entry.totalCents),
          percent: `${entry.percentOfTotal.toFixed(1)}%`
        }))
      },
      overview.salariesByEmployee.length > 0 && {
        type: "table",
        title: "Salaries by Employee",
        columns: [
          { key: "employee", header: "Employee" },
          { key: "count", header: "Times Paid", align: "right" },
          { key: "total", header: "Total", align: "right" },
          { key: "percent", header: "% of Total", align: "right" }
        ],
        rows: overview.salariesByEmployee.map((entry) => ({
          employee: entry.name,
          count: String(entry.documentCount),
          total: money(entry.totalCents),
          percent: `${entry.percentOfTotal.toFixed(1)}%`
        }))
      },
      {
        type: "table",
        title: "All Transactions",
        description: `${resolvedRange.startDate} to ${resolvedRange.endDate}`,
        columns: [
          { key: "occurredAt", header: "Date & Time" },
          { key: "document", header: "Document" },
          { key: "type", header: "Type" },
          { key: "location", header: "Location" },
          { key: "employee", header: "Employee" },
          { key: "customer", header: "Customer" },
          { key: "method", header: "Method" },
          { key: "amount", header: "Amount", align: "right" },
          { key: "paid", header: "Paid", align: "right" },
          { key: "status", header: "Status" }
        ],
        rows: transactions.map((row) => ({
          occurredAt: new Date(row.occurredAt).toLocaleString(),
          document: row.documentNumber ?? "—",
          type: TRANSACTION_KIND_LABEL[row.kind],
          location: row.locationName,
          employee: row.employeeName,
          customer: row.customerName ?? "—",
          method: row.paymentMethodName ?? "Other",
          amount: money(row.amountCents),
          paid: money(row.amountPaidCents),
          status: transactionStatusLabel(row)
        }))
      },
      {
        type: "cards",
        title: "Voided Sales & Processed Returns",
        cards: [
          {
            tone: "danger",
            label: "Voided Sales",
            value: String(overview.voidStats.count),
            caption: `Worth ${money(overview.voidStats.totalValueCents)} — removed entirely from every figure above`
          },
          {
            tone: "warning",
            label: "Processed Returns",
            value: String(overview.processedReturns.length),
            caption: `Worth ${money(overview.processedReturns.reduce((sum, r) => sum + r.returnedValueCents, 0))} refunded — subtracted from Total Revenue`
          }
        ]
      },
      overview.processedReturns.length > 0 && {
        type: "table",
        title: "Processed Returns, Most Recent First",
        columns: [
          { key: "approved", header: "Approved" },
          { key: "document", header: "Document" },
          { key: "customer", header: "Customer" },
          { key: "reason", header: "Reason" },
          { key: "qty", header: "Qty", align: "right" },
          { key: "refunded", header: "Refunded", align: "right" }
        ],
        rows: overview.processedReturns.map((entry) => ({
          approved: new Date(entry.approvedAt).toLocaleString(),
          document: entry.documentNumber ?? "—",
          customer: entry.customerName ?? "—",
          reason: entry.reason,
          qty: String(entry.returnedQuantity),
          refunded: money(entry.returnedValueCents)
        }))
      },
      {
        type: "cards",
        title: "Debtors, Creditors & Expected Profit",
        cards: [
          {
            tone: "primary",
            label: "Debtors",
            value: money(overview.totalDebtCents),
            caption: "Unpaid balances owed to you by customers"
          },
          {
            tone: "danger",
            label: "Creditors",
            value: money(overview.totalCreditCents),
            caption: "Unpaid balances you owe to suppliers"
          },
          {
            tone: overview.expectedProfitCents >= 0 ? "success" : "danger",
            label: "Expected Profit",
            value: money(overview.expectedProfitCents),
            caption: "Net Profit + money owed to you − money you owe"
          }
        ]
      },
      overview.debtors.length > 0 && {
        type: "table",
        title: "Debtors — Who Owes You",
        columns: [
          { key: "name", header: "Customer" },
          { key: "documents", header: "Documents", align: "right" },
          { key: "balance", header: "Balance", align: "right" }
        ],
        rows: overview.debtors.map((party) => ({
          name: party.name,
          documents: String(party.documentCount),
          balance: money(party.balanceCents)
        }))
      },
      overview.creditors.length > 0 && {
        type: "table",
        title: "Creditors — Who You Owe",
        columns: [
          { key: "name", header: "Supplier" },
          { key: "documents", header: "Documents", align: "right" },
          { key: "balance", header: "Balance", align: "right" }
        ],
        rows: overview.creditors.map((party) => ({
          name: party.name,
          documents: String(party.documentCount),
          balance: money(party.balanceCents)
        }))
      }
    ];
    const sections = rawSections.filter((section): section is ReportExportSection => Boolean(section));

    return {
      module: "reports",
      title: "Sales Report",
      subtitle: `${resolvedRange.startDate} to ${resolvedRange.endDate}`,
      sections,
      fileBaseName: `SalesReport_${resolvedRange.startDate}_to_${resolvedRange.endDate}`
    };
  }, [overview, transactions, byStorefront, byEmployee, byPaymentMethod, resolvedRange]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative mt-6 space-y-5 pb-10 pl-4"
    >
      <span
        className="pointer-events-none absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-2 left-0 top-2 border-l-2 border-dashed border-line"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -left-[5px] bottom-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Insights</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <BarChart3 className="size-5 text-primary" aria-hidden="true" />
              Sales Report
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Pick a period — every figure below, from the financial overview to the transaction list, resolves to it.
            </p>
          </div>
          {canExport && reportExportRequest && <ReportExportMenu request={reportExportRequest} />}
        </div>

        <div className="mt-5">
          <SalesModeSelector
            mode={mode}
            onModeChange={handleModeChange}
            anchor={anchor}
            onAnchorChange={setAnchor}
            customRange={customRange}
            onCustomRangeChange={setCustomRange}
          />
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
        )}

        <div className={cn("mt-6 space-y-8 transition-opacity", loading && "opacity-60")}>
          {overview && (
            <>
              <FinancialOverviewCards overview={overview} />

              <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-3", overview.spansMultipleDays && "lg:grid-cols-4")}>
                <ReportStatTile label="Transactions" value={String(overview.transactionCount)} />
                <ReportStatTile label="Average sale" value={money(overview.averageSaleCents)} />
                <ReportStatTile label="Items sold" value={String(overview.itemsSold)} />
                {overview.spansMultipleDays && (
                  <ReportStatTile label="Average daily revenue" value={money(overview.averageDailyRevenueCents)} />
                )}
              </div>


              <RevenueExpenseBreakdown
                overview={overview}
                onNavigateToProducts={() => setActiveNavKey("reports-products")}
                onNavigateToExpenses={() => setActiveNavKey("expenses")}
                onNavigateToPurchases={() => setActiveNavKey("purchases")}
                onNavigateToSalaries={() => setActiveNavKey("salaries")}
              />
            </>
          )}

          <div>
            <SectionHeading title={TREND_TITLE[mode]} />
            <div className="mt-3 rounded-lg border border-line bg-white p-4">
              <TrendAreaChart points={trendPoints} formatValue={money} />
            </div>
          </div>

          {/* Sales by Payment Method */}
          <div>
            <p className="text-sm font-extrabold text-ink">Sales by Payment Method</p>
            <p className="mt-0.5 text-xs font-semibold text-muted">
              Money actually received — an unpaid invoice balance isn&rsquo;t counted toward any method yet.
            </p>
            <div className="mt-3 rounded-lg border border-line bg-white p-4">
              <HorizontalBarList items={paymentBars} formatValue={money} categorical emptyMessage="No payments received in this period." />
              {overview && <GrossVsNetFootnote overview={overview} />}
            </div>
          </div>

          {/* Sales by Storefront */}
          <div>
            <p className="text-sm font-extrabold text-ink">Sales by Storefront</p>
            <div className="mt-3 rounded-lg border border-line bg-white p-4">
              <HorizontalBarList items={storefrontBars} formatValue={money} emptyMessage="No sales at any storefront in this period." />
              {overview && <GrossVsNetFootnote overview={overview} />}
            </div>
            {byStorefront.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[600px] table-fixed border-collapse text-sm">
                  <thead>
                    <tr className="bg-primary text-white">
                      <Th>Storefront</Th>
                      <Th className="text-right">Transactions</Th>
                      <Th className="text-right">Revenue</Th>
                      <Th className="text-right">Avg Sale</Th>
                      <Th className="text-right">% of Total</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {byStorefront.map((row) => (
                      <tr key={row.locationId} className="border-t border-line odd:bg-white even:bg-soft/50">
                        <td className="truncate px-3 py-2 font-bold text-ink">{row.locationName}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{row.transactionCount}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(row.revenueCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{money(row.averageSaleCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{row.percentOfTotal.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Sales by Employee */}
          <div>
            <p className="text-sm font-extrabold text-ink">Sales by Employee</p>
            <div className="mt-3 rounded-lg border border-line bg-white p-4">
              <HorizontalBarList items={employeeBars} formatValue={money} emptyMessage="No sales recorded by any employee in this period." />
              {overview && <GrossVsNetFootnote overview={overview} />}
            </div>
            {byEmployee.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[650px] table-fixed border-collapse text-sm">
                  <thead>
                    <tr className="bg-primary text-white">
                      <Th>Employee</Th>
                      <Th>Branch</Th>
                      <Th className="text-right">Transactions</Th>
                      <Th className="text-right">Revenue</Th>
                      <Th className="text-right">Avg Sale</Th>
                      <Th className="text-right">% of Total</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {byEmployee.map((row) => (
                      <tr key={row.employeeId} className="border-t border-line odd:bg-white even:bg-soft/50">
                        <td className="truncate px-3 py-2 font-bold text-ink">{row.employeeName}</td>
                        <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.branchName ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{row.transactionCount}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(row.revenueCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{money(row.averageSaleCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{row.percentOfTotal.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* All transactions */}
          <div>
            <SectionHeading title="All Transactions" description="Every sale and invoice payment in this period, most recent first." />
            <div className="mt-3">
              <TransactionsList transactions={transactions} />
            </div>
          </div>

              <AccuracyLimitationsNotice />


          {overview && <VoidsAndReturnsSection voidStats={overview.voidStats} processedReturns={overview.processedReturns} />}

          {cancelledPurchases && <CancelledPurchasesSection report={cancelledPurchases} />}

          {overview && (
            <DebtorsCreditorsSection
              debtors={overview.debtors}
              totalDebtCents={overview.totalDebtCents}
              creditors={overview.creditors}
              totalCreditCents={overview.totalCreditCents}
              expectedProfitCents={overview.expectedProfitCents}
            />
          )}

          <SalesReportNotes />
        </div>
      </section>
    </motion.div>
  );
}
