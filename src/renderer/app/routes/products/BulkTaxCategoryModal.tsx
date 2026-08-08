import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { SelectField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { TAX_TYPE_OPTIONS, type ProductTaxType } from "@shared/types/product";

/**
 * Backfill tool for a tenant onboarded before tax categories existed — their whole catalog (or any
 * subset) gets re-classified in a few clicks instead of one-by-one, or a re-import that would just
 * create duplicate products (products from that era have no unique code, only names). Every
 * affected product gets marked sync_status='pending' by the same narrow UPDATE setProductStatus
 * already uses, so the change queues for sync exactly like any other product edit.
 */
export function BulkTaxCategoryModal({
  open,
  onClose,
  productIds,
  onApplied
}: {
  open: boolean;
  onClose: () => void;
  productIds: string[];
  onApplied: (updatedCount: number) => Promise<void> | void;
}): React.JSX.Element {
  const [taxType, setTaxType] = useState<ProductTaxType>("vat");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApply(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const { updatedCount } = await window.blueLedger.product.bulkSetTaxType({ productIds, taxType });
      await onApplied(updatedCount);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update tax category"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Set Tax Category"
      description={`Applies to ${productIds.length} selected product${productIds.length === 1 ? "" : "s"}.`}
      widthClassName="max-w-md"
    >
      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
          {error}
        </div>
      )}

      <SelectField
        label="Tax Category"
        value={taxType}
        onChange={(value) => setTaxType(value as ProductTaxType)}
        options={TAX_TYPE_OPTIONS}
      />

      <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs font-bold text-ink">
        This overwrites the tax category on every selected product — double check this is correct for
        your business before applying. It doesn't touch any other product field.
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
          onClick={() => void handleApply()}
          disabled={saving}
          className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? "Applying..." : "Apply"}
        </Button>
      </div>
    </Modal>
  );
}
