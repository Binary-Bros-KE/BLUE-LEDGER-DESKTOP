import { useEffect, useMemo, useState } from "react";
import { Loader2, Paperclip, Plus, Search, X } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { computeLineTax, type TenantTaxConfig } from "@shared/lib/tax-calculation";
import type { Location } from "@shared/types/location";
import { TAX_TYPE_OPTIONS, type Product, type ProductListItem, type ProductTaxType } from "@shared/types/product";
import type { Purchase } from "@shared/types/purchase";
import type { Supplier } from "@shared/types/supplier";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { QuickCreateProductModal } from "@renderer/shared/components/QuickCreateProductModal";
import { QuickCreateSupplierModal } from "@renderer/shared/components/QuickCreateSupplierModal";

type ItemLine = {
  productId: string;
  name: string;
  sku: string;
  orderedQuantity: number;
  unitCostCents: number;
  discountAmountCents: number;
  /** Defaults from the product's own category when added, but a real supplier invoice can
   * classify a line differently — editable per line, unlike the old whole-order dropdown. */
  taxType: ProductTaxType;
};

function emptyItemLine(product: Product | ProductListItem): ItemLine {
  return {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    orderedQuantity: 1,
    unitCostCents: product.buyingPriceCents,
    discountAmountCents: 0,
    taxType: product.taxType
  };
}

/** Cost is already tax-inclusive (same convention as sale-service.ts) — tax is extracted for
 * reporting, never added on top, so this is just the taxable (net-of-discount) amount. */
function lineTotalCents(line: ItemLine): number {
  return line.orderedQuantity * line.unitCostCents - line.discountAmountCents;
}

function lineTaxCents(line: ItemLine, tenantTaxConfig: TenantTaxConfig): number {
  return computeLineTax(lineTotalCents(line), line.taxType, tenantTaxConfig).taxCents;
}

