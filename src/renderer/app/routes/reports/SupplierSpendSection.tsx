import { HorizontalBarList, type HorizontalBarItem } from "@renderer/shared/components/charts/HorizontalBarList";
import { formatCents } from "@renderer/shared/lib/money";
import type { SupplierSpendRow } from "@shared/types/supplier-report";

const BAR_LIMIT = 10;

/** Which suppliers we bought from the most in the selected period, by total purchase value — a
 * progress-bar ranking of the top 10, plus the full breakdown with each supplier's share of total
 * spend below it. */
export function SupplierSpendSection({ rows }: { rows: SupplierSpendRow[] }): React.JSX.Element {
  const barItems: HorizontalBarItem[] = rows.slice(0, BAR_LIMIT).map((row) => ({
    key: row.supplierId,
    label: row.supplierName,
    value: row.totalSpentCents
  }));

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Top suppliers by spend</p>
      <div className="mt-3">
        <HorizontalBarList
          items={barItems}
          formatValue={formatCents}
          categorical
          emptyMessage="No purchases from any supplier in this period."
        />
      </div>

      {rows.length > 0 && (
        <div className="mt-5 max-h-[420px] overflow-y-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-primary text-white">
                <th className="w-10 px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">#</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Supplier</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Purchases</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Total Spent</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.supplierId} className="border-t border-line odd:bg-white even:bg-soft/50">
                  <td className="px-3 py-2 font-bold text-muted">{index + 1}</td>
                  <td className="line-clamp-2 px-3 py-2 font-bold leading-snug text-ink">{row.supplierName}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{row.purchaseCount}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{formatCents(row.totalSpentCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{row.percentOfTotal.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
