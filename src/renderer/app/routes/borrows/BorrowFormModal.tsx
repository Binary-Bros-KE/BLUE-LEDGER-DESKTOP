import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { QuickCreateProductModal } from "@renderer/shared/components/QuickCreateProductModal";
import { QuickCreateSupplierModal } from "@renderer/shared/components/QuickCreateSupplierModal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { cn } from "@renderer/shared/lib/cn";
import { BORROW_DIRECTION_OPTIONS, type BorrowDirection } from "@shared/types/borrow";
import type { Location } from "@shared/types/location";
import type { Product, ProductListItem } from "@shared/types/product";
import type { Supplier } from "@shared/types/supplier";

type ItemLine = {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
};

function emptyItemLine(product: Product | ProductListItem): ItemLine {
  return { productId: product.id, name: product.name, sku: product.sku, quantity: 1 };
}

export function BorrowFormModal({
  open,
  onClose,
  suppliers,
  products,
  locations,
  onSupplierCreated,
  onProductCreated,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  suppliers: Supplier[];
  products: ProductListItem[];
  locations: Location[];
  onSupplierCreated: (supplier: Supplier) => void;
  onProductCreated: (product: Product) => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const [direction, setDirection] = useState<BorrowDirection>("borrowed");
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemLine[]>([]);
  const [productSearch, setProductSearch] = useState("");

  const [quickCreateSupplierOpen, setQuickCreateSupplierOpen] = useState(false);
  const [quickCreateProductOpen, setQuickCreateProductOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDirection("borrowed");
    setSupplierId(null);
    setSupplierSearch("");
    setLocationId("");
    setNotes("");
    setItems([]);
    setProductSearch("");
    setError(null);
  }, [open]);

  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.status === "active"), [suppliers]);
  const selectedSupplier = activeSuppliers.find((supplier) => supplier.id === supplierId) ?? null;

  const filteredSuppliers = useMemo(() => {
    const term = supplierSearch.trim().toLowerCase();
    if (!term) return activeSuppliers.slice(0, 20);
    return activeSuppliers
      .filter((supplier) => `${supplier.businessName} ${supplier.phone1}`.toLowerCase().includes(term))
      .slice(0, 20);
  }, [activeSuppliers, supplierSearch]);

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((product) => product.status === "active")
      .filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [products, productSearch]);

  function addItemLine(product: ProductListItem): void {
    setItems((prev) => {
      if (prev.some((line) => line.productId === product.id)) return prev;
      return [...prev, emptyItemLine(product)];
    });
    setProductSearch("");
  }

  function updateItemQuantity(productId: string, quantity: number): void {
    setItems((prev) => prev.map((line) => (line.productId === productId ? { ...line, quantity } : line)));
  }

  function removeItemLine(productId: string): void {
    setItems((prev) => prev.filter((line) => line.productId !== productId));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!supplierId) {
      setError("Select a shop");
      showErrorToast("Select a shop");
      return;
    }
    if (!locationId) {
      setError("Select a location");
      showErrorToast("Select a location");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one product");
      showErrorToast("Add at least one product");
      return;
    }

    setSaving(true);
    try {
      await window.blueLedger.borrow.create({
        direction,
        supplierId,
        locationId,
        notes,
        items: items.map((item) => ({ productId: item.productId, quantity: item.quantity }))
      });
      showSuccessToast(direction === "borrowed" ? "Borrow recorded" : "Loan recorded");
      await onSaved();
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save borrow record");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="New Borrow / Lend"
        description="Track stock physically moving between this shop and another shop — no pricing involved."
        widthClassName="max-w-2xl"
      >
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}

          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Direction</span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {BORROW_DIRECTION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDirection(option.value)}
                  className={cn(
                    "rounded-lg border px-3.5 py-2.5 text-left transition cursor-pointer",
                    direction === option.value ? "border-teal bg-teal/10" : "border-line hover:bg-soft"
                  )}
                >
                  <span className="text-sm font-extrabold text-ink">{option.label}</span>
                  <p className="mt-0.5 text-[11px] font-semibold text-muted">
                    {option.value === "borrowed" ? "They handed you stock — added here now" : "You handed them stock — removed here now"}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Shop</span>
              <button
                type="button"
                onClick={() => setQuickCreateSupplierOpen(true)}
                className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
              >
                <Plus className="size-3" aria-hidden="true" />
                New Shop
              </button>
            </div>
            {selectedSupplier ? (
              <div className="mt-1.5 flex items-center justify-between rounded-lg border border-line bg-soft px-3.5 py-2.5">
                <div>
                  <p className="text-sm font-extrabold text-ink">{selectedSupplier.businessName}</p>
                  <p className="text-[11px] font-semibold text-muted">{selectedSupplier.phone1}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSupplierId(null)}
                  className="text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative mt-1.5">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={supplierSearch}
                  onChange={(event) => setSupplierSearch(event.target.value)}
                  placeholder="Search shop by name or phone"
                  className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
                {filteredSuppliers.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-soft">
                    {filteredSuppliers.map((supplier) => (
                      <button
                        key={supplier.id}
                        type="button"
                        onClick={() => {
                          setSupplierId(supplier.id);
                          setSupplierSearch("");
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-soft cursor-pointer"
                      >
                        <span className="font-bold text-ink">{supplier.businessName}</span>
                        <span className="text-xs font-semibold text-muted">{supplier.phone1}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <SelectField
            label="Location"
            value={locationId}
            onChange={setLocationId}
            options={[
              { value: "", label: "Select location" },
              ...locations.map((location) => ({ value: location.id, label: location.locationName }))
            ]}
            className="mt-4"
          />

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Products</span>
              <button
                type="button"
                onClick={() => setQuickCreateProductOpen(true)}
                className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
              >
                <Plus className="size-3" aria-hidden="true" />
                New Product
              </button>
            </div>
            <div className="relative mt-1.5">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                type="text"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Search product by name or SKU"
                className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              {filteredProducts.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-soft">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addItemLine(product)}
                      className="flex w-full items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-soft cursor-pointer"
                    >
                      <span className="font-bold text-ink">{product.name}</span>
                      <span className="text-xs font-semibold text-muted">{product.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-3 space-y-2">
              {items.length === 0 ? (
                <p className="text-xs font-semibold text-muted">No products added yet.</p>
              ) : (
                items.map((line) => (
                  <div key={line.productId} className="flex items-center gap-2.5 rounded-lg border border-line p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-extrabold leading-snug text-ink" title={line.name}>
                        {line.name}
                      </p>
                      <p className="text-[11px] font-semibold text-muted">{line.sku}</p>
                    </div>
                    <label className="block flex-none">
                      <span className="sr-only">Quantity</span>
                      <input
                        type="number"
                        min={1}
                        value={line.quantity === 0 ? "" : line.quantity}
                        onChange={(event) => {
                          const raw = event.target.value;
                          const parsed = raw === "" ? 0 : Math.floor(Number(raw));
                          updateItemQuantity(line.productId, Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
                        }}
                        onBlur={() => {
                          if (line.quantity <= 0) updateItemQuantity(line.productId, 1);
                        }}
                        className="h-8 w-16 rounded-md border border-line px-1.5 text-center text-xs font-bold outline-none focus:border-accent"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeItemLine(line.productId)}
                      className="flex-none text-[11px] font-extrabold uppercase text-danger hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <TextAreaField label="Notes" value={notes} onChange={setNotes} className="mt-4" rows={2} />

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={onClose}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {direction === "borrowed" ? "Record Borrow" : "Record Loan"}
            </Button>
          </div>
        </form>
      </Modal>

      <QuickCreateSupplierModal
        open={quickCreateSupplierOpen}
        onClose={() => setQuickCreateSupplierOpen(false)}
        onCreated={(supplier) => {
          onSupplierCreated(supplier);
          setSupplierId(supplier.id);
          setSupplierSearch("");
          setQuickCreateSupplierOpen(false);
        }}
      />

      <QuickCreateProductModal
        open={quickCreateProductOpen}
        onClose={() => setQuickCreateProductOpen(false)}
        onCreated={(product) => {
          onProductCreated(product);
          addItemLine({ ...product, categoryName: null, categoryColor: null, totalStock: 0 });
          setQuickCreateProductOpen(false);
        }}
      />
    </>
  );
}
