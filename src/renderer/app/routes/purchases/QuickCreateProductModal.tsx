import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { toCents } from "@renderer/shared/lib/money";
import type { Product } from "@shared/types/product";

/** The fast path for adding a product mid-purchase — only SKU, name, and cost. Selling price
 * defaults to the buying price if left blank; everything else can be refined later from Products. */
export function QuickCreateProductModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (product: Product) => void;
}): React.JSX.Element {
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [name, setName] = useState("");
  const [buyingPrice, setBuyingPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setSku("");
    setBarcode("");
    setName("");
    setBuyingPrice("");
    setSellingPrice("");
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    // Prefills the next auto-generated SKU so nobody has to track the latest number by hand — still a
    // normal editable field, so it can be overridden for a tenant with their own existing SKU scheme.
    void window.blueLedger.product.nextSku().then(setSku).catch(() => {});
  }, [open]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const buyingPriceCents = toCents(buyingPrice);
      const sellingPriceCents = sellingPrice.trim() === "" ? buyingPriceCents : toCents(sellingPrice);
      const product = await window.blueLedger.product.create({
        sku,
        barcode: barcode.trim() ? barcode.trim() : null,
        name,
        buyingPriceCents,
        sellingPriceCents,
        taxRate: 0,
        reorderLevel: 0,
        wholesaleMinQuantity: 0,
        trackStock: true,
        allowNegativeStock: false
      });
      reset();
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
      onClose={() => {
        reset();
        onClose();
      }}
      title="New Product"
      description="Just enough to add it to this purchase — refine pricing and details later from Products."
      widthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <Field label="SKU" value={sku} onChange={setSku} placeholder="e.g. SKU-001" required />
          <Field
            label="Barcode (optional)"
            value={barcode}
            onChange={setBarcode}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            placeholder="Click here, then scan — or leave blank"
          />
          <Field label="Product Name" value={name} onChange={setName} placeholder="e.g. 20L Cooking Oil" required />
          <Field
            label="Buying Price (Cost)"
            type="number"
            value={buyingPrice}
            onChange={setBuyingPrice}
            placeholder="0.00"
            required
          />
          <Field
            label="Selling Price (optional — defaults to cost)"
            type="number"
            value={sellingPrice}
            onChange={setSellingPrice}
            placeholder="0.00"
          />
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
          <Button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
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
