import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Boxes,
  ImagePlus,
  Loader2,
  Package,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  X
} from "lucide-react";
import { ProductDetailModal } from "@renderer/app/routes/products/ProductDetailModal";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { CheckboxField, Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, fromCents, toCents } from "@renderer/shared/lib/money";
import type { Category } from "@shared/types/category";
import type { Location } from "@shared/types/location";
import type { ProductListItem } from "@shared/types/product";

type FormState = {
  sku: string;
  barcode: string;
  supplierSku: string;
  name: string;
  shortName: string;
  description: string;
  categoryId: string;
  buyingPrice: string;
  sellingPrice: string;
  wholesalePrice: string;
  wholesaleMinQuantity: string;
  minimumPrice: string;
  taxRate: string;
  reorderLevel: string;
  trackStock: boolean;
  allowNegativeStock: boolean;
  imagePath: string | null;
};

const emptyForm: FormState = {
  sku: "",
  barcode: "",
  supplierSku: "",
  name: "",
  shortName: "",
  description: "",
  categoryId: "",
  buyingPrice: "0.00",
  sellingPrice: "0.00",
  wholesalePrice: "",
  wholesaleMinQuantity: "0",
  minimumPrice: "",
  taxRate: "0",
  reorderLevel: "0",
  trackStock: true,
  allowNegativeStock: false,
  imagePath: null
};

function toFormState(product: ProductListItem): FormState {
  return {
    sku: product.sku,
    barcode: product.barcode ?? "",
    supplierSku: product.supplierSku ?? "",
    name: product.name,
    shortName: product.shortName ?? "",
    description: product.description ?? "",
    categoryId: product.categoryId ?? "",
    buyingPrice: fromCents(product.buyingPriceCents),
    sellingPrice: fromCents(product.sellingPriceCents),
    wholesalePrice: product.wholesalePriceCents !== null ? fromCents(product.wholesalePriceCents) : "",
    wholesaleMinQuantity: String(product.wholesaleMinQuantity),
    minimumPrice: product.minimumPriceCents !== null ? fromCents(product.minimumPriceCents) : "",
    taxRate: String(product.taxRate),
    reorderLevel: String(product.reorderLevel),
    trackStock: product.trackStock,
    allowNegativeStock: product.allowNegativeStock,
    imagePath: product.imagePath
  };
}

