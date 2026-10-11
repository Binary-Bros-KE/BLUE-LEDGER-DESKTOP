import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  History,
  Loader2,
  Lock,
  MessageCircle,
  Package,
  Receipt,
  RotateCcw,
  StickyNote,
  Trash2,
  Undo2,
  Wallet,
  XCircle
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { useConfirm } from "@renderer/shared/components/ConfirmModal";
import { ProductThumbnail } from "@renderer/shared/components/ProductThumbnail";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type {
  OnlineOrder,
  OnlineOrderHistoryEntry,
  OnlineOrderItem,
  OnlineOrderPayment,
  OnlineOrderStatus
} from "@shared/types/online-store";
import { CompleteOrderModal } from "./CompleteOrderModal";
import { FulfilmentCards } from "./FulfilmentCards";
import { HoldStorefrontModal } from "./HoldStorefrontModal";
import { OrderDocumentsModal, type OrderDocument } from "./OrderDocumentsModal";
import type { OrderMessageRequest } from "./OrderMessageModal";
import { RecordPaymentModal } from "./RecordPaymentModal";
import { ShipOrderModal } from "./ShipOrderModal";
import {
  ADVANCE_LABEL,
  MESSAGE_SUBJECT,
  PAYMENT_LABEL,
  PAYMENT_PILL,
  STATUS_LABEL,
  STATUS_PILL,
  buildOrderMessage,
  canCancel,
  flowOf,
  isHandedOver,
  isOpen,
  nextStatus,
  paymentState,
  previousStatus,
  routeOf,
  stageHint,
  type OrderMessageKind
} from "./order-flow";

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const SectionLabel = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">{children}</p>
);

/** The selected web order: its steps, route, customer, items, payments and history, with the one
 * next action it allows. Every change can be followed by a WhatsApp/email update to the customer. */
