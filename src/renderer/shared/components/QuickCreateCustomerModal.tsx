import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { Customer } from "@shared/types/customer";

/** The fast path for adding a customer mid-sale/invoice/quotation — only name and phone. Everything
 * else (type, email, address, credit limit) can be filled in later from Customers. Mirrors
 * purchases/QuickCreateSupplierModal.tsx's own shape exactly. */
export function QuickCreateCustomerModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setName("");
    setPhone("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const customer = await window.blueLedger.customer.create({
        name,
        phone,
        customerType: "retail"
      });
      showSuccessToast(`Customer "${customer.name}" created`);
      reset();
      onCreated(customer);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to create customer");
      setError(message);
      showErrorToast(message);
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
      title="New Customer"
      description="Just enough to use them right now — add the rest later from Customers."
      widthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <Field label="Name" value={name} onChange={setName} placeholder="e.g. Jane Wanjiru" required />
          <Field label="Phone" value={phone} onChange={setPhone} placeholder="e.g. 0712 345 678" required />
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
            {saving ? "Creating..." : "Create Customer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
