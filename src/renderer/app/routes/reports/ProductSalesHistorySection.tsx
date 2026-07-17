import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import type { ProductListItem } from "@shared/types/product";
import type { ProductSalesHistoryEntry } from "@shared/types/product-report";

function money(cents: number): string {
  return formatCents(cents);
}

const KIND_LABEL: Record<string, string> = {
  retail_sale: "Retail Sale",
  wholesale_sale: "Wholesale Sale",
  invoice: "Invoice",
};

function formatOccurredAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Search any product, then see its complete sale-by-sale history — not
 * scoped to the period selector above, since a "history" is the whole
 * story, not a slice of it. */
export function ProductSalesHistorySection(): React.JSX.Element {
  const [allProducts, setAllProducts] = useState<ProductListItem[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProductListItem | null>(null);
  const [history, setHistory] = useState<ProductSalesHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.blueLedger.product.list().then(setAllProducts);
  }, []);

  const suggestions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0 || selected) return [];
    return allProducts
      .filter((product) => product.name.toLowerCase().includes(trimmed) || product.sku.toLowerCase().includes(trimmed))
      .slice(0, 8);
  }, [allProducts, query, selected]);

  function selectProduct(product: ProductListItem): void {
    setSelected(product);
    setQuery(product.name);
    setHistory(null);
    setError(null);
    setLoading(true);
    window.blueLedger.report
      .productSalesHistory({ productId: product.id })
      .then(setHistory)
      .catch((err: unknown) => setError(getErrorMessage(err, "Failed to load sales history")))
      .finally(() => setLoading(false));
  }

  function clearSelection(): void {
    setSelected(null);
    setQuery("");
    setHistory(null);
    setError(null);
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Product sales history</p>
      <p className="mt-0.5 text-xs font-semibold text-muted">Search any product to see every sale it's ever been part of.</p>

      <div className="relative mt-3 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (selected) setSelected(null);
          }}
          placeholder="Search by product name or SKU…"
          className="w-full rounded-lg border border-line bg-soft/40 py-2 pl-9 pr-3 text-sm font-semibold text-ink outline-none focus:border-accent"
        />
        {suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-white shadow-soft">
            {suggestions.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => selectProduct(product)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-soft cursor-pointer"
              >
                <span className="truncate font-bold text-ink">{product.name}</span>
                <span className="flex-none text-xs font-semibold text-muted">{product.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-md border border-line bg-soft/60 px-2.5 py-1 text-xs font-bold text-ink">
            {selected.name} ({selected.sku})
          </span>
          <button type="button" onClick={clearSelection} className="text-[11px] font-bold text-accent hover:underline cursor-pointer">
            Clear
          </button>
        </div>
      )}

      {error && <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>}

      {loading && (
        <div className="mt-4 flex min-h-[120px] items-center justify-center text-muted">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
      )}

      {!loading && selected && history && (
        <div className="mt-3">
          {history.length === 0 ? (
            <p className="text-sm font-semibold text-muted">This product has never been sold.</p>
          ) : (
            <div className="max-h-[480px] overflow-y-auto rounded-lg border border-line">
              <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-primary text-white">
                    <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Date</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Document</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Type</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Location</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Customer</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Qty</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Unit Price</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.saleItemId} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="px-3 py-2 text-xs font-semibold text-muted">{formatOccurredAt(entry.occurredAt)}</td>
                      <td className="truncate px-3 py-2 font-bold text-ink">{entry.documentNumber ?? "—"}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-muted">{KIND_LABEL[entry.kind] ?? entry.kind}</td>
                      <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{entry.locationName}</td>
                      <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{entry.customerName ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{entry.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{money(entry.unitPriceCents)}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(entry.lineTotalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
