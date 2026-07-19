import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import { DashboardActionCard } from "@renderer/app/routes/dashboard/DashboardActionCard";
import { DashboardShell } from "@renderer/app/routes/dashboard/DashboardShell";
import { SyncStatusCard } from "@renderer/app/routes/dashboard/SyncStatusCard";
import { OverviewCard } from "@renderer/app/routes/reports/FinancialOverviewCards";
import { todayIso } from "@renderer/app/routes/reports/salesReportDate";
import type { MySaleEntry, SalesByEmployeeRow } from "@shared/types/report";
import type { PendingSaleListItem } from "@shared/types/sale";

function money(cents: number): string {
  return formatCents(cents);
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type CashierData = {
  myRow: SalesByEmployeeRow | null;
  mySales: MySaleEntry[];
  heldSales: PendingSaleListItem[];
  myPendingCount: number;
  myApprovedCount: number;
};

/** The cashier's view: personal performance first, the shop's own pulse
 * second and smaller, plus whatever's actionable right now — held carts to
 * finish, and the status of any void/return requests this cashier raised.
 * No trend, no week-over-week, no team ranking — cashiers report having
 * hated a visible rank, and the goal here is "what do I do next," not a
 * leaderboard. */
export function CashierDashboard(): React.JSX.Element {
  const { session } = usePermissions();
  const setActiveNavKey = useUiStore((state) => state.setActiveNavKey);
  const [data, setData] = useState<CashierData | null>(null);
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
        const employeeId = session?.employee.id;

        const [byEmployee, mySales, heldSales, voids, returns] = await Promise.all([
          window.blueLedger.report.salesByEmployee(range),
          window.blueLedger.report.mySales(range),
          window.blueLedger.sale.listPending(),
          window.blueLedger.saleVoid.list(),
          window.blueLedger.saleReturn.list(),
        ]);

        if (cancelled) return;

        const myVoids = voids.filter((v) => v.requestedBy === employeeId);
        const myReturns = returns.filter((r) => r.requestedBy === employeeId);

        setData({
          myRow: byEmployee.find((row) => row.employeeId === employeeId) ?? null,
          mySales,
          heldSales,
          myPendingCount:
            myVoids.filter((v) => v.status === "pending_approval").length + myReturns.filter((r) => r.status === "pending_approval").length,
          myApprovedCount: myVoids.filter((v) => v.status === "approved").length + myReturns.filter((r) => r.status === "approved").length,
        });
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, "Failed to load the dashboard"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.employee.id]);

  const heldSalesValueCents = useMemo(() => (data?.heldSales ?? []).reduce((sum, s) => sum + s.grandTotalCents, 0), [data]);

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
            <OverviewCard tone="primary" label="My Sales Today" valueCents={data.myRow?.revenueCents ?? 0} formula="Total revenue you've rung up" footnote="So far today" />
            <OverviewCard tone="teal" label="My Transactions" displayValue={String(data.myRow?.transactionCount ?? 0)} formula="Sales you've completed" footnote="So far today" />
            <OverviewCard tone="warning" label="My Average Sale" valueCents={data.myRow?.averageSaleCents ?? 0} formula="Average per transaction" footnote="So far today" />
          </div>

          <div className="rounded-lg border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <h3 className="text-sm font-extrabold text-ink">My sales today</h3>
            </div>
            {data.mySales.length === 0 ? (
              <p className="p-4 text-sm font-semibold text-muted">You haven't completed any sales yet today.</p>
            ) : (
              <div className="max-h-[360px] overflow-y-auto">
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-primary text-white">
                      <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Receipt</th>
                      <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Time</th>
                      <th className="px-4 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mySales.map((sale) => (
                      <tr key={sale.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                        <td className="truncate px-4 py-2.5 font-bold text-ink">{sale.documentNumber ?? "No receipt #"}</td>
                        <td className="px-4 py-2.5 text-xs font-semibold text-muted">{time(sale.occurredAt)}</td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums text-ink">{money(sale.amountCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-line bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h3 className="text-sm font-extrabold text-ink">Held sales</h3>
              <button
                type="button"
                onClick={() => setActiveNavKey("checkout")}
                className="flex items-center gap-1 text-[11px] font-bold text-accent hover:underline cursor-pointer"
              >
                Go process
                <ArrowRight className="size-3" aria-hidden="true" />
              </button>
            </div>
            {data.heldSales.length === 0 ? (
              <p className="p-4 text-sm font-semibold text-muted">Nothing on hold right now.</p>
            ) : (
              <table className="w-full table-fixed border-collapse text-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Customer</th>
                    <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Items</th>
                    <th className="px-4 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.heldSales.map((sale) => (
                    <tr key={sale.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="truncate px-4 py-2.5 font-bold text-ink">{sale.customerName ?? "Walk-in"}</td>
                      <td className="px-4 py-2.5 text-xs font-semibold text-muted">{sale.itemCount} item{sale.itemCount === 1 ? "" : "s"}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-ink">{money(sale.grandTotalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.heldSales.length > 0 && (
              <p className="border-t border-line px-4 py-2 text-xs font-semibold text-muted">{money(heldSalesValueCents)} total on hold</p>
            )}
          </div>
        </>
      }
      aside={
        <>
          <DashboardActionCard
            tone="danger"
            label="Waiting Approval"
            value={String(data.myPendingCount)}
            sublabel="Void & return requests you raised"
            actionLabel="View approvals"
            onAction={() => setActiveNavKey("approvals")}
          />
          <DashboardActionCard
            tone="success"
            label="Already Approved"
            value={String(data.myApprovedCount)}
            sublabel="Your requests, resolved"
            actionLabel="View approvals"
            onAction={() => setActiveNavKey("approvals")}
          />
          <SyncStatusCard />
        </>
      }
    />
  );
}
