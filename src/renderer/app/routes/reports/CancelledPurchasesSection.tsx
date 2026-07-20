import { formatCents } from "@renderer/shared/lib/money";
import type { CancelledPurchasesReport } from "@shared/types/report";

function money(cents: number): string {
  return formatCents(cents);
}

function formatCreatedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Purchases cancelled in this period — informational only. Reports assume a cancelled purchase was
 * never paid (or the money was returned), so it never contributes to supplier spend, expenses, or any
 * other figure on this page; this section exists purely so a cancelled order isn't invisible. */
export function CancelledPurchasesSection({ report }: { report: CancelledPurchasesReport }): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-extrabold text-ink">Cancelled Purchases</h3>
        <p className="mt-0.5 text-xs font-semibold text-muted">
          Purchase orders cancelled in this period. Assumed never paid (or refunded) — never counted toward
          supplier spend or any total on this page.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Cancelled purchases</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{report.count}</p>
          <p className="mt-1 text-xs font-semibold text-muted">Purchase orders cancelled this period.</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Cancelled value</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{money(report.totalCents)}</p>
          <p className="mt-1 text-xs font-semibold text-muted">Never included in expenses or supplier spend.</p>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Cancelled purchases, most recent first</p>
        {report.purchases.length === 0 ? (
          <p className="mt-4 text-sm font-semibold text-muted">No purchases were cancelled in this period.</p>
        ) : (
          <div className="mt-3 max-h-[320px] overflow-y-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-primary text-white">
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Cancelled</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Purchase #</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Supplier</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Storefront</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Value</th>
                </tr>
              </thead>
              <tbody>
                {report.purchases.map((entry) => (
                  <tr key={entry.purchaseId} className="border-t border-line odd:bg-white even:bg-soft/50">
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{formatCreatedAt(entry.createdAt)}</td>
                    <td className="truncate px-3 py-2 font-bold text-ink">{entry.purchaseNumber}</td>
                    <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{entry.supplierName}</td>
                    <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{entry.locationName}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(entry.grandTotalCents)}</td>
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