export function PurchaseFormModal({
  open,
  onClose,
  editingPurchase,
  suppliers,
  products,
  locations,
  onSupplierCreated,
  onProductCreated,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  editingPurchase: Purchase | null;
  suppliers: Supplier[];
  products: ProductListItem[];
  locations: Location[];
  onSupplierCreated: (supplier: Supplier) => void;
  onProductCreated: (product: Product) => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const tenantTaxConfig = useAppStore(
    (state) => state.context?.tenant ?? { vatRatePercent: 16, pricesTaxInclusive: true }
  );
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [locationId, setLocationId] = useState("");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [shippingCost, setShippingCost] = useState("");
  const [notes, setNotes] = useState("");
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [items, setItems] = useState<ItemLine[]>([]);
  const [productSearch, setProductSearch] = useState("");

  const [quickCreateSupplierOpen, setQuickCreateSupplierOpen] = useState(false);
  const [quickCreateProductOpen, setQuickCreateProductOpen] = useState(false);

  const [saving, setSaving] = useState<"draft" | "ordered" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editingPurchase) {
      setSupplierId(editingPurchase.supplierId);
      setLocationId(editingPurchase.locationId);
      setSupplierInvoiceNumber(editingPurchase.supplierInvoiceNumber ?? "");
      setShippingCost(editingPurchase.shippingCostCents > 0 ? fromCents(editingPurchase.shippingCostCents) : "");
      setNotes(editingPurchase.notes ?? "");
      setAttachmentPath(editingPurchase.attachmentPath);
      setItems(
        editingPurchase.items.map((item) => ({
          productId: item.productId,
          name: item.productName,
          sku: item.sku,
          orderedQuantity: item.orderedQuantity,
          unitCostCents: item.unitCostCents,
          discountAmountCents: item.discountAmountCents,
          taxType: item.taxType
        }))
      );
    } else {
      setSupplierId(null);
      setLocationId("");
      setSupplierInvoiceNumber("");
      setShippingCost("");
      setNotes("");
      setAttachmentPath(null);
      setItems([]);
    }
    setSupplierSearch("");
    setProductSearch("");
    setError(null);
  }, [open, editingPurchase]);

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

  const totals = useMemo(() => {
    let subtotalCents = 0;
    let discountAmountCents = 0;
    let taxAmountCents = 0;
    for (const item of items) {
      subtotalCents += item.orderedQuantity * item.unitCostCents;
      discountAmountCents += item.discountAmountCents;
      taxAmountCents += lineTaxCents(item, tenantTaxConfig);
    }
    const shippingCostCents = shippingCost.trim() ? toCents(shippingCost) : 0;
    return {
      subtotalCents,
      discountAmountCents,
      taxAmountCents,
      shippingCostCents,
      // Tax is already inside subtotalCents (cost is tax-inclusive) — never added again here.
      // Shipping is added on top, unlike discount — it increases the total.
      grandTotalCents: subtotalCents - discountAmountCents + shippingCostCents
    };
  }, [items, shippingCost, tenantTaxConfig]);

  function addItemLine(product: ProductListItem): void {
    setItems((prev) => {
      if (prev.some((line) => line.productId === product.id)) return prev;
      return [...prev, emptyItemLine(product)];
    });
    setProductSearch("");
  }

  function updateItemLine(productId: string, patch: Partial<ItemLine>): void {
    setItems((prev) => prev.map((line) => (line.productId === productId ? { ...line, ...patch } : line)));
  }

  function removeItemLine(productId: string): void {
    setItems((prev) => prev.filter((line) => line.productId !== productId));
  }

  async function handlePickAttachment(): Promise<void> {
    setAttachmentBusy(true);
    setError(null);
    try {
      const relativePath = await window.blueLedger.purchase.pickAttachment();
      if (relativePath) setAttachmentPath(relativePath);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to attach file");
      setError(message);
      showErrorToast(message);
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function handleOpenAttachment(): Promise<void> {
    if (!attachmentPath) return;
    try {
      await window.blueLedger.purchase.openAttachment(attachmentPath);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to open attachment");
      setError(message);
      showErrorToast(message);
    }
  }

  async function handleSubmit(intent: "draft" | "ordered"): Promise<void> {
    setError(null);

    if (!supplierId) {
      setError("Select a supplier");
      showErrorToast("Select a supplier");
      return;
    }
    if (!locationId) {
      setError("Select a destination location");
      showErrorToast("Select a destination location");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one product");
      showErrorToast("Add at least one product");
      return;
    }

    setSaving(intent);
    const payload = {
      supplierId,
      supplierInvoiceNumber,
      locationId,
      shippingCostCents: shippingCost.trim() ? toCents(shippingCost) : 0,
      notes,
      attachmentPath,
      items: items.map((item) => ({
        productId: item.productId,
        orderedQuantity: item.orderedQuantity,
        unitCostCents: item.unitCostCents,
        discountAmountCents: item.discountAmountCents,
        taxType: item.taxType
      })),
      intent
    };

    try {
      if (editingPurchase) {
        await window.blueLedger.purchase.update(editingPurchase.id, payload);
      } else {
        await window.blueLedger.purchase.create(payload);
      }
      showSuccessToast(editingPurchase ? "Purchase updated" : "Purchase created");
      await onSaved();
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save purchase");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={editingPurchase ? `Edit ${editingPurchase.purchaseNumber}` : "New Purchase Order"}
        description="Record inventory you're buying from a supplier — stock only enters once goods are received."
        widthClassName="max-w-2xl"
      >
        <div>
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Supplier</span>
              <button
                type="button"
                onClick={() => setQuickCreateSupplierOpen(true)}
                className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
              >
                <Plus className="size-3" aria-hidden="true" />
                New Supplier
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
                  placeholder="Search supplier by name or phone"
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

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Destination Location"
              value={locationId}
              onChange={setLocationId}
              options={[
                { value: "", label: "Select location" },
                ...locations.map((location) => ({ value: location.id, label: location.locationName }))
              ]}
            />
            <Field
              label="Supplier Invoice Number"
              value={supplierInvoiceNumber}
              onChange={setSupplierInvoiceNumber}
              placeholder="Optional"
            />
          </div>

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
                      <span className="text-xs font-semibold text-muted">{formatCents(product.buyingPriceCents)}</span>
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
                  <div key={line.productId} className="rounded-lg border border-line p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-extrabold leading-snug text-ink" title={line.name}>
                          {line.name}
                        </p>
                        <p className="text-[11px] font-semibold text-muted">{line.sku}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItemLine(line.productId)}
                        className="text-[11px] font-extrabold uppercase text-danger hover:underline cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="block">
                        <span className="text-[10px] font-bold uppercase text-muted">Qty</span>
                        <input
                          type="number"
                          min={1}
                          // Renders "" instead of 0 while the field is mid-edit (cleared to type a new
                          // number) — a controlled input forced back to a number on every keystroke
                          // fights the user's own deletion, making it impossible to clear "1" and type
                          // "80" (see money.ts's own fromCents/toCents split for the same lesson
                          // applied to price fields). The clamp back to a minimum of 1 only happens on
                          // blur, once the user is done typing.
                          value={line.orderedQuantity === 0 ? "" : line.orderedQuantity}
                          onChange={(event) => {
                            const raw = event.target.value;
                            const parsed = raw === "" ? 0 : Math.floor(Number(raw));
                            updateItemLine(line.productId, {
                              orderedQuantity: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
                            });
                          }}
                          onBlur={() => {
                            if (line.orderedQuantity <= 0) updateItemLine(line.productId, { orderedQuantity: 1 });
                          }}
                          className="mt-1 h-8 w-full rounded-md border border-line px-1.5 text-center text-xs font-bold outline-none focus:border-accent"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-bold uppercase text-muted">Unit Cost</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={fromCents(line.unitCostCents) || "0.00"}
                          onChange={(event) =>
                            updateItemLine(line.productId, { unitCostCents: toCents(event.target.value) })
                          }
                          className="mt-1 h-8 w-full rounded-md border border-line px-1.5 text-right text-xs font-semibold outline-none focus:border-accent"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-bold uppercase text-muted">Discount</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={fromCents(line.discountAmountCents) || "0.00"}
                          onChange={(event) =>
                            updateItemLine(line.productId, { discountAmountCents: toCents(event.target.value) })
                          }
                          className="mt-1 h-8 w-full rounded-md border border-line px-1.5 text-right text-xs font-semibold outline-none focus:border-accent"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-bold uppercase text-muted">Tax</span>
                        <select
                          value={line.taxType}
                          onChange={(event) =>
                            updateItemLine(line.productId, { taxType: event.target.value as ProductTaxType })
                          }
                          className="mt-1 h-8 w-full rounded-md border border-line px-1 text-center text-xs font-bold outline-none focus:border-accent"
                        >
                          {TAX_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.value === "vat" ? `VAT (${tenantTaxConfig.vatRatePercent}%)` : option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs font-semibold text-muted">
                      <span>Tax (included): {formatCents(lineTaxCents(line, tenantTaxConfig))}</span>
                      <span className="text-sm font-extrabold text-ink">{formatCents(lineTotalCents(line))}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <Field
            label="Shipping Cost"
            type="number"
            value={shippingCost}
            onChange={setShippingCost}
            placeholder="0.00"
            className="mt-4 max-w-xs"
          />

          <TextAreaField label="Notes" value={notes} onChange={setNotes} className="mt-4" rows={2} />

          <div className="mt-4">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Attachment</span>
            <div className="mt-1.5 flex items-center gap-2">
              {attachmentPath ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleOpenAttachment()}
                    className="flex flex-1 items-center gap-2 truncate rounded-lg border border-line bg-soft px-3.5 py-2.5 text-left text-sm font-bold text-ink hover:bg-soft/70 cursor-pointer"
                  >
                    <Paperclip className="size-3.5 flex-none text-muted" aria-hidden="true" />
                    <span className="truncate">View attached document</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttachmentPath(null)}
                    aria-label="Remove attachment"
                    className="grid size-9 flex-none place-items-center rounded-lg border border-line text-muted hover:bg-danger-soft hover:text-danger cursor-pointer"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </>
              ) : (
                <Button
                  type="button"
                  onClick={() => void handlePickAttachment()}
                  disabled={attachmentBusy}
                  className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {attachmentBusy ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Paperclip className="mr-1.5 size-3.5" aria-hidden="true" />
                  )}
                  Attach Invoice / Receipt
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-1 border-t border-line pt-4 text-sm">
            <div className="flex justify-between text-muted">
              <span className="font-semibold">Subtotal</span>
              <span className="font-bold tabular-nums">{formatCents(totals.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span className="font-semibold">Discount</span>
              <span className="font-bold tabular-nums">-{formatCents(totals.discountAmountCents)}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span className="font-semibold">Tax (included in Total)</span>
              <span className="font-bold tabular-nums">{formatCents(totals.taxAmountCents)}</span>
            </div>
            {totals.shippingCostCents > 0 && (
              <div className="flex justify-between text-muted">
                <span className="font-semibold">Shipping</span>
                <span className="font-bold tabular-nums">+{formatCents(totals.shippingCostCents)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-extrabold text-ink">
              <span>Total</span>
              <span>{formatCents(totals.grandTotalCents)}</span>
            </div>
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
              onClick={() => void handleSubmit("draft")}
              disabled={saving !== null}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving === "draft" ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              Save as Draft
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit("ordered")}
              disabled={saving !== null}
              className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving === "ordered" ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              Save as Ordered
            </Button>
          </div>
        </div>
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