export function OrderDetail({
  order,
  currency,
  businessName,
  canEdit,
  canSell,
  onChanged,
  onMessage
}: {
  order: OnlineOrder;
  currency: string;
  businessName: string;
  canEdit: boolean;
  canSell: boolean;
  /** an update came back from the server (or the order became a sale) — show it + refresh the list */
  onChanged: (updated: OnlineOrder) => void;
  /** offer to send the customer an update — owned by the route, so it survives the order leaving the tab */
  onMessage: (request: OrderMessageRequest) => void;
}): React.JSX.Element {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState<OrderDocument | null>(null);
  const [holdPickOpen, setHoldPickOpen] = useState(false);
  const [holdStorefrontId, setHoldStorefrontId] = useState<string | null>(null);
  const [holdBranchName, setHoldBranchName] = useState<string | null>(null);
  const { session } = usePermissions();

  const holdLocationId = order.stockHold?.locationId ?? null;
  useEffect(() => {
    setHoldBranchName(null);
    if (!holdLocationId) return;
    let cancelled = false;
    void window.blueLedger.location
      .get(holdLocationId)
      .then((loc) => {
        if (!cancelled) setHoldBranchName(loc?.locationName ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [holdLocationId]);

  useEffect(() => {
    setPaymentOpen(false);
    setShipOpen(false);
    setCompleteOpen(false);
    setDocumentOpen(null);
  }, [order.id]);

  const money = (cents: number): string => `${currency} ${formatCents(cents)}`.trim();

  function offerMessage(updated: OnlineOrder, kind: OrderMessageKind, extra?: { payment?: OnlineOrderPayment | null; receiptNumber?: string | null }): void {
    onMessage({
      order: updated,
      heading: kind === "PAYMENT" ? "Payment recorded" : `Order ${STATUS_LABEL[kind].toLowerCase()}`,
      subject: MESSAGE_SUBJECT[kind],
      text: buildOrderMessage(updated, kind, { businessName, money, ...extra })
    });
  }

  async function moveTo(
    status: OnlineOrderStatus,
    opts?: { riderId?: string | null; tell?: boolean; storefrontId?: string }
  ): Promise<void> {
    setBusy(true);
    try {
      const updated = await window.blueLedger.onlineOrders.setStatus({
        id: order.id,
        status,
        riderId: opts?.riderId ?? null,
        storefrontId: opts?.storefrontId ?? holdStorefrontId
      });
      showSuccessToast(`${order.orderNumber} — ${STATUS_LABEL[status].toLowerCase()}`);
      setShipOpen(false);
      setHoldPickOpen(false);
      onChanged(updated);
      if (opts?.tell !== false) offerMessage(updated, status);
    } catch (err) {
      // e.g. 'Insufficient stock for "X" at Branch. Available: 0, requested: 2' — confirming holds stock
      showErrorToast(getErrorMessage(err, "Couldn't update the order"));
    } finally {
      setBusy(false);
    }
  }

  // Moving past pending holds the order's stock at a branch: the user's own, else the store's
  // fulfilment branch — a branch-less user on a store without one picks it first.
  const needsHoldBranch = !order.stockHold && !session?.branch && !order.fulfilmentLocationId;

  async function advance(): Promise<void> {
    const next = nextStatus(order);
    if (!next) return;
    if (needsHoldBranch && !holdStorefrontId) {
      setHoldPickOpen(true);
      return;
    }
    if (next === "SHIPPED") {
      setShipOpen(true);
      return;
    }
    await moveTo(next);
  }

  async function undo(): Promise<void> {
    const prev = previousStatus(order);
    if (!prev) return;
    const ok = await confirm({
      title: `Move ${order.orderNumber} back?`,
      message: `It goes back to "${STATUS_LABEL[prev]}". Use this to fix a step marked by mistake.${
        prev === "NEW" && order.stockHold ? " The held stock goes back on the shelf." : ""
      }`,
      tone: "primary",
      confirmLabel: "Move back",
      cancelLabel: "Keep it"
    });
    if (ok) await moveTo(prev, { tell: false });
  }

  async function cancel(): Promise<void> {
    const ok = await confirm({
      title: `Cancel ${order.orderNumber}?`,
      message:
        order.paidCents > 0
          ? `${order.stockHold ? "The held stock goes back on the shelf. " : ""}${money(order.paidCents)} was paid on this order — refund the customer yourself; cancelling doesn't move money. You can message ${order.customerName} next.`
          : `${order.stockHold ? "The held stock goes back on the shelf. " : ""}You can message ${order.customerName} about it next.`,
      tone: "danger",
      confirmLabel: "Cancel order",
      cancelLabel: "Keep order"
    });
    if (ok) await moveTo("CANCELLED");
  }

  async function removePayment(p: OnlineOrderPayment): Promise<void> {
    const ok = await confirm({
      title: `Remove ${money(p.amountCents)} payment?`,
      message: `${p.paymentMethodName}${p.reference ? ` (${p.reference})` : ""}, recorded by ${p.receivedByName}. Only do this if it was recorded by mistake or refunded.`,
      tone: "danger",
      confirmLabel: "Remove payment",
      cancelLabel: "Keep"
    });
    if (!ok) return;
    setBusy(true);
    try {
      onChanged(await window.blueLedger.onlineOrders.removePayment(order.id, p.id));
      showSuccessToast("Payment removed");
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't remove the payment"));
    } finally {
      setBusy(false);
    }
  }

  const open = isOpen(order);
  const next = nextStatus(order);
  const prev = previousStatus(order);
  const pay = paymentState(order);
  const completed = order.status === "COMPLETED" || !!order.linkedSaleId;
  const paidPercent = order.totalCents > 0 ? Math.min(100, Math.round((order.paidCents / order.totalCents) * 100)) : 0;

  return (
    <div className="h-fit overflow-hidden rounded-lg border border-line bg-white shadow-soft">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-extrabold text-ink">{order.orderNumber}</h2>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide", STATUS_PILL[order.status])}>
              {STATUS_LABEL[order.status]}
            </span>
            {order.status !== "CANCELLED" && (
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide", PAYMENT_PILL[pay])}>
                {PAYMENT_LABEL[pay]}
              </span>
            )}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
            <Clock className="size-3.5" aria-hidden="true" /> Placed {fullDate(order.createdAt)}
          </p>
          {order.linkedReceiptNumber || order.linkedSaleId ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs font-extrabold text-success">
              <Receipt className="size-3.5" aria-hidden="true" /> Sale receipt {order.linkedReceiptNumber ?? order.linkedSaleId}
            </p>
          ) : null}
        </div>
        <p className="text-right">
          <span className="block text-[10px] font-extrabold uppercase tracking-wide text-muted">Total</span>
          <span className="text-xl font-extrabold tabular-nums text-ink">{money(order.totalCents)}</span>
        </p>
      </div>

      {/* stepper */}
      <Stepper order={order} />

      {/* fulfilment */}
      <div className="border-b border-line p-5">
        <FulfilmentCards order={order} editable={canEdit} money={money} onChanged={(u) => onChanged(u)} />
      </div>

      {/* customer */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
        <div>
          <SectionLabel>Customer</SectionLabel>
          <p className="mt-1 text-sm font-extrabold text-ink">{order.customerName}</p>
          <p className="text-sm font-semibold text-ink">{order.customerPhone}</p>
          {order.customerEmail && <p className="text-xs font-semibold text-muted">{order.customerEmail}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => offerMessage(order, completed ? "COMPLETED" : order.status)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-success px-3 text-[11px] font-extrabold uppercase tracking-wide text-white hover:brightness-110 cursor-pointer"
          >
            <MessageCircle className="size-3.5" aria-hidden="true" /> Message
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(order.customerPhone)
                .then(() => showSuccessToast("Phone number copied"))
                .catch(() => showErrorToast("Couldn't copy"));
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-[11px] font-extrabold uppercase tracking-wide text-ink hover:bg-soft cursor-pointer"
          >
            <Copy className="size-3.5" aria-hidden="true" /> Copy phone
          </button>
        </div>
      </div>

      {order.notes && (
        <div className="flex gap-2 border-b border-line bg-soft/60 px-5 py-3">
          <StickyNote className="mt-0.5 size-4 flex-none text-muted" aria-hidden="true" />
          <p className="whitespace-pre-line text-sm font-semibold text-ink">{order.notes}</p>
        </div>
      )}

      {/* items */}
      <div className="border-b border-line p-5">
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>Items ({order.items.reduce((s, it) => s + it.qty, 0)})</SectionLabel>
          {order.stockHold ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-extrabold text-accent">
              <Lock className="size-3" aria-hidden="true" /> Stock held{holdBranchName ? ` at ${holdBranchName}` : ""}
            </span>
          ) : order.status === "NEW" ? (
            <span className="text-[10px] font-bold text-muted">Stock is held when you confirm</span>
          ) : null}
        </div>
        <div className="space-y-2.5">
          {order.items.map((it, index) => (
            <ItemCard key={`${it.productId}-${it.variantKey ?? index}`} item={it} money={money} />
          ))}
        </div>
        <div className="mt-4 space-y-1 rounded-lg bg-soft/60 p-3 text-sm">
          <div className="flex justify-between font-semibold text-muted">
            <span>Subtotal</span>
            <span className="tabular-nums">{money(order.subtotalCents)}</span>
          </div>
          <div className="flex justify-between font-semibold text-muted">
            <span>{routeOf(order) === "pickup" ? "Pick up" : `Delivery${order.deliveryMethodName ? ` — ${order.deliveryMethodName}` : ""}`}</span>
            <span className="tabular-nums">{routeOf(order) === "pickup" ? "Free" : money(order.deliveryFeeCents)}</span>
          </div>
          <div className="flex justify-between border-t border-dashed border-line pt-1 text-base font-extrabold text-ink">
            <span>Total</span>
            <span className="tabular-nums">{money(order.totalCents)}</span>
          </div>
        </div>
      </div>

      {/* payments */}
      {order.status !== "CANCELLED" || order.payments.length > 0 ? (
        <div className="border-b border-line p-5">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>Payments</SectionLabel>
            {canEdit && open && order.balanceCents > 0 && (
              <Button onClick={() => setPaymentOpen(true)} disabled={busy} className="h-8 gap-1.5 bg-success px-3 text-xs">
                <Wallet className="size-3.5" aria-hidden="true" /> Record payment
              </Button>
            )}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-soft">
            <div className={cn("h-full rounded-full transition-all", pay === "paid" ? "bg-success" : "bg-warning")} style={{ width: `${paidPercent}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs font-bold">
            <span className="text-success">Paid {money(order.paidCents)}</span>
            <span className={order.balanceCents > 0 ? "text-danger" : "text-success"}>
              {order.balanceCents > 0 ? `Balance ${money(order.balanceCents)}` : "Fully paid"}
            </span>
          </div>
          {order.payments.length === 0 ? (
            <p className="mt-3 text-xs font-semibold text-muted">
              Nothing paid yet. Record deposits or payments as they come in — they go onto the sale when you complete the order.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {order.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="grid size-8 flex-none place-items-center rounded-full bg-success/10 text-success">
                    <Wallet className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-extrabold text-ink">
                      {p.paymentMethodName}
                      {p.reference && <span className="ml-1.5 font-mono text-xs font-bold text-muted">{p.reference}</span>}
                    </span>
                    <span className="block text-[11px] font-semibold text-muted">
                      {fullDate(p.receivedAt)} · {p.receivedByName}
                      {p.notes ? ` · ${p.notes}` : ""}
                    </span>
                  </span>
                  <span className="text-sm font-extrabold tabular-nums text-ink">{money(p.amountCents)}</span>
                  {canEdit && open && (
                    <button
                      type="button"
                      onClick={() => void removePayment(p)}
                      disabled={busy}
                      title="Remove payment"
                      className="grid size-7 place-items-center rounded-md text-muted hover:bg-danger-soft hover:text-danger cursor-pointer"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">Remove payment</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* history */}
      <HistoryList order={order} money={money} />

      {/* actions */}
      <div className="sticky bottom-0 border-t border-line bg-white p-4">
        <p className="mb-3 text-xs font-semibold text-muted">{stageHint(order)}</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canEdit && canCancel(order) && (
            <Button
              onClick={() => void cancel()}
              disabled={busy}
              className="mr-auto gap-1.5 border border-danger bg-white text-danger shadow-none hover:bg-danger hover:text-white"
            >
              <XCircle className="size-4" aria-hidden="true" /> Cancel order
            </Button>
          )}
          {canEdit && open && prev && (
            <Button
              onClick={() => void undo()}
              disabled={busy}
              className="gap-1.5 border border-line bg-white text-ink shadow-none hover:bg-soft"
              title={`Back to ${STATUS_LABEL[prev]}`}
            >
              <Undo2 className="size-4" aria-hidden="true" /> Undo step
            </Button>
          )}
          {canEdit && open && next && (
            <Button onClick={() => void advance()} disabled={busy} className="gap-2 bg-primary">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
              {ADVANCE_LABEL[next] ?? STATUS_LABEL[next]}
            </Button>
          )}
          {canEdit && open && isHandedOver(order) && (
            <Button
              onClick={() => setCompleteOpen(true)}
              disabled={busy || !canSell}
              title={canSell ? undefined : "You need permission to make sales"}
              className="gap-2 bg-success"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" /> Complete order
            </Button>
          )}
          {canEdit && order.status === "CANCELLED" && !order.linkedSaleId && (
            <Button
              onClick={() => void moveTo("NEW", { tell: false })}
              disabled={busy}
              className="gap-2 border border-line bg-white text-ink shadow-none hover:bg-soft"
            >
              <RotateCcw className="size-4" aria-hidden="true" /> Reopen
            </Button>
          )}
          {order.linkedSaleId && (
            <>
              {routeOf(order) === "delivery" && (
                <Button
                  onClick={() => setDocumentOpen("delivery")}
                  className="gap-2 border border-line bg-white text-ink shadow-none hover:bg-soft"
                >
                  <FileText className="size-4" aria-hidden="true" /> Delivery note
                </Button>
              )}
              <Button onClick={() => setDocumentOpen("receipt")} className="gap-2 bg-primary">
                <Receipt className="size-4" aria-hidden="true" /> View receipt
              </Button>
            </>
          )}
        </div>
      </div>

      <RecordPaymentModal
        order={order}
        open={paymentOpen}
        currency={currency}
        onClose={() => setPaymentOpen(false)}
        onRecorded={(updated) => {
          setPaymentOpen(false);
          showSuccessToast("Payment recorded");
          onChanged(updated);
          offerMessage(updated, "PAYMENT", { payment: updated.payments[updated.payments.length - 1] ?? null });
        }}
      />
      <ShipOrderModal
        order={order}
        open={shipOpen}
        busy={busy}
        onClose={() => setShipOpen(false)}
        onShip={(riderId) => void moveTo("SHIPPED", { riderId })}
      />
      <CompleteOrderModal
        order={order}
        open={completeOpen}
        currency={currency}
        onClose={() => setCompleteOpen(false)}
        onDone={(result) => {
          setCompleteOpen(false);
          showSuccessToast(
            `${order.orderNumber} completed — receipt ${result.receiptNumber ?? result.saleId}${
              result.deliveryNoteNumber ? `, delivery note ${result.deliveryNoteNumber}` : ""
            }`
          );
          if (result.linkWarning) showErrorToast(result.linkWarning);
          const done: OnlineOrder = {
            ...order,
            status: "COMPLETED",
            linkedSaleId: result.saleId,
            linkedReceiptNumber: result.receiptNumber,
            paidCents: order.totalCents,
            balanceCents: 0
          };
          onChanged(done);
          offerMessage(done, "COMPLETED", { receiptNumber: result.receiptNumber });
        }}
      />
      <OrderDocumentsModal order={order} document={documentOpen} onClose={() => setDocumentOpen(null)} />
      <HoldStorefrontModal
        order={order}
        open={holdPickOpen}
        busy={busy}
        onClose={() => setHoldPickOpen(false)}
        onChoose={(storefrontId) => {
          setHoldStorefrontId(storefrontId);
          setHoldPickOpen(false);
          // state lands next render — continue with the chosen branch explicitly
          const next = nextStatus(order);
          if (next === "SHIPPED") setShipOpen(true);
          else if (next) void moveTo(next, { storefrontId });
        }}
      />
    </div>
  );
}

function Stepper({ order }: { order: OnlineOrder }): React.JSX.Element {
  const steps: OnlineOrderStatus[] = [...flowOf(order), "COMPLETED"];
  const cancelled = order.status === "CANCELLED";
  const current = order.linkedSaleId ? steps.length - 1 : steps.indexOf(order.status);

  return (
    <div className={cn("border-b border-line px-5 py-4", cancelled && "bg-soft/60")}>
      {cancelled && (
        <p className="mb-3 flex items-center gap-1.5 text-xs font-extrabold text-danger">
          <XCircle className="size-3.5" aria-hidden="true" /> Cancelled — steps below are paused
        </p>
      )}
      <ol className="flex items-start">
        {steps.map((step, i) => {
          const done = !cancelled && (i < current || (i === current && step === "COMPLETED"));
          const active = !cancelled && i === current && step !== "COMPLETED";
          return (
            <li key={step} className="relative flex flex-1 flex-col items-center text-center">
              {i > 0 && (
                <span
                  className={cn(
                    "absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2",
                    !cancelled && i <= current ? "bg-success" : "bg-line"
                  )}
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  "relative z-10 grid size-7 place-items-center rounded-full border-2 text-[11px] font-extrabold",
                  done && "border-success bg-success text-white",
                  active && "border-primary bg-primary text-white ring-4 ring-primary/15",
                  !done && !active && "border-line bg-white text-muted"
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : i + 1}
              </span>
              <span
                className={cn(
                  "mt-1.5 px-1 text-[10px] font-extrabold uppercase leading-tight tracking-wide",
                  active ? "text-primary" : done ? "text-success" : "text-muted"
                )}
              >
                {STATUS_LABEL[step]}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ItemCard({ item, money }: { item: OnlineOrderItem; money: (cents: number) => string }): React.JSX.Element {
  const baseName = item.variantLabel && item.name.endsWith(` — ${item.variantLabel}`)
    ? item.name.slice(0, -(` — ${item.variantLabel}`).length)
    : item.name;
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-line bg-white p-2.5 transition hover:border-ink/30">
      <div className="relative">
        {item.imageUrl ? (
          <div className="size-16 flex-none overflow-hidden rounded-lg border border-line bg-soft">
            <img src={item.imageUrl} alt="" className="size-full object-cover" />
          </div>
        ) : item.imagePath ? (
          <ProductThumbnail imagePath={item.imagePath} className="size-16" />
        ) : (
          <div className="grid size-16 flex-none place-items-center rounded-lg border border-line bg-soft">
            <Package className="size-6 text-muted" aria-hidden="true" />
          </div>
        )}
        <span className="absolute -right-2 -top-2 grid h-6 min-w-6 place-items-center rounded-full bg-ink px-1.5 text-[11px] font-extrabold tabular-nums text-white shadow-soft">
          {item.qty}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold leading-snug text-ink">{baseName}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {item.variantLabel && (
            <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-extrabold text-accent">{item.variantLabel}</span>
          )}
          {item.sku && <span className="font-mono text-[10px] font-bold text-muted">{item.sku}</span>}
        </div>
        <p className="mt-1 text-xs font-semibold text-muted tabular-nums">
          {money(item.unitPriceCents)} × {item.qty} {item.qty === 1 ? "pc" : "pcs"}
        </p>
      </div>
      <p className="flex-none text-right">
        <span className="block text-[10px] font-extrabold uppercase tracking-wide text-muted">Qty {item.qty}</span>
        <span className="text-sm font-extrabold tabular-nums text-ink">{money(item.lineTotalCents)}</span>
      </p>
    </div>
  );
}

function historyText(entry: OnlineOrderHistoryEntry, money: (cents: number) => string): string {
  switch (entry.kind) {
    case "status": {
      const label = STATUS_LABEL[entry.status as OnlineOrderStatus] ?? entry.status ?? "Updated";
      if (entry.status === "COMPLETED") return `Completed as sale${entry.receipt ? ` ${entry.receipt}` : ""}`;
      if (entry.status === "NEW") return "Moved to pending";
      return `${label}${entry.rider ? ` — rider ${entry.rider}` : ""}`;
    }
    case "payment":
      return `Payment ${money(entry.amountCents ?? 0)} · ${entry.method ?? ""}`;
    case "payment_removed":
      return `Payment removed ${money(entry.amountCents ?? 0)} · ${entry.method ?? ""}`;
    case "fulfilment":
      return entry.status === "pickup" ? "Switched to pick up from shop" : `Switched to delivery${entry.method ? ` — ${entry.method}` : ""}`;
  }
}

function HistoryList({ order, money }: { order: OnlineOrder; money: (cents: number) => string }): React.JSX.Element {
  const entries = [...order.history].reverse();
  return (
    <details className="group border-b border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 hover:bg-soft/50">
        <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-muted">
          <History className="size-3.5" aria-hidden="true" /> History ({entries.length + 1})
        </span>
        <span className="text-[11px] font-bold text-muted group-open:hidden">Show</span>
        <span className="hidden text-[11px] font-bold text-muted group-open:inline">Hide</span>
      </summary>
      <ol className="space-y-2 px-5 pb-4">
        {entries.map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex gap-2.5 text-xs">
            <span className="mt-1 size-2 flex-none rounded-full bg-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="font-extrabold text-ink">{historyText(e, money)}</span>
              <span className="block font-semibold text-muted">
                {fullDate(e.at)}
                {e.by ? ` · ${e.by}` : ""}
              </span>
            </span>
          </li>
        ))}
        <li className="flex gap-2.5 text-xs">
          <span className="mt-1 size-2 flex-none rounded-full bg-line" aria-hidden="true" />
          <span>
            <span className="font-extrabold text-ink">Placed on the website</span>
            <span className="block font-semibold text-muted">{fullDate(order.createdAt)}</span>
          </span>
        </li>
      </ol>
    </details>
  );
}
