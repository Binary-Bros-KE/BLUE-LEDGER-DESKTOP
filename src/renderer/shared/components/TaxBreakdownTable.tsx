import { taxBreakdownLabel, type TaxBreakdownEntry, type TenantTaxConfig } from "@shared/lib/tax-calculation";
import { formatCents } from "@renderer/shared/lib/money";

/** The tax breakdown every document shows below its totals — never contributing to the total
 * itself (see tax-calculation.ts), this is the one place tax is actually surfaced, as required by
 * law. Shared by every on-screen document view (Checkout/Invoices/Quotations/Receipts) so the
 * layout never drifts between them. */
export function TaxBreakdownTable({
  breakdown,
  tenantTaxConfig
}: {
  breakdown: TaxBreakdownEntry[];
  tenantTaxConfig: TenantTaxConfig;
}): React.JSX.Element | null {
  if (breakdown.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Tax Breakdown</p>
      <div className="mt-1.5 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[360px] border-collapse text-xs">
          <thead>
            <tr className="bg-soft">
              <th className="px-2.5 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-muted">
                Category
              </th>
              <th className="px-2.5 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-muted">
                Net
              </th>
              <th className="px-2.5 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-muted">
                Tax
              </th>
              <th className="px-2.5 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wide text-muted">
                Gross
              </th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((entry) => (
              <tr key={entry.taxType} className="border-t border-line">
                <td className="px-2.5 py-1.5 font-bold text-ink">{taxBreakdownLabel(entry.taxType, tenantTaxConfig)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-muted">{formatCents(entry.netCents)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-muted">{formatCents(entry.taxCents)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums font-bold text-ink">{formatCents(entry.grossCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
