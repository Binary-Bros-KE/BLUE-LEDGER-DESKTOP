import { useMemo } from "react";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { LocationInventorySection } from "@shared/types/inventory-report";

function money(cents: number): string {
  return formatCents(cents);
}

function Badge({ isLow, isOutOfStock }: { isLow: boolean; isOutOfStock: boolean }): React.JSX.Element | null {
  if (isOutOfStock) {
    return <span className="ml-1.5 inline-block rounded bg-danger/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-danger">Out</span>;
  }
  if (isLow) {
    return <span className="ml-1.5 inline-block rounded bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warning">Low</span>;
  }
  return null;
}

/** The full picture for one product, across every location it's held —
 * opened from a product name that's too long to read comfortably in a
 * table cell. Each location's row is that location's own physical quantity
 * (no "combined" trick needed here, since every location gets its own line). */
export function ProductDetailModal({
  productId,
  sections,
  onClose,
}: {
  productId: string | null;
  sections: LocationInventorySection[];
  onClose: () => void;
}): React.JSX.Element {
  const details = useMemo(() => {
    if (!productId) return null;
    const matches = sections
      .map((section) => {
        const row = section.products.find((product) => product.productId === productId);
        if (!row) return null;
        return { section, row };
      })
      .filter((entry): entry is { section: LocationInventorySection; row: (typeof sections)[number]["products"][number] } => entry !== null);

    if (matches.length === 0) return null;

    const first = matches[0]!.row;
    const totalQuantity = matches.reduce((sum, entry) => sum + entry.row.quantity, 0);
    const totalValueCents = matches.reduce((sum, entry) => sum + entry.row.quantity * entry.row.buyingPriceCents, 0);

    return {
      productName: first.productName,
      sku: first.sku,
      categoryName: first.categoryName,
      buyingPriceCents: first.buyingPriceCents,
      totalQuantity,
      totalValueCents,
      locations: matches.map((entry) => ({
        locationName: entry.section.locationName,
        isMainStore: entry.section.isMainStore,
        quantity: entry.row.quantity,
        isLow: entry.row.isLow,
        isOutOfStock: entry.row.isOutOfStock,
        valueCents: entry.row.quantity * entry.row.buyingPriceCents,
      })),
    };
  }, [productId, sections]);

  return (
    <Modal open={productId !== null && details !== null} onClose={onClose} title={details?.productName ?? "Product"} widthClassName="max-w-xl">
      {details && (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">SKU</p>
              <p className="mt-0.5 text-sm font-bold text-ink">{details.sku}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Category</p>
              <p className="mt-0.5 text-sm font-bold text-ink">{details.categoryName ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Unit Cost</p>
              <p className="mt-0.5 text-sm font-bold text-ink">{money(details.buyingPriceCents)}</p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[420px] table-fixed border-collapse text-sm">
              <thead>
                <tr className="bg-primary text-white">
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Location</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Qty</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Value</th>
                </tr>
              </thead>
              <tbody>
                {details.locations.map((loc) => (
                  <tr key={loc.locationName} className="border-t border-line odd:bg-white even:bg-soft/50">
                    <td className="px-3 py-2 font-bold text-ink">
                      {loc.locationName}
                      {loc.isMainStore && (
                        <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                          Main Store
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                      {loc.quantity}
                      <Badge isLow={loc.isLow} isOutOfStock={loc.isOutOfStock} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{money(loc.valueCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={cn("border-t-2 border-line bg-soft/60")}>
                  <td className="px-3 py-2 font-extrabold text-ink">Total</td>
                  <td className="px-3 py-2 text-right font-extrabold tabular-nums text-ink">{details.totalQuantity}</td>
                  <td className="px-3 py-2 text-right font-extrabold tabular-nums text-ink">{money(details.totalValueCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
