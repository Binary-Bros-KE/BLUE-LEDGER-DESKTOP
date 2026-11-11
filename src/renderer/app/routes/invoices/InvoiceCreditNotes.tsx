import { useCallback, useEffect, useMemo, useState } from "react";
import { FileMinus2, Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { CreditNoteModal } from "@renderer/shared/components/CreditNoteModal";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { Sale } from "@shared/types/sale";
import type { SaleReturn } from "@shared/types/sale-return";

/**
 * Credit notes on one invoice (client spec, instead of editing it): take some quantity of a line, or a
 * whole line, off the invoice. It's requested here and approved in Approvals; on approval the stock
 * goes back, what's owed comes down first and only the rest is refunded. Works on paid invoices too.
 */
export function InvoiceCreditNotes({
  invoice,
  canRequest,
  onChanged
}: {
  invoice: Sale;
  canRequest: boolean;
  /** After a request: the invoice view reloads (its balance and status may change on approval). */
  onChanged: () => void;
}): React.JSX.Element | null {
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openReturnId, setOpenReturnId] = useState<string | null>(null);

  const load = useCallback(() => {
    window.blueLedger.saleReturn
      .list()
      .then((all) => setReturns(all.filter((entry) => entry.saleId === invoice.id)))
      .catch(() => setReturns([]));
  }, [invoice.id]);

  useEffect(load, [load]);

  const remainingBySaleItem = useMemo(() => {
    const credited = new Map<string, number>();
    for (const entry of returns) {
      if (entry.status !== "approved") continue;
      for (const item of entry.items) credited.set(item.saleItemId, (credited.get(item.saleItemId) ?? 0) + item.quantity);
    }
    return new Map(invoice.items.map((item) => [item.id, item.quantity - (credited.get(item.id) ?? 0)]));
  }, [returns, invoice.items]);

  const lines = invoice.items
    .map((item) => ({ item, remaining: remainingBySaleItem.get(item.id) ?? 0, quantity: Number(quantities[item.id] ?? 0) || 0 }))
    .filter((line) => line.remaining > 0);
  const creditCents = lines.reduce((sum, line) => sum + Math.round(line.item.unitPriceCents * Math.min(line.quantity, line.remaining)), 0);
  const visible = returns.filter((entry) => entry.status !== "rejected");
  const allowed = canRequest && invoice.paymentStatus !== "cancelled";

  if (!allowed && visible.length === 0) return null;

  async function submit(): Promise<void> {
    const items = lines.filter((line) => line.quantity > 0).map((line) => ({ saleItemId: line.item.id, quantity: line.quantity }));
    if (items.length === 0) return setError("Enter the quantity to credit for at least one line.");
    if (lines.some((line) => line.quantity > line.remaining)) return setError("A line can't be credited for more than is left on it.");
    if (!reason.trim()) return setError("Give a reason for the credit note.");
    setSaving(true);
    setError(null);
    try {
      await window.blueLedger.saleReturn.request({ saleId: invoice.id, items, reason: reason.trim(), notes: null });
      showSuccessToast("Credit note sent for approval");
      setRequesting(false);
      setQuantities({});
      setReason("");
      load();
      onChanged();
    } catch (err) {
      const message = getErrorMessage(err, "Couldn't request the credit note");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Credit Notes</p>
        {allowed && lines.length > 0 && (
          <Button type="button" onClick={() => setRequesting(true)} className="h-8 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft">
            <FileMinus2 className="mr-1 size-3.5" aria-hidden="true" />
            Credit Note
          </Button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="mt-1.5 text-[11px] font-semibold text-muted">Take items off this invoice — even after it's paid — instead of editing it.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {visible.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-2 rounded-md bg-soft px-2.5 py-1.5 text-xs">
              <div className="min-w-0">
                <p className="truncate font-bold text-ink">
                  {entry.creditNoteNumber ?? "Awaiting approval"} · {entry.items.map((item) => `${item.quantity} × ${item.productName}`).join(", ")}
                </p>
                <p className="text-[11px] font-semibold text-muted">
                  {formatCents(entry.items.reduce((sum, item) => sum + item.lineTotalCents, 0))}
                  {entry.status === "approved" && entry.refundCents ? ` · ${formatCents(entry.refundCents)} refunded` : ""}
                </p>
              </div>
              {entry.status === "approved" ? (
                <Button type="button" onClick={() => setOpenReturnId(entry.id)} className="h-7 flex-none border border-line bg-white px-2 text-[11px] text-ink shadow-none hover:bg-white">
                  View
                </Button>
              ) : (
                <DashedPill tone="warning">Pending</DashedPill>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={requesting}
        onClose={() => setRequesting(false)}
        title={`Credit Note — ${invoice.invoiceNumber ?? "Invoice"}`}
        description="Choose what comes off the invoice. Stock goes back when it's approved; what's still owed comes down first and only the rest is refunded."
        widthClassName="max-w-xl"
      >
        <div className="space-y-3">
          {error && <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>}
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {lines.map(({ item, remaining }) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{item.productName}</p>
                  <p className="text-[11px] font-semibold text-muted">
                    {remaining} of {item.quantity} left · {formatCents(item.unitPriceCents)} each
                  </p>
                </div>
                <div className="flex flex-none items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={remaining}
                    value={quantities[item.id] ?? ""}
                    onChange={(event) => setQuantities((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    placeholder="0"
                    className="h-8 w-20 rounded-md border border-line px-2 text-right text-xs font-bold outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantities((prev) => ({ ...prev, [item.id]: String(remaining) }))}
                    className="text-[10px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
                  >
                    All
                  </button>
                </div>
              </div>
            ))}
          </div>
          <TextAreaField label="Reason" value={reason} onChange={setReason} rows={2} placeholder="e.g. Damaged items returned" />
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <p className="text-sm font-extrabold text-ink">Credit {formatCents(creditCents)}</p>
            <Button type="button" onClick={() => void submit()} disabled={saving} className="h-9 text-xs">
              {saving && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
              Send for Approval
            </Button>
          </div>
        </div>
      </Modal>

      <CreditNoteModal returnId={openReturnId} onClose={() => setOpenReturnId(null)} />
    </div>
  );
}
