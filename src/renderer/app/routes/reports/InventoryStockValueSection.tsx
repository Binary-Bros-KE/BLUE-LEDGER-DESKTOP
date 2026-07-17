import { HorizontalBarList } from "@renderer/shared/components/charts/HorizontalBarList";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { StockValueBreakdownEntry } from "@shared/types/inventory-report";

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

/** Stock value by category — cross-location, since a category's value spans
 * wherever its products happen to sit (Main Store, one storefront, several). */
export function InventoryStockValueSection({ entries }: { entries: StockValueBreakdownEntry[] }): React.JSX.Element {
  const bars = entries.map((entry) => ({ key: entry.id, label: entry.name, value: entry.valueCents }));

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Stock value by category</p>
      <div className="mt-3">
        <HorizontalBarList items={bars} formatValue={money} categorical emptyMessage="No stock recorded yet." />
      </div>
      {entries.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[480px] table-fixed border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-white">
                <Th>Category</Th>
                <Th className="text-right">Units</Th>
                <Th className="text-right">Value</Th>
                <Th className="text-right">% of Total</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                  <td className="truncate px-3 py-2 font-bold text-ink">{entry.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{entry.quantity}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(entry.valueCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{entry.percentOfTotal.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
