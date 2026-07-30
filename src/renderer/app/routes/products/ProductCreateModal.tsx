import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2, Package, X } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { CheckboxField, Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getDashboardVariant } from "@renderer/shared/lib/dashboard-role";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { toCents } from "@renderer/shared/lib/money";
import type { Category } from "@shared/types/category";
import { isStorefrontType, type Location } from "@shared/types/location";
import { UNIT_OF_MEASURE_OPTIONS, type Product } from "@shared/types/product";

type FormState = {
  sku: string;
  barcode: string;
  supplierSku: string;
  name: string;
  shortName: string;
  description: string;
  categoryId: string;
  storefrontId: string;
  unitOfMeasure: string;
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

function emptyForm(): FormState {
  return {
    sku: "",
    barcode: "",
    supplierSku: "",
    name: "",
    shortName: "",
    description: "",
    categoryId: "",
    storefrontId: "",
    unitOfMeasure: "",
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

/** Product creation — used from both Main Store and the Products page, since Managers can create and
 * edit products but don't get the Main Store tab. Opening stock can seed a storefront's own shelf AND
 * Main Store's own stock directly (previously Main Store required a separate "Receive" step after
 * creation). Super Admin sees every storefront as an opening-stock target; anyone branch-scoped
 * (Manager, or any other role with "products:create") only sees their own storefront plus Main Store —
 * mirrored server-side in `createProduct`, which rejects opening-stock entries outside that set. */
export function ProductCreateModal({
  open,
  onClose,
  categories,
  locations,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  locations: Location[];
  onCreated: (product: Product) => void;
}): React.JSX.Element {
  const { session } = usePermissions();
  const isSuperAdmin = getDashboardVariant(session) === "superAdmin";

  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [openingStock, setOpeningStock] = useState<Record<string, string>>({});
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      ...emptyForm(),
      // A branch-scoped Manager can only ever create a product visible at their own storefront —
      // never "All Storefronts" (which would show it to every other branch too) or a different one.
      storefrontId: isSuperAdmin ? "" : (session?.branch?.id ?? "")
    });
    setOpeningStock({});
    setError(null);
    // Prefills the next auto-generated SKU so nobody has to track the latest number by hand — still a
    // normal editable field, so it can be overridden for a tenant with their own existing SKU scheme.
    void window.blueLedger.product.nextSku().then((sku) => {
      setForm((prev) => (prev.sku === "" ? { ...prev, sku } : prev));
    }).catch(() => {});
  }, [open, isSuperAdmin, session?.branch?.id]);

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

  const allStorefronts = useMemo(() => locations.filter((location) => isStorefrontType(location.locationType)), [locations]);
  const mainStore = useMemo(() => locations.find((location) => !isStorefrontType(location.locationType)) ?? null, [locations]);

  /** Which storefronts show as opening-stock targets — mirrors the same branch lock as the
   * "Storefront" (visibility) field below, now that both are scoped to the caller's own branch. */
  const openingStockStorefronts = useMemo(
    () => (isSuperAdmin ? allStorefronts : allStorefronts.filter((location) => location.id === session?.branch?.id)),
    [allStorefronts, isSuperAdmin, session?.branch?.id]
  );

  /** A branch-scoped Manager only ever sees their own storefront here — never "All Storefronts" or
   * another branch, which would let their product show up (and be sellable) elsewhere. */
  const formStorefrontOptions = useMemo(
    () =>
      isSuperAdmin
        ? [{ value: "", label: "All Storefronts" }, ...allStorefronts.map((location) => ({ value: location.id, label: location.locationName }))]
        : allStorefronts
            .filter((location) => location.id === session?.branch?.id)
            .map((location) => ({ value: location.id, label: location.locationName })),
    [allStorefronts, isSuperAdmin, session?.branch?.id]
  );

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handlePickImage(): Promise<void> {
    setImageBusy(true);
    try {
      const relativePath = await window.blueLedger.product.pickImage();
      if (relativePath) updateField("imagePath", relativePath);
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

    const openingStockEntries = Object.entries(openingStock)
      .map(([locationId, quantity]) => ({ locationId, quantity: Number(quantity) || 0 }))
      .filter((entry) => entry.quantity > 0);

    try {
      const product = await window.blueLedger.product.create({
        sku: form.sku,
        barcode: form.barcode,
        supplierSku: form.supplierSku,
        name: form.name,
        shortName: form.shortName,
        description: form.description,
        categoryId: form.categoryId ? form.categoryId : null,
        storefrontId: form.storefrontId ? form.storefrontId : null,
        unitOfMeasure: form.unitOfMeasure ? form.unitOfMeasure : null,
        buyingPriceCents: toCents(form.buyingPrice),
        sellingPriceCents: toCents(form.sellingPrice),
        wholesalePriceCents: form.wholesalePrice.trim() ? toCents(form.wholesalePrice) : null,
        wholesaleMinQuantity: Number(form.wholesaleMinQuantity) || 0,
        minimumPriceCents: form.minimumPrice.trim() ? toCents(form.minimumPrice) : null,
        taxRate: Number(form.taxRate) || 0,
        reorderLevel: Number(form.reorderLevel) || 0,
        trackStock: form.trackStock,
        allowNegativeStock: form.allowNegativeStock,
        imagePath: form.imagePath,
        openingStock: openingStockEntries
      });
      onCreated(product);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create product"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Product"
      description={
        isSuperAdmin
          ? "Choose which storefront this product belongs to, or leave it available to all of them."
          : "Created for your own storefront."
      }
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
            <p className="mt-1.5 text-[11px] font-semibold text-muted">JPG, PNG, or WEBP · max 10MB</p>
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
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            placeholder="Click here, then scan — or type e.g. 5449000000996"
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
          <SelectField
            label="Storefront"
            value={form.storefrontId}
            onChange={(value) => updateField("storefrontId", value)}
            options={formStorefrontOptions}
            disabled={!isSuperAdmin}
          />
          <Field
            label="Supplier SKU"
            value={form.supplierSku}
            onChange={(value) => updateField("supplierSku", value)}
            placeholder="e.g. supplier's own code"
          />
          <SelectField
            label="Unit of Measure"
            value={form.unitOfMeasure}
            onChange={(value) => updateField("unitOfMeasure", value)}
            options={[{ value: "", label: "Not set" }, ...UNIT_OF_MEASURE_OPTIONS]}
          />
          <TextAreaField
            label="Description"
            value={form.description}
            onChange={(value) => updateField("description", value)}
            placeholder="e.g. 500ml glass bottle, returnable"
            className="sm:col-span-2"
          />
        </div>
        <p className="mt-2 text-[11px] font-semibold text-muted">
          {isSuperAdmin
            ? `"All Storefronts" means every storefront can see and sell it. A specific storefront means only that one can.`
            : "You can only create products for your own storefront."}
        </p>

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
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Stock Settings</p>
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
          <p className="mt-1.5 text-[11px] font-semibold text-muted">
            A storefront's own on-hand stock below this level is flagged "Low" throughout Main Store.
          </p>
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

        {(mainStore || openingStockStorefronts.length > 0) && (
          <div className="mt-5 border-t border-line pt-5">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Opening Stock (optional)</p>
            <p className="mt-1 text-[11px] font-semibold text-muted">
              Seeds stock directly — a storefront's own shelf, and/or Main Store's own stock, right when the
              product is created.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {mainStore && (
                <Field
                  key={mainStore.id}
                  label={`${mainStore.locationName} (Main Store)`}
                  type="number"
                  value={openingStock[mainStore.id] ?? ""}
                  onChange={(value) => setOpeningStock((prev) => ({ ...prev, [mainStore.id]: value }))}
                  placeholder="0"
                />
              )}
              {openingStockStorefronts
                .filter((location) => !form.storefrontId || location.id === form.storefrontId)
                .map((location) => (
                  <Field
                    key={location.id}
                    label={location.locationName}
                    type="number"
                    value={openingStock[location.id] ?? ""}
                    onChange={(value) => setOpeningStock((prev) => ({ ...prev, [location.id]: value }))}
                    placeholder="0"
                  />
                ))}
            </div>
          </div>
        )}

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
            {saving ? "Creating..." : "Create Product"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
