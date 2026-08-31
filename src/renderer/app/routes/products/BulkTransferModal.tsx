import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast } from "@renderer/shared/lib/toast";
import type { Location } from "@shared/types/location";
import type { ProductListItem } from "@shared/types/product";

/**
 * Moves several products from one location to another in a single action — e.g. a storefront
 * closing down and everything on its shelf moving to another branch at once, instead of repeating
 * ProductDetailModal's own single-product Transfer one product at a time. Same From/To pattern as
 * that modal, including the same fix for the exact bug found there: changing "From" to whatever "To"
 * currently is clears "To" instead of leaving it silently stale (see updateTransferField's own
 * comment in ProductDetailModal.tsx for the full mechanism).
 */
export function BulkTransferModal({
  open,
  onClose,
  products,
  locations,
  onApplied
}: {
  open: boolean;
  onClose: () => void;
  products: ProductListItem[];
  locations: Location[];
  onApplied: (transferredCount: number) => Promise<void> | void;
}): React.JSX.Element {
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [onHandByProduct, setOnHandByProduct] = useState<Record<string, number>>({});
  const [loadingOnHand, setLoadingOnHand] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every time "From" changes, fetch what's actually on hand there and default each selected
  // product's quantity to it — the common case is "move everything", not typing every amount by
  // hand; still fully editable, and a product with 0 on hand there just starts blank.
  useEffect(() => {
    if (!fromLocationId) {
      setOnHandByProduct({});
      return;
    }
    let cancelled = false;
    setLoadingOnHand(true);
    window.blueLedger.inventory
      .listForLocation(fromLocationId)
      .then((rows) => {
        if (cancelled) return;
        const byProduct: Record<string, number> = {};
        for (const row of rows) byProduct[row.productId] = row.quantity;
        setOnHandByProduct(byProduct);
        setQuantities((prev) => {
          const next = { ...prev };
          for (const product of products) {
            const onHand = byProduct[product.id] ?? 0;
            next[product.id] = onHand > 0 ? String(onHand) : "";
          }
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) setOnHandByProduct({});
      })
      .finally(() => {
        if (!cancelled) setLoadingOnHand(false);
      });
    return () => {
      cancelled = true;
    };
    // products is the fixed selection this modal opened with — intentionally not a dependency, so
    // re-running this fetch is driven purely by which location is being read from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLocationId]);

  function handleFromChange(value: string): void {
    setFromLocationId(value);
    if (value === toLocationId) setToLocationId("");
  }

  function updateQuantity(productId: string, value: string): void {
    setQuantities((prev) => ({ ...prev, [productId]: value }));
  }

  const items = products
    .map((product) => ({ productId: product.id, quantity: Number(quantities[product.id] ?? "") }))
    .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);

  async function handleSubmit(): Promise<void> {
    setError(null);
    if (!fromLocationId || !toLocationId) {
      const message = "Choose both a From and To location";
      setError(message);
      showErrorToast(message);
      return;
    }
    if (items.length === 0) {
      const message = "Enter a quantity greater than 0 for at least one product";
      setError(message);
      showErrorToast(message);
      return;
    }

    setSaving(true);
    try {
      const result = await window.blueLedger.stockMovement.bulkTransfer({
        fromLocationId,
        toLocationId,
        notes: notes.trim() || null,
        items
      });
      await onApplied(result.transferredCount);
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to transfer stock");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bulk Transfer Stock"
      description={`Move ${products.length} selected product${products.length === 1 ? "" : "s"} from one location to another.`}
      widthClassName="max-w-2xl"
    >
      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField
          label="From Location"
          value={fromLocationId}
          onChange={handleFromChange}
          options={[
            { value: "", label: "Choose location" },
            ...locations.map((location) => ({ value: location.id, label: location.locationName }))
          ]}
        />
        <SelectField
          label="To Location"
          value={toLocationId}
          onChange={setToLocationId}
          options={[
            { value: "", label: "Choose location" },
            ...locations
              .filter((location) => location.id !== fromLocationId)
              .map((location) => ({ value: location.id, label: location.locationName }))
          ]}
        />
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
          Quantities {loadingOnHand && <Loader2 className="ml-1 inline size-3 animate-spin" aria-hidden="true" />}
        </p>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-line">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead className="sticky top-0">
              <tr className="bg-primary text-white">
                <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Product</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">On Hand</th>
                <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Transfer Qty</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                  <td className="px-3 py-2">
                    <p className="line-clamp-2 font-bold text-ink">{product.name}</p>
                    <p className="text-[11px] font-semibold text-muted">{product.sku}</p>
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-muted">
                    {fromLocationId ? (onHandByProduct[product.id] ?? 0) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      value={quantities[product.id] ?? ""}
                      onChange={(event) => updateQuantity(product.id, event.target.value)}
                      placeholder="0"
                      className="h-8 w-24 rounded-lg border border-line bg-white px-2 text-right text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11px] font-semibold text-muted">
          Leave a quantity at 0 to skip that product. Quantities default to what's currently on hand at the From
          location once chosen — edit any of them freely.
        </p>
      </div>

      <div className="mt-4">
        <TextAreaField label="Notes" value={notes} onChange={setNotes} rows={2} placeholder="Optional" />
      </div>

      <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
        <Button
          type="button"
          onClick={onClose}
          className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={saving || !fromLocationId || !toLocationId}
          className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? "Transferring..." : `Transfer ${items.length} product${items.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Modal>
  );
}
