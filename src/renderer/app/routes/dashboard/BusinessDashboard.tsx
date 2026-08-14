import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { HorizontalBarList } from "@renderer/shared/components/charts/HorizontalBarList";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast } from "@renderer/shared/lib/toast";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import { DashboardActionCard } from "@renderer/app/routes/dashboard/DashboardActionCard";
import { DashboardShell } from "@renderer/app/routes/dashboard/DashboardShell";
import { SyncStatusCard } from "@renderer/app/routes/dashboard/SyncStatusCard";
import { CARD_TONE_CYCLE, OverviewCard } from "@renderer/app/routes/reports/FinancialOverviewCards";
import { todayIso } from "@renderer/app/routes/reports/salesReportDate";
import type { PendingSaleListItem } from "@shared/types/sale";
import type { SalesByEmployeeRow, SalesByStorefrontRow, SalesFinancialOverview, SalesTransactionRow } from "@shared/types/report";

function money(cents: number): string {
  return formatCents(cents);
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type BusinessData = {
  overview: SalesFinancialOverview;
  transactions: SalesTransactionRow[];
  heldSales: PendingSaleListItem[];
  byStorefront: SalesByStorefrontRow[];
  byEmployee: SalesByEmployeeRow[];
  lowStockCount: number;
  outOfStockCount: number;
  totalDebtCents: number;
  debtorCount: number;
  totalCreditCents: number;
  creditorCount: number;
  pendingApprovalsCount: number;
  dueRecurringBillsCount: number;
  dueRecurringBillsTotalCents: number;
};

/** Shared by both the Super Admin and Manager dashboards — identical widgets,
 * identical layout; the only difference is whether the caller can see more
 * than one storefront. Every widget here is scoped to TODAY only — no
 * trends, no week-over-week, per explicit direction that this is a "what's
 * happening right now" screen, not a report. */
export function BusinessDashboard({ isBusinessWide }: { isBusinessWide: boolean }): React.JSX.Element {
  const setActiveNavKey = useUiStore((state) => state.setActiveNavKey);
  const [data, setData] = useState<BusinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const today = todayIso();
        const range = { startDate: today, endDate: today };

        const [overview, transactions, heldSales, byStorefront, byEmployee, inventoryData, voids, returns, recurringBills] =
          await Promise.all([
            window.blueLedger.report.salesFinancialOverview(range),
            window.blueLedger.report.salesTransactions(range),
            window.blueLedger.sale.listPending(),
            window.blueLedger.report.salesByStorefront(range),
            window.blueLedger.report.salesByEmployee(range),
            window.blueLedger.report.inventoryData({ locationId: null }),
            window.blueLedger.saleVoid.list(),
            window.blueLedger.saleReturn.list(),
            window.blueLedger.recurringBill.list().catch(() => []),
          ]);

        if (cancelled) return;

        const dueRecurringBills = recurringBills.filter(
          (bill) => bill.status === "active" && (bill.reminderStatus === "overdue" || bill.reminderStatus === "due_soon")
        );

        setData({
          overview,
          transactions,
          heldSales,
          byStorefront,
          byEmployee: [...byEmployee].sort((a, b) => b.revenueCents - a.revenueCents),
          lowStockCount: inventoryData.overview.lowStockProductCount,
          outOfStockCount: inventoryData.overview.outOfStockProductCount,
          totalDebtCents: overview.totalDebtCents,
          debtorCount: overview.debtors.length,
          totalCreditCents: overview.totalCreditCents,
          creditorCount: overview.creditors.length,
          pendingApprovalsCount:
            voids.filter((v) => v.status === "pending_approval").length + returns.filter((r) => r.status === "pending_approval").length,
          dueRecurringBillsCount: dueRecurringBills.length,
          dueRecurringBillsTotalCents: dueRecurringBills.reduce((sum, bill) => sum + bill.amountCents, 0),
        });
      } catch (err) {
        if (!cancelled) {
          const message = getErrorMessage(err, "Failed to load the dashboard");
          setError(message);
          showErrorToast(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const heldSalesValueCents = useMemo(() => (data?.heldSales ?? []).reduce((sum, s) => sum + s.grandTotalCents, 0), [data]);

  const employeeBars = useMemo(
    () => (data?.byEmployee ?? []).map((row) => ({ key: row.employeeId, label: row.employeeName, value: row.revenueCents })),
    [data]
  );

  if (error) {
    return <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>;
  }

  if (loading || !data) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-muted">
        <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <DashboardShell
      main={
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <OverviewCard tone="primary" label="Total Revenue" valueCents={data.overview.totalRevenueCents} formula="Cash received today" footnote="So far today" />
            <OverviewCard tone="teal" label="Transactions" displayValue={String(data.overview.transactionCount)} formula="Completed sales today" footnote="So far today" />
            <OverviewCard
              tone={data.overview.netProfitCents >= 0 ? "success" : "danger"}
              label="Net Profit"
              valueCents={data.overview.netProfitCents}
              formula="Net Revenue − Total Expenses"
              footnote="So far today"
            />
          </div>

          <div className="rounded-lg border border-line bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h3 className="text-sm font-extrabold text-ink">Today's sales</h3>
              <button
                type="button"
                onClick={() => setActiveNavKey("receipts")}
                className="text-[11px] font-bold text-accent hover:underline cursor-pointer"
              >
                Full Receipts
              </button>
            </div>
            {data.transactions.length === 0 ? (
              <p className="p-4 text-sm font-semibold text-muted">No sales recorded yet today.</p>
            ) : (
              <div className="max-h-[360px] overflow-y-auto">
                <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-primary text-white">
                      <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Time</th>
                      <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Receipt</th>
                      {isBusinessWide && (
                        <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Storefront</th>
                      )}
                      <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Customer</th>
                      <th className="px-4 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((sale) => (
                      <tr key={sale.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                        <td className="px-4 py-2.5 text-xs font-semibold text-muted">{time(sale.occurredAt)}</td>
                        <td className="truncate px-4 py-2.5 font-bold text-ink">{sale.documentNumber ?? "—"}</td>
                        {isBusinessWide && <td className="truncate px-4 py-2.5 text-xs font-semibold text-muted">{sale.locationName}</td>}
                        <td className="truncate px-4 py-2.5 text-xs font-semibold text-muted">{sale.customerName ?? "Walk-in"}</td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums text-ink">{money(sale.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid grid-cols-3 divide-x divide-line border-t border-line bg-soft/60">
              <div className="px-4 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Held Sales</p>
                <p className="mt-0.5 text-sm font-extrabold text-muted">
                  {data.heldSales.length} <span className="font-semibold">· {money(heldSalesValueCents)}</span>
                </p>
              </div>
              <div className="px-4 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Taxes</p>
                <p className="mt-0.5 text-sm font-extrabold text-muted">{money(data.overview.taxCollectedCents)}</p>
              </div>
              <div className="px-4 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Discounts</p>
                <p className="mt-0.5 text-sm font-extrabold text-muted">{money(data.overview.discountGivenCents)}</p>
              </div>
            </div>
          </div>

          {isBusinessWide && (
            <div>
              <h3 className="text-sm font-extrabold text-ink">Daily sales by storefront</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {data.byStorefront.length === 0 ? (
                  <p className="col-span-full rounded-lg border border-dashed border-line bg-soft/60 py-6 text-center text-sm font-semibold text-muted">
                    No sales recorded yet today.
                  </p>
                ) : (
                  data.byStorefront.map((row, index) => (
                    <OverviewCard
                      key={row.locationId}
                      tone={CARD_TONE_CYCLE[index % CARD_TONE_CYCLE.length]!}
                      label={row.locationName}
                      valueCents={row.revenueCents}
                      formula={`${row.transactionCount} sale${row.transactionCount === 1 ? "" : "s"} today`}
                      footnote={`${row.percentOfTotal.toFixed(0)}% of today's revenue`}
                    />
                  ))
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-line bg-white p-4">
            <h3 className="text-sm font-extrabold text-ink">Top 10 selling products today</h3>
            {data.overview.topProducts.length === 0 ? (
              <p className="mt-4 text-sm font-semibold text-muted">No products sold yet today.</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {data.overview.topProducts.map((product, index) => (
                  <li key={product.productId} className="flex items-start justify-between gap-3 text-sm">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="mt-0.5 grid size-5 flex-none place-items-center rounded-full bg-soft text-[10px] font-extrabold text-muted">
                        {index + 1}
                      </span>
                      <span className="line-clamp-2 font-bold leading-snug text-ink" title={product.productName}>
                        {product.productName}
                      </span>
                      <span className="mt-0.5 flex-none text-xs font-semibold text-muted">×{product.quantitySold}</span>
                    </div>
                    <span className="mt-0.5 w-20 flex-none text-right text-xs font-bold tabular-nums text-ink">{money(product.revenueCents)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="rounded-lg border border-line bg-white p-4">
            <h3 className="text-sm font-extrabold text-ink">Employee performance today</h3>
            <div className="mt-3">
              <HorizontalBarList items={employeeBars} formatValue={money} categorical emptyMessage="No sales recorded yet today." />
            </div>
          </div>
        </>
      }
      aside={
        <>
          <DashboardActionCard
            tone="warning"
            label="Pending Approvals"
            value={String(data.pendingApprovalsCount)}
            sublabel="Void & return requests"
            actionLabel="Review approvals"
            onAction={() => setActiveNavKey("approvals")}
          />
          <DashboardActionCard
            tone="primary"
            label="Debtors"
            value={String(data.debtorCount)}
            sublabel={`${money(data.totalDebtCents)} owed to you`}
            actionLabel="View debtors"
            onAction={() => setActiveNavKey("reports-customers")}
          />
          <DashboardActionCard
            tone="danger"
            label="Creditors"
            value={String(data.creditorCount)}
            sublabel={`${money(data.totalCreditCents)} you owe`}
            actionLabel="View creditors"
            onAction={() => setActiveNavKey("reports-suppliers")}
          />
          <DashboardActionCard
            tone="warning"
            label="Low Stock"
            value={String(data.lowStockCount)}
            sublabel="Products below reorder level"
            actionLabel="Check inventory"
            onAction={() => setActiveNavKey("reports-inventory")}
          />
          <DashboardActionCard
            tone="danger"
            label="Out of Stock"
            value={String(data.outOfStockCount)}
            sublabel="Products at zero"
            actionLabel="Check inventory"
            onAction={() => setActiveNavKey("reports-inventory")}
          />
          {data.dueRecurringBillsCount > 0 && (
            <DashboardActionCard
              tone="warning"
              label="Recurring Bills Due"
              value={String(data.dueRecurringBillsCount)}
              sublabel={`${money(data.dueRecurringBillsTotalCents)} expected — reminder only, nothing auto-paid`}
              actionLabel="Review bills"
              onAction={() => setActiveNavKey("expenses")}
            />
          )}
          <SyncStatusCard />
        </>
      }
    />
  );
}
