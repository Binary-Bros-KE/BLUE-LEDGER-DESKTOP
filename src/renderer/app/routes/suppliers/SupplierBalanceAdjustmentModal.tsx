import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { Supplier } from "@shared/types/supplier";

type Direction = "increase" | "decrease";

/** Covers both "record balance carried forward from the old system" (increase, no purchase behind
 * it — just enter the amount from their old records) and any later correction. Same generic-action
 * reasoning as supplierBalanceAdjustSchema's own doc comment: the note is what tells the two apart on
 * the statement, not a separate flow. */
export function SupplierBalanceAdjustmentModal({
  supplier,
  onClose,
  onSaved
}: {
  supplier: Supplier;
  onClose: () => void;
  onSaved: (updatedBalanceCents: number) => void;
}): React.JSX.Element {
  const [direction, setDirection] = useState<Direction>("increase");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setActionError(null);

    const magnitudeCents = toCents(amount);
    if (!Number.isFinite(magnitudeCents) || magnitudeCents <= 0) {
      const message = "Enter an amount greater than 0";
      setActionError(message);
      showErrorToast(message);
      return;
    }
    if (!notes.trim()) {
      const message = 'Add a note explaining this adjustment (e.g. "Carried forward from old system")';
      setActionError(message);
      showErrorToast(message);
      return;
    }

    setSaving(true);
    try {
      const entry = await window.blueLedger.supplier.adjustBalance(supplier.id, {
        amountCents: direction === "increase" ? magnitudeCents : -magnitudeCents,
        notes: notes.trim()
      });
      onSaved(supplier.balanceCents + entry.amountCents);
      showSuccessToast("Balance updated.");
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to record balance adjustment");
      setActionError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record Balance Adjustment"
      description={`${supplier.businessName} — current balance ${formatCents(supplier.balanceCents)}`}
      widthClassName="max-w-md"
    >
      {actionError && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
          {actionError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-[11px] font-semibold text-muted">
          Use this to record a balance carried forward from your old system, or to correct the balance for any
          other reason. Amount decreases or increases what you owe this supplier — it's never derived from
          Purchases, so this is the only way to move it outside a purchase order or payment.
        </p>

        <div className="flex gap-1.5 rounded-lg border border-line bg-soft p-1">
          <button
            type="button"
            onClick={() => setDirection("increase")}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition cursor-pointer",
              direction === "increase" ? "bg-primary text-white" : "text-muted hover:bg-white"
            )}
          >
            Increase (owe more)
          </button>
          <button
            type="button"
            onClick={() => setDirection("decrease")}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-wide transition cursor-pointer",
              direction === "decrease" ? "bg-primary text-white" : "text-muted hover:bg-white"
            )}
          >
            Decrease (owe less)
          </button>
        </div>

        <Field label="Amount" type="number" value={amount} onChange={setAmount} placeholder="e.g. 800000" required />
        <TextAreaField
          label="Notes"
          value={notes}
          onChange={setNotes}
          rows={2}
          placeholder='e.g. "Carried forward from old system as of Jan 2026"'
        />

        <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
          <Button
            type="button"
            onClick={onClose}
            className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
