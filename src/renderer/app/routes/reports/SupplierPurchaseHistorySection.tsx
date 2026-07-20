import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import type { Supplier } from "@shared/types/supplier";
import type { SupplierPurchaseHistoryEntry } from "@shared/types/supplier-report";

function money(cents: number): string {
  return formatCents(cents);
}

const STATUS_STYLE: Record<string, string> = {
  received: "bg-success/10 text-success",
  partially_received: "bg-warning/10 text-warning",
  ordered: "bg-soft text-muted",
  cancelled: "bg-danger-soft text-danger",
};

const STATUS_LABEL: Record<string, string> = {
  received: "Received",
  partially_received: "Partially Received",
  ordered: "Ordered",
  cancelled: "Cancelled",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Search any supplier, then see their complete purchase history — not
 * scoped to any period, since a "history" is the whole story. */
export function SupplierPurchaseHistorySection(): React.JSX.Element {
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<SupplierPurchaseHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.blueLedger.supplier.list().then(setAllSuppliers);
  }, []);

  const suggestions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length === 0 || selected) return [];
    return allSuppliers
      .filter((supplier) => supplier.businessName.toLowerCase().includes(trimmed) || supplier.phone1.toLowerCase().includes(trimmed))
      .slice(0, 8);
  }, [allSuppliers, query, selected]);

  function selectSupplier(supplier: Supplier): void {
    setSelected(supplier);
    setQuery(supplier.businessName);
    setHistory(null);
    setError(null);
    setLoading(true);
    window.blueLedger.report
      .supplierPurchaseHistory({ supplierId: supplier.id })
      .then(setHistory)
      .catch((err: unknown) => setError(getErrorMessage(err, "Failed to load purchase history")))
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
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Supplier purchase history</p>
      <p className="mt-0.5 text-xs font-semibold text-muted">Search any supplier to see every purchase order placed with them.</p>

      <div className="relative mt-3 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (selected) setSelected(null);
          }}
          placeholder="Search by business name or phone…"
          className="w-full rounded-lg border border-line bg-soft/40 py-2 pl-9 pr-3 text-sm font-semibold text-ink outline-none focus:border-accent"
        />
        {suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-white shadow-soft">
            {suggestions.map((supplier) => (
              <button
                key={supplier.id}
                type="button"
                onClick={() => selectSupplier(supplier)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-soft cursor-pointer"
              >
                <span className="truncate font-bold text-ink">{supplier.businessName}</span>
                <span className="flex-none text-xs font-semibold text-muted">{supplier.phone1}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-md border border-line bg-soft/60 px-2.5 py-1 text-xs font-bold text-ink">
            {selected.businessName} ({selected.phone1})
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
            <p className="text-sm font-semibold text-muted">No purchases have been placed with this supplier.</p>
          ) : (
            <div className="max-h-[480px] overflow-y-auto rounded-lg border border-line">
              <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-primary text-white">
                    <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">PO Number</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Ordered</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Received</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Items</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Total</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.purchaseId} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="truncate px-3 py-2 font-bold text-ink">{entry.purchaseNumber}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-muted">{formatDate(entry.orderedAt)}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-muted">{formatDate(entry.receivedAt)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                            STATUS_STYLE[entry.status] ?? "bg-soft text-muted"
                          )}
                        >
                          {STATUS_LABEL[entry.status] ?? entry.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{entry.itemCount}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(entry.grandTotalCents)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{money(entry.amountPaidCents)}</td>
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
