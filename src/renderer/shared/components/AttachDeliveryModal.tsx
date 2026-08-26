import { useEffect, useState } from "react";
import { Loader2, Truck } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { emptyDeliveryDraft, type DeliveryDraft } from "@renderer/shared/components/ExtraChargesSection";
import { Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { Rider } from "@shared/types/rider";
import type { SaleDelivery } from "@shared/types/sale";

/** For a sale/invoice/quotation that was created without delivery info being entered (e.g. the
 * cashier forgot to check "Add delivery") — mints a real, numbered delivery note against it after
 * the fact. Deliberately never touches the parent document's own totals (see attachDeliveryToSale's
 * own doc comment in delivery-note-service.ts) — fee/cost here are recorded for reference only.
 * Shared by Receipts, Invoices, and Quotations — parentEntity picks which IPC call to make. */
export function AttachDeliveryModal({
  parentEntity,
  parentId,
  customerName,
  onClose,
  onAttached
}: {
  parentEntity: "sale" | "quotation";
  parentId: string;
  customerName: string | null;
  onClose: () => void;
  onAttached: (delivery: SaleDelivery) => void;
}): React.JSX.Element {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [draft, setDraft] = useState<DeliveryDraft>(() => emptyDeliveryDraft(customerName ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.blueLedger.rider
      .list()
      .then(setRiders)
      .catch(() => undefined);
  }, []);

  function update(patch: Partial<DeliveryDraft>): void {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = {
        riderId: draft.riderId,
        recipientName: draft.recipientName,
        country: draft.country,
        town: draft.town,
        physicalAddress: draft.physicalAddress,
        notes: draft.notes,
        feeCents: draft.fee.trim() ? toCents(draft.fee) : 0,
        costCents: draft.cost.trim() ? toCents(draft.cost) : 0
      };
      const delivery =
        parentEntity === "quotation"
          ? await window.blueLedger.deliveryNote.attachToQuotation(parentId, input)
          : await window.blueLedger.deliveryNote.attachToSale(parentId, input);
      showSuccessToast("Delivery attached");
      onAttached(delivery);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to attach delivery");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  const activeRiders = riders.filter((rider) => rider.status === "active");

  return (
    <Modal
      open
      onClose={onClose}
      title="Attach Delivery"
      description="Adds delivery details to this already-completed sale — doesn't change its total."
      widthClassName="max-w-lg"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-muted">
            <Truck className="size-3.5 text-primary" aria-hidden="true" />
            Delivery Details
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Recipient Name"
              value={draft.recipientName}
              onChange={(value) => update({ recipientName: value })}
              placeholder="Who is receiving this?"
              required
            />
            <div>
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Rider</span>
              <select
                value={draft.riderId ?? ""}
                onChange={(event) => update({ riderId: event.target.value || null })}
                className="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
              >
                <option value="">Select a rider...</option>
                {activeRiders.map((rider) => (
                  <option key={rider.id} value={rider.id}>
                    {rider.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Country" value={draft.country} onChange={(value) => update({ country: value })} placeholder="e.g. Kenya" />
            <Field label="Town" value={draft.town} onChange={(value) => update({ town: value })} placeholder="e.g. Westlands" />
            <Field
              label="Physical Address"
              value={draft.physicalAddress}
              onChange={(value) => update({ physicalAddress: value })}
              placeholder="Delivery address"
              required
            />
          </div>

          <TextAreaField
            label="Delivery Notes"
            value={draft.notes}
            onChange={(value) => update({ notes: value })}
            placeholder="Optional delivery instructions"
            rows={2}
          />

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Delivery Fee"
              type="number"
              value={draft.fee}
              onChange={(value) => update({ fee: value })}
              placeholder="0.00"
            />
            <Field
              label="Delivery Cost"
              type="number"
              value={draft.cost}
              onChange={(value) => update({ cost: value })}
              placeholder="0.00"
            />
          </div>
          <p className="text-[10px] font-semibold text-muted">
            Fee/cost are recorded for reference only — this never changes the sale's own total, since it's already
            been paid and closed.
          </p>
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
            {saving ? "Attaching..." : "Attach Delivery"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
