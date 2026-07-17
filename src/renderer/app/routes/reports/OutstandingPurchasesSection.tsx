import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { OutstandingPurchasesSummary } from "@shared/types/supplier-report";
import { OverviewCard } from "./FinancialOverviewCards";

function money(cents: number): string {
  return formatCents(cents);
}

const STATUS_LABEL: Record<string, string> = {
  ordered: "Ordered",
  partially_received: "Partially Received",
  received: "Received",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Every currently-outstanding purchase — a live balance-sheet snapshot.
 * Purchases have no due date in this schema, so days outstanding (since the
 * PO was placed) stands in for "overdue", flagged past 30 days. */
export function OutstandingPurchasesSection({ summary }: { summary: OutstandingPurchasesSummary }): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-extrabold text-ink">Outstanding Supplier Payments</h3>
        <p className="mt-0.5 text-xs font-semibold text-muted">A live snapshot as of today.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OverviewCard
          tone="danger"
          label="Total Outstanding"
          valueCents={summary.totalOutstandingCents}
          formula="Sum of every unpaid purchase balance"
        />
        <OverviewCard
          tone="teal"
          label="Creditors"
          displayValue={String(summary.creditorCount)}
          formula="Distinct suppliers you owe money to"
        />
      </div>

      <div className="rounded-lg border border-line bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Outstanding purchases, oldest first</p>

        {summary.purchases.length === 0 ? (
          <p className="mt-4 text-sm font-semibold text-muted">No outstanding supplier payments right now.</p>
        ) : (
          <div className="mt-3 max-h-[480px] overflow-y-auto rounded-lg border border-line">
            <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-primary text-white">
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Supplier</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">PO Number</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Ordered</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Total</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Paid</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Balance</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Days Out</th>
                </tr>
              </thead>
              <tbody>
                {summary.purchases.map((purchase) => (
                  <tr
                    key={purchase.purchaseId}
                    className={cn("border-t border-line", purchase.daysOutstanding > 30 ? "bg-danger-soft/40" : "odd:bg-white even:bg-soft/50")}
                  >
                    <td className="line-clamp-2 px-3 py-2 font-bold leading-snug text-ink">{purchase.supplierName}</td>
                    <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{purchase.purchaseNumber}</td>
                    <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{STATUS_LABEL[purchase.status] ?? purchase.status}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{formatDate(purchase.orderedAt)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{money(purchase.grandTotalCents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{money(purchase.amountPaidCents)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(purchase.balanceCents)}</td>
                    <td className={cn("px-3 py-2 text-right font-bold tabular-nums", purchase.daysOutstanding > 30 ? "text-danger" : "text-muted")}>
                      {purchase.daysOutstanding}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
