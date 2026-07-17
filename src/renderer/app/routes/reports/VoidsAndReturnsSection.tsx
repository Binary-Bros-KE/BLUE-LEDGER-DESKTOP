import { formatCents } from "@renderer/shared/lib/money";
import type { SalesProcessedReturn, SalesVoidStats } from "@shared/types/report";

function money(cents: number): string {
  return formatCents(cents);
}

function formatApprovedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** What changed vs. what was originally recorded — voided sales (dropped
 * entirely from every other figure on this page) and processed returns
 * (approving one assumes a refund was given, so it's what reduces Total
 * Revenue for the period it was approved in). Both dated by approval, not by
 * the original sale, since that's when the reversal actually happened. */
export function VoidsAndReturnsSection({
  voidStats,
  processedReturns,
}: {
  voidStats: SalesVoidStats;
  processedReturns: SalesProcessedReturn[];
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-extrabold text-ink">Voided Sales &amp; Processed Returns</h3>
        <p className="mt-0.5 text-xs font-semibold text-muted">
          Voids and approved returns processed in this period, dated by when they were approved.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Voided sales</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{voidStats.count}</p>
          <p className="mt-1 text-xs font-semibold text-muted">
            Worth {money(voidStats.totalValueCents)} — removed entirely from every figure on this page.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Processed returns</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{processedReturns.length}</p>
          <p className="mt-1 text-xs font-semibold text-muted">
            Worth {money(processedReturns.reduce((sum, r) => sum + r.returnedValueCents, 0))} refunded — subtracted from
            Total Revenue above.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Processed returns, most recent first</p>
        {processedReturns.length === 0 ? (
          <p className="mt-4 text-sm font-semibold text-muted">No returns were approved in this period.</p>
        ) : (
          <div className="mt-3 max-h-[320px] overflow-y-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-primary text-white">
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Approved</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Document</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Customer</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Reason</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Qty</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Refunded</th>
                </tr>
              </thead>
              <tbody>
                {processedReturns.map((entry) => (
                  <tr key={entry.returnId} className="border-t border-line odd:bg-white even:bg-soft/50">
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{formatApprovedAt(entry.approvedAt)}</td>
                    <td className="truncate px-3 py-2 font-bold text-ink">{entry.documentNumber ?? "—"}</td>
                    <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{entry.customerName ?? "—"}</td>
                    <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{entry.reason}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{entry.returnedQuantity}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(entry.returnedValueCents)}</td>
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
