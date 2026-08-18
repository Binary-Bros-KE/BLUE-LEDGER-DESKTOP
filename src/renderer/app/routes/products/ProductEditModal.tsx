import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2, Package, X } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { CheckboxField, Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getDashboardVariant } from "@renderer/shared/lib/dashboard-role";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { useAppStore } from "@renderer/shared/stores/app-store";
import type { Category } from "@shared/types/category";
import type { Location } from "@shared/types/location";
import {
  PRODUCT_TAX_MODE_OPTIONS,
  TAX_TYPE_OPTIONS,
  UNIT_OF_MEASURE_OPTIONS,
  type Product,
  type ProductTaxMode,
  type ProductTaxType
} from "@shared/types/product";

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
  taxType: ProductTaxType;
  taxMode: ProductTaxMode;
  reorderLevel: string;
  trackStock: boolean;
  allowNegativeStock: boolean;
  imagePath: string | null;
};

function toFormState(product: Product): FormState {
  return {
    sku: product.sku,
    barcode: product.barcode ?? "",
    supplierSku: product.supplierSku ?? "",
    name: product.name,
    shortName: product.shortName ?? "",
    description: product.description ?? "",
    categoryId: product.categoryId ?? "",
    storefrontId: product.storefrontId ?? "",
    unitOfMeasure: product.unitOfMeasure ?? "",
    buyingPrice: fromCents(product.buyingPriceCents),
    sellingPrice: fromCents(product.sellingPriceCents),
    wholesalePrice: product.wholesalePriceCents !== null ? fromCents(product.wholesalePriceCents) : "",
    wholesaleMinQuantity: String(product.wholesaleMinQuantity),
    minimumPrice: product.minimumPriceCents !== null ? fromCents(product.minimumPriceCents) : "",
    taxType: product.taxType,
    taxMode: product.pricesTaxInclusive === null ? "inherit" : product.pricesTaxInclusive ? "inclusive" : "exclusive",
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

/** Shared edit form — used from both the Products page and Main Store, since both need to change a
 * product's fields (including which storefront it belongs to) after it's been created. */
export function ProductEditModal({
  product,
  categories,
  storefronts,
  onClose,
  onSaved
}: {
  product: Product;
  categories: Category[];
  storefronts: Location[];
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { session } = usePermissions();
  const isSuperAdmin = getDashboardVariant(session) === "superAdmin";
  const vatRatePercent = useAppStore((state) => state.context?.tenant.vatRatePercent ?? 16);
  const pricesTaxInclusive = useAppStore((state) => state.context?.tenant.pricesTaxInclusive ?? true);
  const businessDefaultTaxModeLabel = pricesTaxInclusive ? "currently Inclusive" : "currently Exclusive";

  const [form, setForm] = useState<FormState>(() => toFormState(product));
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = useMemo(() => buildCategoryOptions(categories), [categories]);

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

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handlePickImage(): Promise<void> {
    setImageBusy(true);
    try {
      const relativePath = await window.blueLedger.product.pickImage();
      if (relativePath) updateField("imagePath", relativePath);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to attach image");
      setError(message);
      showErrorToast(message);
    } finally {
      setImageBusy(false);
    }
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    // Same check the schema enforces server-side (productUpdateSchema) — caught here first so it's
    // immediate. A minimum price above the selling price can never actually be sold —
    // checkout/invoices/quotations would reject every sale of this product outright.
    if (form.minimumPrice.trim() && toCents(form.minimumPrice) > toCents(form.sellingPrice)) {
      const message = "Minimum price can't be higher than the selling price";
      setError(message);
      showErrorToast(message);
      return;
    }

    setSaving(true);

    try {
      await window.blueLedger.product.update(product.id, {
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
        // taxRate is no longer the calculation driver (see tax-calculation.ts) — kept in sync with
        // taxType purely for any old code/report still reading it directly.
        taxRate: form.taxType === "vat" ? vatRatePercent : 0,
        taxType: form.taxType,
        pricesTaxInclusive: form.taxMode === "inherit" ? null : form.taxMode === "inclusive",
        reorderLevel: Number(form.reorderLevel) || 0,
        trackStock: form.trackStock,
        allowNegativeStock: form.allowNegativeStock,
        imagePath: form.imagePath
      });
      showSuccessToast(`Product "${form.name}" updated`);
      onSaved();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save product");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit product"
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
          <div className="relative grid size-20 flex-none place-items-center overflow-hidden rounded-lg border border-line bg-soft">
            {imagePreviewUrl ? (
              // Absolute (not size-full) — see ProductThumbnail.tsx's own doc comment for why a
              // percentage height inside a place-items-center grid cell can't be trusted otherwise.
              <img src={imagePreviewUrl} alt="" className="absolute inset-0 size-full object-contain" />
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
              // A scanner ends every scan with Enter — without this it would submit the whole form
              // mid-edit instead of just filling this field.
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
            options={[
              { value: "", label: "All Storefronts" },
              ...storefronts.map((location) => ({ value: location.id, label: location.locationName }))
            ]}
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
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Stock Settings</p>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <SelectField
              label="Tax"
              value={form.taxType}
              onChange={(value) => updateField("taxType", value as ProductTaxType)}
              options={TAX_TYPE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.value === "vat" ? `${option.label} (${vatRatePercent}%)` : option.label
              }))}
            />
            <SelectField
              label="Tax Mode"
              value={form.taxMode}
              onChange={(value) => updateField("taxMode", value as ProductTaxMode)}
              options={PRODUCT_TAX_MODE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.value === "inherit" ? `${option.label} (${businessDefaultTaxModeLabel})` : option.label
              }))}
              disabled={form.taxType !== "vat"}
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
            Tax Mode only matters for Standard (VAT) products — Exempted and Zero-Rated have no tax
            either way.
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
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
