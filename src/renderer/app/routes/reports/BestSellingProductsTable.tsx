import { useMemo, useState } from "react";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { ProductPerformanceRow } from "@shared/types/product-report";

function money(cents: number): string {
  return formatCents(cents);
}

type SortKey = "quantitySold" | "revenueCents" | "profitCents";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "quantitySold", label: "By Quantity" },
  { key: "revenueCents", label: "By Revenue" },
  { key: "profitCents", label: "By Profit" },
];

/** The top N products (user-adjustable, defaults to 20) by whichever metric is selected —
 * re-sorted client side from the full set of products that sold anything in the period, so
 * switching to "By Revenue" can surface a low-volume, high-value product that a quantity-only
 * cut would have dropped entirely. */
export function BestSellingProductsTable({ rows }: { rows: ProductPerformanceRow[] }): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>("quantitySold");
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  const topRows = useMemo(() => [...rows].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, limit), [rows, sortKey, limit]);

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Best selling products</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Show</span>
            <input
              type="number"
              min={1}
              max={MAX_LIMIT}
              value={limit}
              onChange={(event) => setLimit(Math.max(1, Math.min(MAX_LIMIT, Number(event.target.value) || 1)))}
              className="h-7 w-16 rounded-md border border-line bg-white px-2 text-xs font-bold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </label>
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
      </div>

      {topRows.length === 0 ? (
        <p className="mt-4 text-sm font-semibold text-muted">No products sold in this period.</p>
      ) : (
        <div className="mt-3 max-h-[520px] overflow-y-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-primary text-white">
                <th className="w-10 px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">#</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Product</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">SKU</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Category</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Qty Sold</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Revenue</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Profit</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Margin</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map((row, index) => (
                <tr key={row.productId} className="border-t border-line odd:bg-white even:bg-soft/50">
                  <td className="px-3 py-2 font-bold text-muted">{index + 1}</td>
                  <td className="line-clamp-2 px-3 py-2 font-bold leading-snug text-ink">{row.productName}</td>
                  <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.sku}</td>
                  <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.categoryName ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{row.quantitySold}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(row.revenueCents)}</td>
                  <td className={cn("px-3 py-2 text-right font-bold tabular-nums", row.profitCents >= 0 ? "text-success" : "text-danger")}>
                    {money(row.profitCents)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {row.revenueCents > 0 ? `${((row.profitCents / row.revenueCents) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