function buildCategoryOptions(categories: Category[]): { value: string; label: string }[] {
  const byId = new Map(categories.map((category) => [category.id, category]));

  function pathLabel(category: Category): string {
    const parts = [category.name];
    let current = category;
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      current = parent;
    }
    return parts.join(" › ");
  }

  return categories
    .map((category) => ({ value: category.id, label: pathLabel(category) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function ProductsRoute(): React.JSX.Element {
  const currency = useAppStore((state) => state.context?.tenant.currency ?? "");
  const { can } = usePermissions();
  const canCreate = can("products", "create");
  const canEdit = can("products", "edit");
  const canViewInventory = can("inventory", "view");

  const [products, setProducts] = useState<ProductListItem[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [openingStock, setOpeningStock] = useState<Record<string, string>>({});
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailProduct, setDetailProduct] = useState<ProductListItem | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [productList, categoryList, locationList] = await Promise.all([
        window.blueLedger.product.list(),
        window.blueLedger.category.list(),
        window.blueLedger.location.list()
      ]);
      setProducts(productList);
      setCategories(categoryList);
      setLocations(locationList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load products"));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!form.imagePath) {
      setImagePreviewUrl(null);
      return;
    }
    let cancelled = false;
    void window.blueLedger.product.readImagePreview(form.imagePath).then((url) => {
      if (!cancelled) setImagePreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [form.imagePath]);

  const categoryOptions = useMemo(() => buildCategoryOptions(categories), [categories]);

  const filteredProducts = useMemo(() => {
    if (!products) return null;
    const term = searchTerm.trim().toLowerCase();

    return products.filter((product) => {
      if (term) {
        const haystack = `${product.name} ${product.sku} ${product.barcode ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (categoryFilter && product.categoryId !== categoryFilter) return false;
      if (statusFilter && product.status !== statusFilter) return false;
      return true;
    });
  }, [products, searchTerm, categoryFilter, statusFilter]);

  const hasActiveFilters = Boolean(searchTerm || categoryFilter || statusFilter);

  function clearFilters(): void {
    setSearchTerm("");
    setCategoryFilter("");
    setStatusFilter("");
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreateModal(): void {
    setEditingId(null);
    setForm(emptyForm);
    setOpeningStock({});
    setError(null);
    setModalOpen(true);
  }

  function openEditModal(product: ProductListItem): void {
    setEditingId(product.id);
    setForm(toFormState(product));
    setOpeningStock({});
    setError(null);
    setModalOpen(true);
  }

  async function handlePickImage(): Promise<void> {
    setImageBusy(true);
    try {
      const relativePath = await window.blueLedger.product.pickImage();
      if (relativePath) {
        updateField("imagePath", relativePath);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to attach image"));
    } finally {
      setImageBusy(false);
    }
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      sku: form.sku,
      barcode: form.barcode,
      supplierSku: form.supplierSku,
      name: form.name,
      shortName: form.shortName,
      description: form.description,
      categoryId: form.categoryId ? form.categoryId : null,
      buyingPriceCents: toCents(form.buyingPrice),
      sellingPriceCents: toCents(form.sellingPrice),
      wholesalePriceCents: form.wholesalePrice.trim() ? toCents(form.wholesalePrice) : null,
      wholesaleMinQuantity: Number(form.wholesaleMinQuantity) || 0,
      minimumPriceCents: form.minimumPrice.trim() ? toCents(form.minimumPrice) : null,
      taxRate: Number(form.taxRate) || 0,
      reorderLevel: Number(form.reorderLevel) || 0,
      trackStock: form.trackStock,
      allowNegativeStock: form.allowNegativeStock,
      imagePath: form.imagePath
    };

    try {
      if (editingId) {
        await window.blueLedger.product.update(editingId, payload);
      } else {
        const openingStockEntries = Object.entries(openingStock)
          .map(([locationId, quantity]) => ({ locationId, quantity: Number(quantity) || 0 }))
          .filter((entry) => entry.quantity > 0);
        await window.blueLedger.product.create({ ...payload, openingStock: openingStockEntries });
      }
      await loadAll();
      setModalOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save product"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(product: ProductListItem): Promise<void> {
    const nextStatus = product.status === "active" ? "inactive" : "active";
    await window.blueLedger.product.setStatus(product.id, nextStatus);
    await loadAll();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative mt-6 space-y-5 pb-10 pl-4"
    >
      <span
        className="pointer-events-none absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-2 left-0 top-2 border-l-2 border-dashed border-line"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -left-[5px] bottom-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Products</p>
            <h2 className="mt-1 text-xl font-extrabold">Product catalog</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Master catalog — stock balances are tracked per location in Inventory.
            </p>
          </div>
          {canCreate && (
            <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              New Product
            </Button>
          )}
        </div>

        {products !== null && products.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="block sm:col-span-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Search
              </span>
              <div className="relative mt-1.5">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by name, SKU, or barcode"
                  className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </div>
            </label>
            <SelectField
              label="Category"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[{ value: "", label: "All Categories" }, ...categoryOptions]}
            />
            <SelectField
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "", label: "All Statuses" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" }
              ]}
            />
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="justify-self-start text-[11px] font-extrabold uppercase tracking-wider text-accent hover:underline sm:col-span-4"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <p className="text-sm font-bold text-danger">{loadError}</p>
              <Button type="button" onClick={() => void loadAll()} className="mt-4 h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : products === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : products.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Package className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No products yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Add your first product to start tracking pricing and stock across locations.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Product
                </Button>
              )}
            </div>
          ) : filteredProducts && filteredProducts.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No products match your filters</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Try a different search term or clear the filters below.
              </p>
              <Button type="button" onClick={clearFilters} className="mt-5 h-9 text-xs">
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[18%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Product</Th>
                    <Th>Category</Th>
                    <Th className="text-right">Price</Th>
                    <Th className="text-right">Stock</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredProducts ?? []).map((product) => (
                    <tr key={product.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ProductThumbnail imagePath={product.imagePath} />
                          <div className="min-w-0">
                            <p className="truncate font-extrabold" title={product.name}>
                              {product.name}
                            </p>
                            <p className="truncate text-xs tabular-nums text-muted">{product.sku}</p>
                          </div>
                        </div>
                      </td>
                      <td className="truncate px-4 py-3 text-sm font-semibold text-muted">
                        {product.categoryName ?? "Uncategorized"}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">
                        {currency} {formatCents(product.sellingPriceCents)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={cn(
                            "font-extrabold tabular-nums",
                            product.totalStock <= product.reorderLevel && "text-warning"
                          )}
                        >
                          {product.totalStock}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone={product.status === "active" ? "success" : "neutral"}>
                          {product.status}
                        </DashedPill>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {canViewInventory && (
                            <button
                              type="button"
                              onClick={() => setDetailProduct(product)}
                              aria-label={`View inventory for ${product.name}`}
                              title="Inventory & movements"
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Boxes className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(product)}
                              aria-label={`Edit ${product.name}`}
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => void handleToggleStatus(product)}
                              aria-label={
                                product.status === "active"
                                  ? `Deactivate ${product.name}`
                                  : `Activate ${product.name}`
                              }
                              className={cn(
                                "grid size-8 place-items-center rounded-lg border transition cursor-pointer",
                                product.status === "active"
                                  ? "border-line text-muted hover:bg-danger-soft hover:text-danger"
                                  : "border-line text-muted hover:bg-success/15 hover:text-success"
                              )}
                            >
                              {product.status === "active" ? (
                                <PowerOff className="size-3.5" aria-hidden="true" />
                              ) : (
                                <Power className="size-3.5" aria-hidden="true" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit product" : "New product"}
        description="SKU, name, and category power search and receipts across every location."
        widthClassName="max-w-2xl"
      >
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="grid size-20 flex-none place-items-center overflow-hidden rounded-lg border border-line bg-soft">
              {imagePreviewUrl ? (
                <img src={imagePreviewUrl} alt="" className="size-full object-cover" />
              ) : (
                <Package className="size-7 text-muted" aria-hidden="true" />
              )}
            </div>
            <div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => void handlePickImage()}
                  disabled={imageBusy}
                  className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ImagePlus className="mr-1.5 size-4" aria-hidden="true" />
                  {form.imagePath ? "Replace Image" : "Upload Image"}
                </Button>
                {form.imagePath && (
                  <Button
                    type="button"
                    onClick={() => updateField("imagePath", null)}
                    className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
                  >
                    <X className="mr-1 size-3.5" aria-hidden="true" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-[11px] font-semibold text-muted">JPG, PNG, or WEBP · max 5MB</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Product Name"
              value={form.name}
              onChange={(value) => updateField("name", value)}
              placeholder="e.g. Coca Cola 500ml"
              required
            />
            <Field
              label="SKU"
              value={form.sku}
              onChange={(value) => updateField("sku", value)}
              placeholder="e.g. BEV-COKE-500"
              required
            />
            <Field
              label="Barcode"
              value={form.barcode}
              onChange={(value) => updateField("barcode", value)}
              placeholder="e.g. 5449000000996"
            />
            <Field
              label="Short Name"
              value={form.shortName}
              onChange={(value) => updateField("shortName", value)}
              placeholder="e.g. Coke 500ml"
            />
            <SelectField
              label="Category"
              value={form.categoryId}
              onChange={(value) => updateField("categoryId", value)}
              options={[{ value: "", label: "Uncategorized" }, ...categoryOptions]}
            />
            <Field
              label="Supplier SKU"
              value={form.supplierSku}
              onChange={(value) => updateField("supplierSku", value)}
              placeholder="e.g. supplier's own code"
            />
            <TextAreaField
              label="Description"
              value={form.description}
              onChange={(value) => updateField("description", value)}
              placeholder="e.g. 500ml glass bottle, returnable"
              className="sm:col-span-2"
            />
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Pricing</p>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
              <Field
                label="Buying Price"
                type="number"
                value={form.buyingPrice}
                onChange={(value) => updateField("buyingPrice", value)}
                placeholder="0.00"
                required
              />
              <Field
                label="Selling Price"
                type="number"
                value={form.sellingPrice}
                onChange={(value) => updateField("sellingPrice", value)}
                placeholder="0.00"
                required
              />
              <Field
                label="Wholesale Price"
                type="number"
                value={form.wholesalePrice}
                onChange={(value) => updateField("wholesalePrice", value)}
                placeholder="Optional"
              />
              <Field
                label="Wholesale Min Qty"
                type="number"
                value={form.wholesaleMinQuantity}
                onChange={(value) => updateField("wholesaleMinQuantity", value)}
                placeholder="e.g. 12"
              />
              <Field
                label="Minimum Price"
                type="number"
                value={form.minimumPrice}
                onChange={(value) => updateField("minimumPrice", value)}
                placeholder="Optional"
              />
            </div>
            <p className="mt-2 text-[11px] font-semibold text-muted">
              Wholesale Min Qty is the quantity a customer must buy to qualify for the wholesale price.
            </p>
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
              Stock Settings
            </p>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field
                label="Tax Rate (%)"
                type="number"
                value={form.taxRate}
                onChange={(value) => updateField("taxRate", value)}
                placeholder="0"
              />
              <Field
                label="Reorder Level"
                type="number"
                value={form.reorderLevel}
                onChange={(value) => updateField("reorderLevel", value)}
                placeholder="0"
              />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CheckboxField
                label="Track Stock"
                description="Deduct inventory on sale"
                checked={form.trackStock}
                onChange={(checked) => updateField("trackStock", checked)}
              />
              <CheckboxField
                label="Allow Negative Stock"
                description="Permit overselling below zero"
                checked={form.allowNegativeStock}
                onChange={(checked) => updateField("allowNegativeStock", checked)}
              />
            </div>
          </div>

          {!editingId && locations.length > 0 && (
            <div className="mt-5 border-t border-line pt-5">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Opening Stock (optional)
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {locations.map((location) => (
                  <Field
                    key={location.id}
                    label={location.locationName}
                    type="number"
                    value={openingStock[location.id] ?? ""}
                    onChange={(value) =>
                      setOpeningStock((prev) => ({ ...prev, [location.id]: value }))
                    }
                    placeholder="0"
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={() => setModalOpen(false)}
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
              {saving ? "Saving..." : editingId ? "Save changes" : "Create product"}
            </Button>
          </div>
        </form>
      </Modal>

      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          currency={currency}
          locations={locations}
          onClose={() => setDetailProduct(null)}
        />
      )}
    </motion.div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

function ProductThumbnail({ imagePath }: { imagePath: string | null }): React.JSX.Element {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imagePath) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    void window.blueLedger.product.readImagePreview(imagePath).then((url) => {
      if (!cancelled) setPreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [imagePath]);

  return (
    <div className="grid size-10 flex-none place-items-center overflow-hidden rounded-lg border border-line bg-soft">
      {previewUrl ? (
        <img src={previewUrl} alt="" className="size-full object-cover" />
      ) : (
        <Package className="size-4 text-muted" aria-hidden="true" />
      )}
    </div>
  );
}
