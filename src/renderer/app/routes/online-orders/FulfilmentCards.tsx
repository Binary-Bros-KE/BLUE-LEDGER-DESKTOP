import { useEffect, useState } from "react";
import { Check, Loader2, Lock, MapPin, Store, Truck } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import type { OnlineOrder, OnlineOrderDeliveryType, WebDeliveryMethod } from "@shared/types/online-store";
import { canSwitchRoute, routeOf } from "./order-flow";

/**
 * Pick up from shop / Delivery as two selectable cards. Switching is allowed while the order is
 * pending or confirmed (SERVER enforces the same); delivery asks for the address + delivery option,
 * whose fee is re-read server-side and changes the order total.
 */
export function FulfilmentCards({
  order,
  editable,
  money,
  onChanged
}: {
  order: OnlineOrder;
  /** user may edit orders at all */
  editable: boolean;
  money: (cents: number) => string;
  onChanged: (updated: OnlineOrder) => void;
}): React.JSX.Element {
  const route = routeOf(order);
  const unlocked = editable && canSwitchRoute(order);
  const [busy, setBusy] = useState<OnlineOrderDeliveryType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);

  async function choosePickup(): Promise<void> {
    if (!unlocked || route === "pickup") return;
    setBusy("pickup");
    setError(null);
    try {
      onChanged(
        await window.blueLedger.onlineOrders.setFulfilment({
          orderId: order.id,
          deliveryType: "pickup",
          deliveryAddress: null,
          deliveryMethodId: null
        })
      );
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't switch to pick-up"));
    } finally {
      setBusy(null);
    }
  }

  const cards: {
    key: OnlineOrderDeliveryType;
    title: string;
    icon: typeof Store;
    detail: React.ReactNode;
    onClick: () => void;
  }[] = [
    {
      key: "pickup",
      title: "Pick up from shop",
      icon: Store,
      detail: "Customer collects it — no delivery fee.",
      onClick: () => void choosePickup()
    },
    {
      key: "delivery",
      title: "Delivery",
      icon: Truck,
      detail:
        route === "delivery" ? (
          <>
            <span className="flex items-start gap-1">
              <MapPin className="mt-0.5 size-3 flex-none" aria-hidden="true" />
              <span className="whitespace-pre-line">{order.deliveryAddress || "No address yet"}</span>
            </span>
            <span className="mt-0.5 block">
              {order.deliveryMethodName ?? "Fee to be arranged"}
              {order.deliveryFeeCents > 0 ? ` · ${money(order.deliveryFeeCents)}` : ""}
            </span>
          </>
        ) : (
          "Send it to the customer's address."
        ),
      onClick: () => unlocked && setDeliveryOpen(true)
    }
  ];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">How it reaches the customer</p>
        {!unlocked && editable && (order.status !== "COMPLETED" && order.status !== "CANCELLED") && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-muted">
            <Lock className="size-3" aria-hidden="true" /> Locked after confirmation step
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => {
          const Icon = c.icon;
          const selected = route === c.key;
          const clickable = unlocked && (!selected || c.key === "delivery");
          return (
            <button
              key={c.key}
              type="button"
              onClick={c.onClick}
              disabled={!clickable || busy !== null}
              className={cn(
                "relative flex items-start gap-3 rounded-xl border-2 p-3.5 text-left transition",
                selected ? "border-accent bg-accent/[0.07] shadow-soft" : "border-line bg-white",
                clickable ? "cursor-pointer hover:border-accent/60" : "cursor-default",
                !selected && !unlocked && "opacity-50"
              )}
            >
              <span
                className={cn(
                  "grid size-10 flex-none place-items-center rounded-lg",
                  selected ? "bg-accent text-white" : "bg-soft text-ink"
                )}
              >
                {busy === c.key ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Icon className="size-5" aria-hidden="true" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-extrabold", selected ? "text-accent" : "text-ink")}>{c.title}</span>
                <span className="mt-0.5 block text-xs font-semibold text-muted">{c.detail}</span>
                {selected && c.key === "delivery" && unlocked && (
                  <span className="mt-1.5 inline-block text-[11px] font-extrabold text-accent underline">Edit address / option</span>
                )}
              </span>
              {selected && (
                <span className="absolute right-2.5 top-2.5 grid size-5 place-items-center rounded-full bg-accent text-white">
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-xs font-bold text-danger">{error}</p>}

      <DeliveryDetailsModal
        order={order}
        open={deliveryOpen}
        onClose={() => setDeliveryOpen(false)}
        onSaved={(updated) => {
          setDeliveryOpen(false);
          onChanged(updated);
        }}
      />
    </div>
  );
}

function DeliveryDetailsModal({
  order,
  open,
  onClose,
  onSaved
}: {
  order: OnlineOrder;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: OnlineOrder) => void;
}): React.JSX.Element {
  const [methods, setMethods] = useState<WebDeliveryMethod[] | null>(null);
  const [address, setAddress] = useState("");
  const [methodId, setMethodId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAddress(order.deliveryAddress ?? "");
    setError(null);
    setMethods(null);
    void window.blueLedger.onlineStore
      .deliveryList()
      .then((list) => {
        const active = list.filter((m) => m.active);
        setMethods(active);
        setMethodId(active.find((m) => m.name === order.deliveryMethodName)?.id ?? "");
      })
      .catch((err: unknown) => {
        setMethods([]);
        setError(getErrorMessage(err, "Couldn't load delivery options"));
      });
  }, [open, order.id, order.deliveryAddress, order.deliveryMethodName]);

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!address.trim()) return setError("Enter the delivery address.");
    if (methods && methods.length > 0 && !methodId) return setError("Choose a delivery option.");
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await window.blueLedger.onlineOrders.setFulfilment({
          orderId: order.id,
          deliveryType: "delivery",
          deliveryAddress: address.trim(),
          deliveryMethodId: methodId || null
        })
      );
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't save the delivery details"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Delivery — ${order.orderNumber}`}
      description="The delivery fee comes from the option you choose and is added to the order total."
      widthClassName="max-w-md"
    >
      <form onSubmit={(e) => void save(e)} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
        )}
        <TextAreaField label="Delivery address" value={address} onChange={setAddress} rows={3} placeholder="Estate, street, building, landmark…" />
        {methods === null ? (
          <div className="flex items-center gap-2 text-xs font-semibold text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading delivery options…
          </div>
        ) : methods.length > 0 ? (
          <SelectField
            label="Delivery option"
            value={methodId}
            onChange={setMethodId}
            options={[
              { value: "", label: "Select delivery option" },
              ...methods.map((m) => ({ value: m.id, label: `${m.name} — ${formatCents(m.priceCents)}` }))
            ]}
          />
        ) : (
          <p className="text-xs font-semibold text-muted">
            No delivery options are set up — the fee will be to be arranged (0). Add options under Delivery Options.
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" onClick={onClose} className="border border-line bg-white text-ink shadow-none hover:bg-soft">
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="gap-2 bg-accent">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Truck className="size-4" aria-hidden="true" />}
            Use delivery
          </Button>
        </div>
      </form>
    </Modal>
  );
}
