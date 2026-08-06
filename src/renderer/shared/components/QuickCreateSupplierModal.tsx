import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import type { Supplier } from "@shared/types/supplier";

/** The fast path for adding a supplier mid-purchase or mid-checkout (a locally-sourced sale line) —
 * only the fields needed to place an order. Everything else (address, payment details, credit
 * limit) can be filled in later from Suppliers. */
export function QuickCreateSupplierModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (supplier: Supplier) => void;
}): React.JSX.Element {
  const [businessName, setBusinessName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone1, setPhone1] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setBusinessName("");
    setContactPerson("");
    setPhone1("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const supplier = await window.blueLedger.supplier.create({
        businessName,
        contactPerson,
        phone1,
        paymentOption: "cash"
      });
      reset();
      onCreated(supplier);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create supplier"));
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
      title="New Supplier"
      description="Just enough to place an order — add the rest later from Suppliers."
      widthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <Field
            label="Business Name"
            value={businessName}
            onChange={setBusinessName}
            placeholder="e.g. Nairobi Wholesalers Ltd"
            required
          />
          <Field
            label="Contact Person"
            value={contactPerson}
            onChange={setContactPerson}
            placeholder="e.g. John Kamau"
            required
          />
          <Field label="Phone 1" value={phone1} onChange={setPhone1} placeholder="e.g. 0712 345 678" required />
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
            {saving ? "Creating..." : "Create Supplier"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
