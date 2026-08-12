import { StatTile } from "@renderer/shared/components/StatTile";
import { formatCents } from "@renderer/shared/lib/money";
import type { LocalSourcingReport } from "@shared/types/local-sourcing-report";
import { Store } from "lucide-react";

/** Revenue/cost/margin from sales sourced from another shop rather than this shop's own stock, plus
 * a by-supplier breakdown and top locally-sourced products — the report the user asked for right
 * after the feature shipped: "local purchase sales stats, total cost, net revenue... by supplier." */
export function LocalSourcingReportSection({ report }: { report: LocalSourcingReport }): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-extrabold text-ink">Local Purchase Sales</h3>
        <p className="mt-0.5 text-xs font-semibold text-muted">
          Sales made from stock bought on the spot from another shop, for the period above.
        </p>
      </div>

      {report.lineCount === 0 ? (
        <div className="flex min-h-[100px] items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 text-sm font-semibold text-muted">
          No locally-sourced sales in this period.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile icon={Store} label="Revenue" value={formatCents(report.totalRevenueCents)} tone="primary" />
            <StatTile icon={Store} label="Cost Paid to Suppliers" value={formatCents(report.totalCostCents)} tone="warning" />
            <StatTile icon={Store} label="Net Margin" value={formatCents(report.totalNetMarginCents)} tone="accent" />
          </div>

          <div>
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-muted">By Local Supplier</p>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Supplier</th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Lines</th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Revenue</th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Cost</th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {report.bySupplier.map((entry) => (
                    <tr key={entry.supplierId ?? "none"} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="truncate px-3 py-2 font-bold text-ink">{entry.supplierName}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{entry.lineCount}</td>
                      <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">
                        {formatCents(entry.revenueCents)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">
                        {formatCents(entry.costCents)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-ink">
                        {formatCents(entry.netMarginCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-muted">Top Locally-Sourced Products</p>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[36%]" />
                  <col className="w-[12%]" />
                  <col className="w-[17%]" />
                  <col className="w-[17%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Product</th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Qty</th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Revenue</th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Cost</th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topProducts.map((entry) => (
                    <tr key={entry.productId} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="line-clamp-2 px-3 py-2 leading-snug font-bold text-ink" title={entry.productName}>
                        {entry.productName}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{entry.quantitySold}</td>
                      <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">
                        {formatCents(entry.revenueCents)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">
                        {formatCents(entry.costCents)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-ink">
                        {formatCents(entry.netMarginCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
