import { useMemo, useState } from "react";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { TopCustomerRow } from "@shared/types/customer-report";

function money(cents: number): string {
  return formatCents(cents);
}

type SortKey = "revenueCents" | "transactionCount" | "averageSaleCents";
const TOP_LIMIT = 20;

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "revenueCents", label: "By Revenue" },
  { key: "transactionCount", label: "By Transactions" },
  { key: "averageSaleCents", label: "By Average Sale" },
];

/** The top 20 customers by whichever metric is selected — walk-in sales with
 * no customer attached are excluded entirely, since there's no one to rank. */
export function TopCustomersTable({ rows }: { rows: TopCustomerRow[] }): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>("revenueCents");

  const topRows = useMemo(() => [...rows].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, TOP_LIMIT), [rows, sortKey]);

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Top 20 customers</p>
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-soft p-1">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setSortKey(option.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition cursor-pointer",
                sortKey === option.key ? "bg-primary text-white" : "text-muted hover:bg-white"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {topRows.length === 0 ? (
        <p className="mt-4 text-sm font-semibold text-muted">No attributed customer sales in this period.</p>
      ) : (
        <div className="mt-3 max-h-[520px] overflow-y-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-primary text-white">
                <th className="w-10 px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">#</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Customer</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Phone</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Transactions</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Revenue</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Avg Sale</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map((row, index) => (
                <tr key={row.customerId} className="border-t border-line odd:bg-white even:bg-soft/50">
                  <td className="px-3 py-2 font-bold text-muted">{index + 1}</td>
                  <td className="line-clamp-2 px-3 py-2 font-bold leading-snug text-ink">{row.customerName}</td>
                  <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.phone}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{row.transactionCount}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(row.revenueCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{money(row.averageSaleCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
