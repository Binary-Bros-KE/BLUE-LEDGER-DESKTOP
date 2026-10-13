import { useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Package, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import type { OnlineOrder } from "@shared/types/online-store";

type Line = { key: string; productId: string; variantKey: string | null; name: string; unitPriceCents: number; was: number; qty: number };

const lineKey = (productId: string, variantKey: string | null | undefined): string => `${productId}|${variantKey ?? ""}`;

/**
 * Change quantities or remove lines — e.g. the shop can only get 12 of the 50 ordered. Prices stay
 * as ordered; new items can't be added. Only offered while the order is pending/confirmed and has no
 * payment (SERVER enforces the same). A confirmed order's held stock is adjusted to match.
 */
export function EditItemsModal({
  order,
  open,
  money,
  onClose,
  onSaved
}: {
  order: OnlineOrder;
  open: boolean;
  money: (cents: number) => string;
  onClose: () => void;
  onSaved: (updated: OnlineOrder, summary: string[]) => void;
}): React.JSX.Element {
  const [lines, setLines] = useState<Line[]>([]);
  // Raw qty text per line while typing, so the field can be emptied before a new number goes in.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLines(
      order.items.map((it) => ({
        key: lineKey(it.productId, it.variantKey),
        productId: it.productId,
        variantKey: it.variantKey ?? null,
        name: it.name,
        unitPriceCents: it.unitPriceCents,
        was: it.qty,
        qty: it.qty
      }))
    );
    setDrafts({});
    setError(null);
  }, [open, order]);

  const kept = lines.filter((l) => l.qty > 0);
  const subtotal = kept.reduce((s, l) => s + l.unitPriceCents * l.qty, 0);
  const total = subtotal + order.deliveryFeeCents;
  const changes = useMemo(
    () =>
      lines.flatMap((l) =>
        l.qty === 0 ? [`Removed ${l.name}`] : l.qty !== l.was ? [`${l.name}: ${l.was} → ${l.qty}`] : []
      ),
    [lines]
  );

  function setQty(key: string, qty: number): void {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, qty: Math.max(0, Math.min(999, qty)) } : l)));
  }

  async function save(): Promise<void> {
    if (kept.length === 0) return setError("An order needs at least one item — cancel the order instead.");
    if (changes.length === 0) return onClose();
    setSaving(true);
    setError(null);
    try {
      const updated = await window.blueLedger.onlineOrders.editItems({
        orderId: order.id,
        items: kept.map((l) => ({ productId: l.productId, variantKey: l.variantKey, qty: l.qty }))
      });
      onSaved(updated, changes);
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't update the items"));
    } finally {
      setSaving(false);
    }
  }

  const imageFor = (productId: string, variantKey: string | null): string | null =>
    order.items.find((it) => lineKey(it.productId, it.variantKey) === lineKey(productId, variantKey))?.imageUrl ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit items — ${order.orderNumber}`}
      description="Change quantities or remove items. Prices stay as ordered."
      widthClassName="max-w-xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
        )}

        <ul className="space-y-2">
          {lines.map((l) => {
            const removed = l.qty === 0;
            const image = imageFor(l.productId, l.variantKey);
            return (
              <li
                key={l.key}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-2.5 transition",
                  removed ? "border-dashed border-line bg-soft/50 opacity-60" : l.qty !== l.was ? "border-accent/50 bg-accent/[0.04]" : "border-line"
                )}
              >
                <div className="grid size-12 flex-none place-items-center overflow-hidden rounded-lg border border-line bg-soft">
                  {image ? <img src={image} alt="" className="size-full object-cover" /> : <Package className="size-5 text-muted" aria-hidden="true" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-extrabold leading-snug text-ink", removed && "line-through")}>{l.name}</p>
                  <p className="text-xs font-semibold text-muted tabular-nums">
                    {money(l.unitPriceCents)} each{l.qty !== l.was && !removed ? ` · was ${l.was}` : ""}
                  </p>
                </div>
                {removed ? (
                  <Button
                    type="button"
                    onClick={() => setQty(l.key, l.was)}
                    className="h-8 gap-1.5 border border-line bg-white px-2.5 text-xs text-ink shadow-none hover:bg-soft"
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" /> Undo
                  </Button>
                ) : (
                  <>
                    <div className="flex items-center rounded-lg border border-line">
                      <button
                        type="button"
                        onClick={() => setQty(l.key, l.qty - 1)}
                        disabled={l.qty <= 1}
                        className="grid size-8 place-items-center text-ink hover:bg-soft disabled:opacity-30 cursor-pointer"
                      >
                        <Minus className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">Less</span>
                      </button>
                      <input
                        inputMode="numeric"
                        value={drafts[l.key] ?? String(l.qty)}
                        onChange={(e) => {
                          const text = e.target.value.replace(/\D/g, "").slice(0, 3);
                          setDrafts((d) => ({ ...d, [l.key]: text }));
                          if (text) setQty(l.key, Math.max(1, Number(text)));
                        }}
                        onBlur={() =>
                          setDrafts((d) => {
                            const { [l.key]: _typed, ...rest } = d;
                            return rest;
                          })
                        }
                        className="w-12 border-x border-line py-1.5 text-center text-sm font-extrabold tabular-nums outline-none"
                        aria-label={`Quantity of ${l.name}`}
                      />
                      <button
                        type="button"
                        onClick={() => setQty(l.key, l.qty + 1)}
                        disabled={l.qty >= 999}
                        className="grid size-8 place-items-center text-ink hover:bg-soft disabled:opacity-30 cursor-pointer"
                      >
                        <Plus className="size-3.5" aria-hidden="true" />
                        <span className="sr-only">More</span>
                      </button>
                    </div>
                    <span className="w-24 text-right text-sm font-extrabold tabular-nums text-ink">{money(l.unitPriceCents * l.qty)}</span>
                    <button
                      type="button"
                      onClick={() => setQty(l.key, 0)}
                      title="Remove item"
                      className="grid size-8 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger cursor-pointer"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      <span className="sr-only">Remove {l.name}</span>
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        <div className="space-y-1 rounded-lg bg-soft/60 p-3 text-sm">
          <div className="flex justify-between font-semibold text-muted">
            <span>Was</span>
            <span className="tabular-nums line-through">{money(order.totalCents)}</span>
          </div>
          <div className="flex justify-between text-base font-extrabold text-ink">
            <span>New total{order.deliveryFeeCents > 0 ? " (incl. delivery)" : ""}</span>
            <span className="tabular-nums">{money(total)}</span>
          </div>
        </div>

        {order.stockHold && changes.length > 0 && (
          <p className="text-xs font-semibold text-muted">The stock held for this order is adjusted to the new quantities.</p>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" onClick={onClose} className="border border-line bg-white text-ink shadow-none hover:bg-soft">
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || changes.length === 0} className="gap-2 bg-primary">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
            Save changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
