import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { SlowMovingProductRow } from "@shared/types/product-report";

function money(cents: number): string {
  return formatCents(cents);
}

function formatLastSold(row: SlowMovingProductRow): React.JSX.Element {
  if (row.lastSoldAt === null) {
    return <span className="font-bold text-danger">Never sold</span>;
  }
  const date = new Date(row.lastSoldAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return (
    <span>
      {date}
      {row.daysSinceLastSale !== null && (
        <span className={cn("ml-1.5 font-semibold", row.daysSinceLastSale > 30 ? "text-danger" : "text-muted")}>
          ({row.daysSinceLastSale}d ago)
        </span>
      )}
    </span>
  );
}

/** The 20 worst-moving products for the selected period — fewest units sold
 * first, with a "never sold" product sorting to the very top regardless of
 * period, since that's the most actionable signal here. */
export function SlowMovingProductsTable({ rows }: { rows: SlowMovingProductRow[] }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">20 slowest moving products</p>
      <p className="mt-0.5 text-xs font-semibold text-muted">
        Fewest units sold in this period first — includes products with zero sales entirely.
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm font-semibold text-muted">No products to show.</p>
      ) : (
        <div className="mt-3 max-h-[520px] overflow-y-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-primary text-white">
                <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Product</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">SKU</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Category</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Qty Sold (Period)</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Revenue (Period)</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Last Sold</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.productId} className="border-t border-line odd:bg-white even:bg-soft/50">
                  <td className="line-clamp-2 px-3 py-2 font-bold leading-snug text-ink">{row.productName}</td>
                  <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.sku}</td>
                  <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.categoryName ?? "—"}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-bold tabular-nums",
                      row.quantitySoldInPeriod === 0 ? "text-danger" : "text-ink"
                    )}
                  >
                    {row.quantitySoldInPeriod}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{money(row.revenueCentsInPeriod)}</td>
                  <td className="px-3 py-2 text-xs font-semibold text-muted">{formatLastSold(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
