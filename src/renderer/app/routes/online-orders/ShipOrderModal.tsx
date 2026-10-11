import { useEffect, useState } from "react";
import { Loader2, Truck } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { SelectField } from "@renderer/shared/components/form-fields";
import type { OnlineOrder } from "@shared/types/online-store";
import type { Rider } from "@shared/types/rider";

/** "Mark shipped" — optionally names the rider taking it. The rider goes into the customer's
 * message and onto the delivery note the sale gets when the order is completed. */
export function ShipOrderModal({
  order,
  open,
  busy,
  onClose,
  onShip
}: {
  order: OnlineOrder;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onShip: (riderId: string | null) => void;
}): React.JSX.Element {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [riderId, setRiderId] = useState("");

  useEffect(() => {
    if (!open) return;
    setRiderId(order.riderId ?? "");
    void window.blueLedger.rider
      .list()
      .then((list) => setRiders(list.filter((r) => r.status === "active")))
      .catch(() => setRiders([]));
  }, [open, order.riderId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Ship ${order.orderNumber}`}
      description={`On its way to ${order.customerName}.`}
      widthClassName="max-w-md"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-soft/60 p-3 text-sm">
          <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Delivering to</p>
          <p className="mt-0.5 whitespace-pre-line font-semibold text-ink">{order.deliveryAddress || "—"}</p>
        </div>
        <SelectField
          label="Rider (optional)"
          value={riderId}
          onChange={setRiderId}
          options={[
            { value: "", label: riders.length ? "No rider / not decided" : "No riders set up" },
            ...riders.map((r) => ({ value: r.id, label: r.company ? `${r.name} — ${r.company}` : `${r.name} · ${r.phone}` }))
          ]}
        />
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" onClick={onClose} className="border border-line bg-white text-ink shadow-none hover:bg-soft">
            Cancel
          </Button>
          <Button type="button" onClick={() => onShip(riderId || null)} disabled={busy} className="gap-2 bg-teal">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Truck className="size-4" aria-hidden="true" />}
            Mark shipped
          </Button>
        </div>
      </div>
    </Modal>
  );
}
