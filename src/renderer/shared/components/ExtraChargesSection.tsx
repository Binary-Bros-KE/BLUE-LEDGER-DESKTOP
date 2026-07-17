import { useEffect, useState } from "react";
import { Plus, Trash2, Truck, Wrench } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { CheckboxField, Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import type { Rider } from "@shared/types/rider";

/** fee/cost are kept as the raw text the user typed (currency units, e.g. "250.00"), not cents —
 * converting through toCents/fromCents on every keystroke fights typing (each keystroke would
 * re-format the field and jump the cursor). Callers convert via toCents() only when computing totals
 * or building the submission payload. */
export type ServiceChargeDraft = {
  key: string;
  name: string;
  fee: string;
  cost: string;
};

export type DeliveryDraft = {
  riderId: string | null;
  recipientName: string;
  country: string;
  town: string;
  physicalAddress: string;
  notes: string;
  fee: string;
  cost: string;
};

export function emptyDeliveryDraft(recipientName: string): DeliveryDraft {
  return {
    riderId: null,
    recipientName,
    country: "",
    town: "",
    physicalAddress: "",
    notes: "",
    fee: "",
    cost: ""
  };
}

/**
 * Reusable across Checkout, Invoice creation, and Quotation creation — unlimited named service
 * charges (each with a hidden internal cost) plus one optional delivery (recipient/address/rider,
 * also with a hidden cost). Purely controlled: the parent owns the arrays and includes them in the
 * checkout/invoice/quotation payload.
 */
export function ExtraChargesSection({
  serviceCharges,
  onServiceChargesChange,
  delivery,
  onDeliveryChange,
  customerName
}: {
  serviceCharges: ServiceChargeDraft[];
  onServiceChargesChange: (next: ServiceChargeDraft[]) => void;
  delivery: DeliveryDraft | null;
  onDeliveryChange: (next: DeliveryDraft | null) => void;
  customerName?: string | null;
}): React.JSX.Element {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [riderModalOpen, setRiderModalOpen] = useState(false);

  useEffect(() => {
    window.blueLedger.rider
      .list()
      .then(setRiders)
      .catch(() => undefined);
  }, []);

  function addServiceCharge(): void {
    onServiceChargesChange([...serviceCharges, { key: crypto.randomUUID(), name: "", fee: "", cost: "" }]);
  }

  function updateServiceCharge(key: string, patch: Partial<ServiceChargeDraft>): void {
    onServiceChargesChange(serviceCharges.map((charge) => (charge.key === key ? { ...charge, ...patch } : charge)));
  }

  function removeServiceCharge(key: string): void {
    onServiceChargesChange(serviceCharges.filter((charge) => charge.key !== key));
  }

  function toggleDelivery(enabled: boolean): void {
    onDeliveryChange(enabled ? emptyDeliveryDraft(customerName ?? "") : null);
  }

  function updateDelivery(patch: Partial<DeliveryDraft>): void {
    if (!delivery) return;
    onDeliveryChange({ ...delivery, ...patch });
  }

  const activeRiders = riders.filter((rider) => rider.status === "active");

  return (
    <div className="mt-3 space-y-4 border-t border-line pt-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-muted">
            <Wrench className="size-3.5 text-primary" aria-hidden="true" />
            Service Charges
          </p>
          <button
            type="button"
            onClick={addServiceCharge}
            className="flex items-center gap-1 text-[11px] font-bold text-accent hover:underline cursor-pointer"
          >
            <Plus className="size-3" aria-hidden="true" />
            Add Charge
          </button>
        </div>

        {serviceCharges.length > 0 && (
          <div className="mt-2 space-y-2">
            {serviceCharges.map((charge) => (
              <div
                key={charge.key}
                className="grid grid-cols-[1fr_84px_84px_auto] items-end gap-1.5 rounded-lg border border-dashed border-line bg-soft/40 p-2"
              >
                <Field
                  label="Name"
                  value={charge.name}
                  onChange={(value) => updateServiceCharge(charge.key, { name: value })}
                  placeholder="e.g. Labour"
                />
                <Field
                  label="Fee"
                  type="number"
                  value={charge.fee}
                  onChange={(value) => updateServiceCharge(charge.key, { fee: value })}
                  placeholder="0.00"
                />
                <Field
                  label="Cost"
                  type="number"
                  value={charge.cost}
                  onChange={(value) => updateServiceCharge(charge.key, { cost: value })}
                  placeholder="0.00"
                />
                <button
                  type="button"
                  onClick={() => removeServiceCharge(charge.key)}
                  aria-label="Remove charge"
                  className="mb-0.5 grid size-9 flex-none place-items-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
            <p className="text-[10px] font-semibold text-muted">
              Cost is internal-only — never shown on the receipt/invoice/quotation, used for profit reporting.
            </p>
          </div>
        )}
      </div>

      <div>
        <CheckboxField
          label="Add delivery for this sale"
          description="Captures a recipient, address, and rider — prints on its own Delivery Note document."
          checked={delivery !== null}
          onChange={toggleDelivery}
        />

        {delivery && (
          <div className="mt-2 space-y-3 rounded-lg border border-dashed border-line bg-soft/40 p-3">
            <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-muted">
              <Truck className="size-3.5 text-primary" aria-hidden="true" />
              Delivery Details
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Recipient Name"
                value={delivery.recipientName}
                onChange={(value) => updateDelivery({ recipientName: value })}
                placeholder="Who is receiving this?"
                required
              />
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Rider</span>
                <div className="mt-1.5 flex gap-1.5">
                  <select
                    value={delivery.riderId ?? ""}
                    onChange={(event) => updateDelivery({ riderId: event.target.value || null })}
                    className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                  >
                    <option value="">Select a rider...</option>
                    {activeRiders.map((rider) => (
                      <option key={rider.id} value={rider.id}>
                        {rider.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    onClick={() => setRiderModalOpen(true)}
                    className="h-10 flex-none border border-line bg-white px-3 text-xs text-ink shadow-none hover:bg-soft"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field
                label="Country"
                value={delivery.country}
                onChange={(value) => updateDelivery({ country: value })}
                placeholder="e.g. Kenya"
              />
              <Field
                label="Town"
                value={delivery.town}
                onChange={(value) => updateDelivery({ town: value })}
                placeholder="e.g. Westlands"
              />
              <Field
                label="Physical Address"
                value={delivery.physicalAddress}
                onChange={(value) => updateDelivery({ physicalAddress: value })}
                placeholder="Delivery address"
                required
              />
            </div>

            <TextAreaField
              label="Delivery Notes"
              value={delivery.notes}
              onChange={(value) => updateDelivery({ notes: value })}
              placeholder="Optional delivery instructions"
              rows={2}
            />

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Delivery Fee"
                type="number"
                value={delivery.fee}
                onChange={(value) => updateDelivery({ fee: value })}
                placeholder="0.00"
              />
              <Field
                label="Delivery Cost"
                type="number"
                value={delivery.cost}
                onChange={(value) => updateDelivery({ cost: value })}
                placeholder="0.00"
              />
            </div>
            <p className="text-[10px] font-semibold text-muted">
              Cost is internal-only — never shown on the receipt/invoice/quotation, used to tell whether delivery is
              actually profitable.
            </p>
          </div>
        )}
      </div>

      {riderModalOpen && (
        <QuickCreateRiderModal
          onClose={() => setRiderModalOpen(false)}
          onCreated={(rider) => {
            setRiders((prev) => [...prev, rider]);
            updateDelivery({ riderId: rider.id });
            setRiderModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

function QuickCreateRiderModal({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (rider: Rider) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicleDescription, setVehicleDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const rider = await window.blueLedger.rider.create({
        name,
        phone,
        altPhone: "",
        company: "",
        vehicleDescription
      });
      onCreated(rider);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create rider"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New Rider"
      description="Quickly add a rider without leaving this form."
      widthClassName="max-w-sm"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <Field label="Name" value={name} onChange={setName} placeholder="e.g. James Otieno" required />
          <Field label="Phone" value={phone} onChange={setPhone} placeholder="e.g. 0712 345 678" required />
          <Field
            label="Vehicle"
            value={vehicleDescription}
            onChange={setVehicleDescription}
            placeholder="e.g. Motorbike - KMEA 123B"
          />
        </div>
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button
            type="button"
            onClick={onClose}
            className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Saving..." : "Create Rider"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
