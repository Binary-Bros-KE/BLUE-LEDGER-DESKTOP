import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { StorefrontPicker } from "@renderer/shared/components/StorefrontPicker";
import { Field, SelectField } from "@renderer/shared/components/form-fields";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { OnlineOrder } from "@shared/types/online-store";
import type { PaymentMethod } from "@shared/types/payment-method";

/**
 * "Ring up sale" for a web order — records it as a normal completed POS sale (same cart math, tax,
 * stock check and receipt as Checkout) and completes the web order. See convertOnlineOrderToSale.
 */
export function RingUpSaleModal({
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
  onDone: () => void;
}): React.JSX.Element {
  const { session } = usePermissions();
  const needsStorefront = !session?.branch;
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodId, setMethodId] = useState("");
  const [reference, setReference] = useState("");
  // Raw text, exactly as typed — only converted to cents on submit (this app's money-input rule).
  const [amountText, setAmountText] = useState("");
  const [storefrontId, setStorefrontId] = useState(order.fulfilmentLocationId ?? "");
  const [chargeWebPrice, setChargeWebPrice] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMethodId("");
    setReference("");
    setAmountText("");
    setStorefrontId(order.fulfilmentLocationId ?? "");
    setChargeWebPrice(true);
    setError(null);
    void window.blueLedger.paymentMethod
      .list()
      .then((list) => setMethods(list.filter((m) => m.isActive).sort((a, b) => a.sortOrder - b.sortOrder)))
      .catch(() => setMethods([]));
  }, [open, order]);

  const method = useMemo(() => methods.find((m) => m.id === methodId) ?? null, [methods, methodId]);
  const money = (cents: number) => `${currency} ${formatCents(cents)}`.trim();

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!methodId) {
      setError("Choose how the customer paid.");
      return;
    }
    if (method?.requiresReference && !reference.trim()) {
      setError(`${method.name} needs a reference (e.g. the M-Pesa code).`);
      return;
    }
    if (needsStorefront && !storefrontId) {
      setError("Choose which storefront this sale is from.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await window.blueLedger.onlineOrders.convertToSale({
        orderId: order.id,
        paymentMethodId: methodId,
        paymentReference: reference.trim() || null,
        amountReceivedCents: amountText.trim() ? toCents(amountText) : null,
        storefrontId: needsStorefront ? storefrontId : null,
        chargeWebPrice
      });
      showSuccessToast(
        `${order.orderNumber} rung up — receipt ${result.receiptNumber ?? result.saleId} (${money(result.grandTotalCents)})`
      );
      if (result.linkWarning) showErrorToast(result.linkWarning);
      onDone();
    } catch (err) {
      const message = getErrorMessage(err, "Couldn't record the sale");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Ring up ${order.orderNumber}`}
      description="Records a completed sale at the website's prices and marks the web order completed. Stock is deducted like any sale."
      widthClassName="max-w-lg"
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
        )}

        <div className="rounded-lg border border-line">
          {order.items.map((it) => (
            <div key={it.productId} className="flex items-start justify-between gap-3 border-b border-line px-3 py-2 text-sm last:border-b-0">
              <span className="line-clamp-2 font-semibold text-ink">
                {it.name} <span className="text-muted">× {it.qty}</span>
              </span>
              <span className="flex-none font-bold tabular-nums">{money(it.lineTotalCents)}</span>
            </div>
          ))}
          {order.deliveryFeeCents > 0 && (
            <div className="flex justify-between border-t border-line px-3 py-2 text-sm font-semibold text-muted">
              <span>Delivery{order.deliveryMethodName ? ` — ${order.deliveryMethodName}` : ""}</span>
              <span className="tabular-nums">{money(order.deliveryFeeCents)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-line bg-soft/60 px-3 py-2 text-sm font-extrabold">
            <span>Website total</span>
            <span className="tabular-nums">{money(order.totalCents)}</span>
          </div>
        </div>

        <p className="text-xs font-semibold text-muted">
          Recorded as a walk-in sale labelled &ldquo;Web order {order.orderNumber}&rdquo;.
        </p>

        {needsStorefront && (
          <div>
            <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-muted">Sell from storefront</p>
            <StorefrontPicker value={storefrontId} onChange={setStorefrontId} />
          </div>
        )}

        <SelectField
          label="Payment Method"
          value={methodId}
          onChange={setMethodId}
          options={[
            { value: "", label: "Select payment method" },
            ...methods.map((m) => ({ value: m.id, label: m.name }))
          ]}
        />
        {method?.requiresReference && (
          <Field
            label="Reference"
            value={reference}
            onChange={setReference}
            placeholder="e.g. M-Pesa code, transaction ID"
            required
          />
        )}
        <Field
          label="Amount received (optional)"
          value={amountText}
          onChange={setAmountText}
          placeholder={formatCents(order.totalCents)}
        />

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-3">
          <input
            type="checkbox"
            checked={chargeWebPrice}
            onChange={(e) => setChargeWebPrice(e.target.checked)}
            className="mt-0.5 size-4 flex-none accent-[var(--color-primary)]"
          />
          <span className="text-sm">
            <span className="font-extrabold text-ink">Charge exactly the website price</span>
            <span className="block text-xs font-semibold text-muted">
              VAT is taken out of the price the customer saw, never added on top. Untick only if you agreed a
              different total with the customer.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" onClick={onClose} className="border border-line bg-white text-ink shadow-none hover:bg-soft">
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="gap-2 bg-primary">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Record sale
          </Button>
        </div>
      </form>
    </Modal>
  );
}
