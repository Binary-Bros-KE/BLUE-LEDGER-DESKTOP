import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { StorefrontPicker } from "@renderer/shared/components/StorefrontPicker";
import { Field, SelectField } from "@renderer/shared/components/form-fields";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import type { ConvertOnlineOrderResult, OnlineOrder } from "@shared/types/online-store";
import { useActivePaymentMethods } from "./RecordPaymentModal";

/**
 * The last step: converts a picked-up / delivered web order into a normal completed sale (receipt,
 * stock deducted, in every sales report; plus a delivery note for a delivery order) — see
 * convertOnlineOrderToSale. Whatever is still owed can be paid right here.
 */
export function CompleteOrderModal({
  order,
  open,
  currency,
  onClose,
  onDone
}: {
  order: OnlineOrder;
  open: boolean;
  currency: string;
  onClose: () => void;
  onDone: (result: ConvertOnlineOrderResult) => void;
}): React.JSX.Element {
  const { session } = usePermissions();
  const needsStorefront = !session?.branch;
  const methods = useActivePaymentMethods(open);
  const [methodId, setMethodId] = useState("");
  const [reference, setReference] = useState("");
  const [storefrontId, setStorefrontId] = useState(order.stockHold?.locationId ?? order.fulfilmentLocationId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMethodId("");
    setReference("");
    setStorefrontId(order.stockHold?.locationId ?? order.fulfilmentLocationId ?? "");
    setError(null);
  }, [open, order.id, order.stockHold?.locationId, order.fulfilmentLocationId]);

  const method = useMemo(() => methods.find((m) => m.id === methodId) ?? null, [methods, methodId]);
  const money = (cents: number) => `${currency} ${formatCents(cents)}`.trim();
  const owed = order.balanceCents;
  const delivery = order.deliveryType !== "pickup";

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (owed > 0 && !methodId) return setError(`Choose how the customer paid the ${money(owed)} balance.`);
    if (owed > 0 && method?.requiresReference && !reference.trim()) {
      return setError(`${method.name} needs a reference (e.g. the M-Pesa code).`);
    }
    if (needsStorefront && !storefrontId) return setError("Choose which storefront this sale is from.");
    setSaving(true);
    setError(null);
    try {
      const result = await window.blueLedger.onlineOrders.convertToSale({
        orderId: order.id,
        storefrontId: needsStorefront ? storefrontId : null,
        finalPayment:
          owed > 0 ? { paymentMethodId: methodId, amountCents: owed, reference: reference.trim() || null } : null
      });
      onDone(result);
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't complete the order"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Complete ${order.orderNumber}`}
      description="Turns this web order into a sale."
      widthClassName="max-w-lg"
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3.5">
          <AlertTriangle className="mt-0.5 size-5 flex-none text-warning" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-extrabold text-ink">Heads up — this converts the order into a sale</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs font-semibold text-muted">
              <li>A receipt is created and it counts in all your sales reports.</li>
              <li>
                {order.stockHold
                  ? "The stock held for this order becomes the sale's stock (no double deduction)."
                  : "Stock for every item is deducted now."}
              </li>
              <li>The payments below become the sale&apos;s payments.</li>
              {delivery && <li>A delivery note is created, already marked delivered.</li>}
              <li>It can&apos;t be undone from here — use Returns/Void on the receipt if needed.</li>
            </ul>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
        )}

        <div className="rounded-lg border border-line text-sm">
          {order.items.map((it, index) => (
            <div key={`${it.productId}-${it.variantKey ?? index}`} className="flex justify-between gap-3 border-b border-line px-3 py-2">
              <span className="font-semibold text-ink">
                {it.name} <span className="text-muted">× {it.qty}</span>
              </span>
              <span className="flex-none font-bold tabular-nums">{money(it.lineTotalCents)}</span>
            </div>
          ))}
          {order.deliveryFeeCents > 0 && (
            <div className="flex justify-between border-b border-line px-3 py-2 font-semibold text-muted">
              <span>Delivery{order.deliveryMethodName ? ` — ${order.deliveryMethodName}` : ""}</span>
              <span className="tabular-nums">{money(order.deliveryFeeCents)}</span>
            </div>
          )}
          <div className="flex justify-between bg-soft/60 px-3 py-2 font-extrabold">
            <span>Sale total</span>
            <span className="tabular-nums">{money(order.totalCents)}</span>
          </div>
          {order.payments.map((p) => (
            <div key={p.id} className="flex justify-between border-t border-line px-3 py-1.5 text-xs font-semibold text-success">
              <span>
                Paid · {p.paymentMethodName}
                {p.reference ? ` (${p.reference})` : ""}
              </span>
              <span className="tabular-nums">{money(p.amountCents)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-line px-3 py-2 font-extrabold">
            <span>{owed > 0 ? "Balance to pay now" : "Fully paid"}</span>
            <span className={owed > 0 ? "tabular-nums text-danger" : "tabular-nums text-success"}>{money(owed)}</span>
          </div>
        </div>

        {owed > 0 && (
          <div className="space-y-3 rounded-lg border border-line p-3">
            <SelectField
              label={`Balance of ${money(owed)} paid with`}
              value={methodId}
              onChange={setMethodId}
              options={[{ value: "", label: "Select payment method" }, ...methods.map((m) => ({ value: m.id, label: m.name }))]}
            />
            {method?.requiresReference && (
              <Field label="Reference" value={reference} onChange={setReference} placeholder="e.g. M-Pesa code" required />
            )}
          </div>
        )}

        {needsStorefront && (
          <div>
            <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-muted">Sell from storefront</p>
            <StorefrontPicker value={storefrontId} onChange={setStorefrontId} />
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" onClick={onClose} className="border border-line bg-white text-ink shadow-none hover:bg-soft">
            Not yet
          </Button>
          <Button type="submit" disabled={saving} className="gap-2 bg-success">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
            Complete &amp; create sale
          </Button>
        </div>
      </form>
    </Modal>
  );
}
