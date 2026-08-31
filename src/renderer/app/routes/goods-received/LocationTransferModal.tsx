import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast } from "@renderer/shared/lib/toast";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { LocationStockLevel } from "@shared/types/inventory";
import type { ProductListItem } from "@shared/types/product";

type DraftItem = {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
};

/**
 * Moves several products from one ordinary storefront to another in a single action, creating a
 * real Goods Received document (destination "location_transfer") — a client-requested "receipt of
 * record", with frozen before/after on BOTH sides, not the plain unreceipted bulk move this feature
 * started as (see this route's own commit history: moved here specifically so a transfer leaves a
 * reprintable receipt, same as every other stock movement in Goods Received). A separate, dedicated
 * action from "New Receipt" — deliberately its own modal rather than a fourth tab in that one, and
 * products are picked FIRST here (this section is first in the form), locations chosen right before
 * submitting — the reverse order of the other three destinations, which is fine since none of them
 * share UI beyond the same product-search-and-add mechanism.
 */
export function LocationTransferModal({
  open,
  onClose,
  products,
  locations,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  products: ProductListItem[];
  locations: Location[];
  onCreated: () => Promise<void> | void;
}): React.JSX.Element {
  const [items, setItems] = useState<DraftItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [fromStock, setFromStock] = useState<LocationStockLevel[]>([]);
  const [toStock, setToStock] = useState<LocationStockLevel[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storefronts = useMemo(() => locations.filter((location) => isStorefrontType(location.locationType)), [locations]);

  useEffect(() => {
    if (!fromLocationId) {
      setFromStock([]);
      return;
    }
    window.blueLedger.inventory
      .listForLocation(fromLocationId)
      .then(setFromStock)
      .catch(() => setFromStock([]));
  }, [fromLocationId]);

  useEffect(() => {
    if (!toLocationId) {
      setToStock([]);
      return;
    }
    window.blueLedger.inventory
      .listForLocation(toLocationId)
      .then(setToStock)
      .catch(() => setToStock([]));
  }, [toLocationId]);

  function handleFromChange(value: string): void {
    setFromLocationId(value);
    // Same fix as ProductDetailModal's own Transfer tab: changing "From" to whatever "To" currently
    // is would silently desync the "To" dropdown (its own options list filters out "From"), so clear
    // it instead of leaving a stale, invisible mismatch — see that file's updateTransferField comment
    // for the full mechanism this avoids.
    if (value === toLocationId) setToLocationId("");
  }

  const filteredPickerProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((product) => product.status === "active")
      .filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [products, productSearch]);

  function addItem(product: ProductListItem): void {
    setItems((prev) => {
      if (prev.some((item) => item.productId === product.id)) return prev;
      return [...prev, { productId: product.id, productName: product.name, sku: product.sku, quantity: 0 }];
    });
    setProductSearch("");
  }

  function updateItemQuantityDraft(productId: string, raw: string): void {
    const parsed = raw === "" ? 0 : Math.floor(Number(raw));
    const next = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    setItems((prev) => prev.map((item) => (item.productId === productId ? { ...item, quantity: next } : item)));
  }

  function removeItem(productId: string): void {
    setItems((prev) => prev.filter((item) => item.productId !== productId));
  }

  function stockAt(rows: LocationStockLevel[], productId: string): number {
    return rows.find((row) => row.productId === productId)?.quantity ?? 0;
  }

  function resetForm(): void {
    setItems([]);
    setProductSearch("");
    setFromLocationId("");
    setToLocationId("");
    setNotes("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (items.length === 0) {
      const message = "Add at least one product";
      setError(message);
      showErrorToast(message);
      return;
    }
    const emptyItem = items.find((item) => item.quantity <= 0);
    if (emptyItem) {
      const message = `Enter a quantity for ${emptyItem.productName}`;
      setError(message);
      showErrorToast(message);
      return;
    }
    if (!fromLocationId || !toLocationId) {
      const message = "Choose both a From and To storefront";
      setError(message);
      showErrorToast(message);
      return;
    }
    const shortItem = items.find((item) => item.quantity > stockAt(fromStock, item.productId));
    if (shortItem) {
      setError(`Not enough stock at the source storefront for ${shortItem.productName}`);
      return;
    }

    setSaving(true);
    try {
      await window.blueLedger.stockReceipt.create({
        destination: "location_transfer",
        fromLocationId,
        locationId: toLocationId,
        notes,
        items: items.map((item) => ({ productId: item.productId, quantityReceived: item.quantity }))
      });
      resetForm();
      await onCreated();
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to record transfer");
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
      title="Transfer Between Locations"
      description="Move several products from one storefront to another, with a permanent, reprintable record."
      widthClassName="max-w-2xl"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </div>
        )}

        <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Products</span>
        <div className="relative mt-1.5">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="text"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="Search product by name or SKU"
            className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
          {filteredPickerProducts.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-soft">
              {filteredPickerProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addItem(product)}
                  className="flex w-full items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-soft cursor-pointer"
                >
                  <span className="font-bold text-ink">
                    {product.name} <span className="font-semibold text-muted">({product.sku})</span>
                  </span>
                  <Plus className="size-3.5 text-muted" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-soft">
                  <th className="px-3 py-2 text-left font-extrabold uppercase tracking-wider text-muted">Product</th>
                  <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider text-muted">Available at Source</th>
                  <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider text-muted">Quantity</th>
                  <th className="px-3 py-2 text-right font-extrabold uppercase tracking-wider text-muted">New Total at Destination</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const available = fromLocationId ? stockAt(fromStock, item.productId) : null;
                  const currentAtTo = toLocationId ? stockAt(toStock, item.productId) : null;
                  const overRequested = available !== null && item.quantity > available;
                  return (
                    <tr key={item.productId} className="border-t border-line">
                      <td className="px-3 py-2">
                        <p className="font-extrabold text-ink">{item.productName}</p>
                        <p className="text-[10px] font-semibold text-muted">{item.sku}</p>
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-bold tabular-nums",
                          overRequested ? "text-danger" : "text-muted"
                        )}
                      >
                        {available === null ? "—" : available}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={item.quantity === 0 ? "" : item.quantity}
                          onChange={(event) => updateItemQuantityDraft(item.productId, event.target.value)}
                          aria-label={`Quantity for ${item.productName}`}
                          className={cn(
                            "h-8 w-16 rounded-md border px-2 text-center text-sm font-extrabold tabular-nums text-ink outline-none focus:border-accent",
                            overRequested ? "border-danger" : "border-line"
                          )}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-extrabold tabular-nums text-success">
                        {currentAtTo === null ? "—" : currentAtTo + item.quantity}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeItem(item.productId)}
                          aria-label={`Remove ${item.productName}`}
                          className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField
            label="From Storefront"
            value={fromLocationId}
            onChange={handleFromChange}
            options={[
              { value: "", label: "Choose storefront" },
              ...storefronts.map((location) => ({ value: location.id, label: location.locationName }))
            ]}
          />
          <SelectField
            label="To Storefront"
            value={toLocationId}
            onChange={setToLocationId}
            options={[
              { value: "", label: "Choose storefront" },
              ...storefronts.filter((location) => location.id !== fromLocationId).map((location) => ({ value: location.id, label: location.locationName }))
            ]}
          />
        </div>

        <TextAreaField
          label="Notes"
          value={notes}
          onChange={setNotes}
          placeholder="Optional"
          className="mt-4"
          rows={2}
        />

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
          <Button
            type="button"
            onClick={onClose}
            className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving}
            className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? "Recording..." : "Record Transfer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
