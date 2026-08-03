import { DashedPill } from "@renderer/shared/components/DashedPill";
import { formatCents } from "@renderer/shared/lib/money";
import { taxBreakdownLabel } from "@shared/lib/tax-calculation";
import type { TaxReport } from "@shared/types/tax-report";

/** Compact tax-collected-by-category summary for the selected period — the full top-10-per-category
 * breakdown lives on its own standalone Tax Report (Insights > Tax Report); this is just enough to
 * answer "how much tax did we collect this period, by category" without leaving the Sales Report. */
export function TaxBreakdownReportSection({ report }: { report: TaxReport }): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-extrabold text-ink">Tax Breakdown</h3>
        <p className="mt-0.5 text-xs font-semibold text-muted">
          Tax collected by category for the period above — see the standalone Tax Report for top products per category.
        </p>
      </div>

      {report.byCategory.length === 0 ? (
        <div className="flex min-h-[100px] items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 text-sm font-semibold text-muted">
          No taxable sales in this period.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[500px] table-fixed border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-white">
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Category</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Net</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Tax</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Gross</th>
              </tr>
            </thead>
            <tbody>
              {report.byCategory.map((entry) => (
                <tr key={entry.taxType} className="border-t border-line odd:bg-white even:bg-soft/50">
                  <td className="px-3 py-2">
                    <DashedPill tone="accent">
                      {taxBreakdownLabel(entry.taxType, { vatRatePercent: report.vatRatePercent, pricesTaxInclusive: true })}
                    </DashedPill>
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">{formatCents(entry.netCents)}</td>
                  <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted">{formatCents(entry.taxCents)}</td>
                  <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-ink">{formatCents(entry.grossCents)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line bg-soft/70">
                <td className="px-3 py-2 text-xs font-extrabold uppercase text-ink">Total</td>
                <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-ink">{formatCents(report.totalNetCents)}</td>
                <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-ink">{formatCents(report.totalTaxCents)}</td>
                <td className="px-3 py-2 text-right text-sm font-extrabold tabular-nums text-ink">{formatCents(report.totalGrossCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
