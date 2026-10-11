import { useEffect, useMemo, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { Field, SelectField } from "@renderer/shared/components/form-fields";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, toCents } from "@renderer/shared/lib/money";
import type { OnlineOrder } from "@shared/types/online-store";
import type { PaymentMethod } from "@shared/types/payment-method";

/** Active payment methods in the shop's own order — shared by the payment + complete modals. */
export function useActivePaymentMethods(open: boolean): PaymentMethod[] {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  useEffect(() => {
    if (!open) return;
    void window.blueLedger.paymentMethod
      .list()
      .then((list) => setMethods(list.filter((m) => m.isActive).sort((a, b) => a.sortOrder - b.sortOrder)))
      .catch(() => setMethods([]));
  }, [open]);
  return methods;
}

/**
 * Records money received for a web order before it's a sale (deposit, full payment up front, or the
 * balance on collection). Capped at what's still owed — the payments are carried onto the sale when
 * the order is completed, so they must never add up to more than its total.
 */
export function RecordPaymentModal({
  order,
  open,
  currency,
  onClose,
  onRecorded
}: {
  order: OnlineOrder;
  open: boolean;
  currency: string;
  onClose: () => void;
  onRecorded: (updated: OnlineOrder) => void;
}): React.JSX.Element {
  const methods = useActivePaymentMethods(open);
  const [methodId, setMethodId] = useState("");
  // Raw text, exactly as typed — only converted to cents on submit (this app's money-input rule).
  const [amountText, setAmountText] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMethodId("");
    setAmountText((order.balanceCents / 100).toFixed(2));
    setReference("");
    setNotes("");
    setError(null);
  }, [open, order.id, order.balanceCents]);

  const method = useMemo(() => methods.find((m) => m.id === methodId) ?? null, [methods, methodId]);
  const money = (cents: number) => `${currency} ${formatCents(cents)}`.trim();

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const amountCents = amountText.trim() ? toCents(amountText) : 0;
    if (!methodId) return setError("Choose how the customer paid.");
    if (!amountCents || amountCents <= 0) return setError("Enter the amount received.");
    if (amountCents > order.balanceCents) return setError(`Only ${money(order.balanceCents)} is still owed.`);
    if (method?.requiresReference && !reference.trim()) {
      return setError(`${method.name} needs a reference (e.g. the M-Pesa code).`);
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await window.blueLedger.onlineOrders.addPayment({
        orderId: order.id,
        paymentMethodId: methodId,
        amountCents,
        reference: reference.trim() || null,
        notes: notes.trim() || null
      });
      onRecorded(updated);
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't record the payment"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Record payment — ${order.orderNumber}`}
      description="Money received for this order. It's carried onto the sale when you complete the order."
      widthClassName="max-w-md"
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
        )}

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-line bg-soft/60 p-3 text-center">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Total</p>
            <p className="text-sm font-extrabold tabular-nums text-ink">{money(order.totalCents)}</p>
          </div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Paid</p>
            <p className="text-sm font-extrabold tabular-nums text-success">{money(order.paidCents)}</p>
          </div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Balance</p>
            <p className="text-sm font-extrabold tabular-nums text-danger">{money(order.balanceCents)}</p>
          </div>
        </div>

        <SelectField
          label="Payment Method"
          value={methodId}
          onChange={setMethodId}
          options={[{ value: "", label: "Select payment method" }, ...methods.map((m) => ({ value: m.id, label: m.name }))]}
        />
        <Field label="Amount received" value={amountText} onChange={setAmountText} placeholder={formatCents(order.balanceCents)} />
        {method?.requiresReference && (
          <Field label="Reference" value={reference} onChange={setReference} placeholder="e.g. M-Pesa code" required />
        )}
        <Field label="Note (optional)" value={notes} onChange={setNotes} placeholder="e.g. deposit" maxLength={500} />

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" onClick={onClose} className="border border-line bg-white text-ink shadow-none hover:bg-soft">
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="gap-2 bg-success">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wallet className="size-4" aria-hidden="true" />}
            Record payment
          </Button>
        </div>
      </form>
    </Modal>
  );
}
