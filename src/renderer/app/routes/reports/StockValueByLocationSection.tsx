import { HorizontalBarList } from "@renderer/shared/components/charts/HorizontalBarList";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { LocationValueEntry } from "@shared/types/inventory-report";

function money(cents: number): string {
  return formatCents(cents);
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <th className={cn("px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>{children}</th>;
}

/** Where the stock money sits — Main Store first, then each storefront — at buying and at selling
 * price. Same numbers as each location's own Stock Value below, side by side. */
export function StockValueByLocationSection({ entries, totalCents }: { entries: LocationValueEntry[]; totalCents: number }): React.JSX.Element {
  const bars = entries.map((entry) => ({
    key: entry.locationId,
    label: entry.isMainStore ? `${entry.locationName} (Main Store)` : entry.locationName,
    value: entry.valueCents
  }));

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Stock value by location</p>
      <div className="mt-3">
        <HorizontalBarList items={bars} formatValue={money} categorical emptyMessage="No stock recorded yet." />
      </div>
      {entries.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-white">
                <Th className="w-[34%]">Location</Th>
                <Th className="text-right">Units</Th>
                <Th className="text-right">Value (Buying)</Th>
                <Th className="text-right">Value (Selling)</Th>
                <Th className="text-right">% of Total</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.locationId} className="border-t border-line odd:bg-white even:bg-soft/50">
                  <td className="truncate px-3 py-2 font-bold text-ink">
                    {entry.locationName}
                    {entry.isMainStore && <span className="ml-1.5 text-[10px] font-extrabold uppercase tracking-wide text-teal">Main Store</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{entry.totalUnits}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(entry.valueCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{money(entry.retailValueCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{entry.percentOfTotal.toFixed(1)}%</td>
                </tr>
              ))}
              {entries.length > 1 && (
                <tr className="border-t-2 border-line bg-soft">
                  <td className="px-3 py-2 font-extrabold text-ink">Total</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{entries.reduce((sum, entry) => sum + entry.totalUnits, 0)}</td>
                  <td className="px-3 py-2 text-right font-extrabold tabular-nums text-ink">{money(totalCents)}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(entries.reduce((sum, entry) => sum + entry.retailValueCents, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">100%</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
