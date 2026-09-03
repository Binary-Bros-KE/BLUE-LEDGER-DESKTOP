import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { Ban, CheckCircle2, Loader2, Package, Paperclip, Send, Wallet } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { Field, SelectField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { ExportListRequest } from "@shared/types/export";
import type { PaymentMethod } from "@shared/types/payment-method";
import { TAX_TYPE_OPTIONS } from "@shared/types/product";
import { PURCHASE_STATUS_OPTIONS, type Purchase, type PurchaseItem, type PurchasePaymentStatus, type PurchaseStatus } from "@shared/types/purchase";

function formatDate(value: string | null, pattern = "MMM d, yyyy · HH:mm"): string {
  if (!value) return "—";
  try {
    return format(new Date(value), pattern);
  } catch {
    return value;
  }
}

function statusLabel(status: PurchaseStatus): string {
  return PURCHASE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function statusTone(status: PurchaseStatus): "success" | "warning" | "danger" | "neutral" | "accent" {
  if (status === "received") return "success";
  if (status === "partially_received") return "accent";
  if (status === "ordered") return "warning";
  if (status === "cancelled") return "danger";
  return "neutral";
}

/** Derived from the order's own lines, not a stored header value — a real supplier invoice
 * routinely mixes zero-rated and taxable items (see purchase_items.tax_type, per-line). */
function taxTypeLabel(items: PurchaseItem[]): string {
  const distinctTypes = new Set(items.map((item) => item.taxType));
  if (distinctTypes.size > 1) return "Mixed Tax";
  const [only] = distinctTypes;
  return TAX_TYPE_OPTIONS.find((option) => option.value === only)?.label ?? "—";
}

function paymentStatusTone(status: PurchasePaymentStatus): "success" | "warning" | "neutral" {
  if (status === "paid") return "success";
  if (status === "partially_paid") return "warning";
  return "neutral";
}

export function PurchaseDetailModal({
  purchase,
  paymentMethods,
  canEdit,
  onClose,
  onEdit,
  onChanged
}: {
  purchase: Purchase;
  paymentMethods: PaymentMethod[];
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const { can } = usePermissions();
  const canExport = can("purchases", "export");

  const [receivingQuantities, setReceivingQuantities] = useState<Record<string, string>>({});
  const [receiveSaving, setReceiveSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidMethodId, setMarkPaidMethodId] = useState("");
  const [markPaidReference, setMarkPaidReference] = useState("");
  const [markPaidSaving, setMarkPaidSaving] = useState(false);
  const [markPaidError, setMarkPaidError] = useState<string | null>(null);

  const activePaymentMethods = useMemo(
    () => paymentMethods.filter((method) => method.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [paymentMethods]
  );
  const selectedRecordMethod = activePaymentMethods.find((method) => method.id === paymentMethodId) ?? null;
  const selectedMarkPaidMethod = activePaymentMethods.find((method) => method.id === markPaidMethodId) ?? null;

  const balanceDueCents = purchase.grandTotalCents - purchase.amountPaidCents;
  const canReceive = purchase.status === "ordered" || purchase.status === "partially_received";
  // Mirrors purchase-service.ts's own requireEditablePurchase exactly: a draft is always editable;
  // an "ordered" purchase stays editable right up until either goods start arriving (it would
  // already be partially_received/received by then) or a payment lands against it.
  const canEditPurchase = purchase.status === "draft" || (purchase.status === "ordered" && purchase.amountPaidCents === 0);

  /** One line item can be received across several separate sessions — half today, the rest next
   * week, say — and "before/after" is only ever a truthful pair for ONE specific moment (tried
   * spanning "first session's before" to "latest session's after" in one summary figure; it actively
   * lies the moment something else touches stock in between — see this same file's own git history
   * for the real example). So instead of compressing a product's whole receiving history into one
   * row, EVERY session gets its own nested row directly under that product — full accuracy (each row
   * is exactly what really happened at that moment) AND full visibility (nothing needs a tooltip or a
   * trip to a separate section to see "what happened the first time"), while still naturally staying
   * short for the common case (most lines are received in one session, so most products get zero
   * extra rows). Replaces the old separate "Receiving History" section entirely — same underlying
   * data, just grouped BY PRODUCT (what someone actually wants to trace) instead of by date (which
   * mixed every product touched in one session together, however unrelated).
   *
   * Ordered chronologically per item (purchase.receivingEvents itself is append-only chronological —
   * see appendReceivingEventToPurchaseRow — and this iterates it in that same order), so sessions[0]
   * is always genuinely "the first time," never a guess. */
  const sessionsByItem = useMemo(() => {
    const map = new Map<
      string,
      { receivedAt: string; receivedByName: string; receivingQuantity: number; previousQuantity: number; newQuantity: number }[]
    >();
    for (const event of purchase.receivingEvents) {
      for (const item of event.items) {
        const list = map.get(item.purchaseItemId) ?? [];
        list.push({
          receivedAt: event.receivedAt,
          receivedByName: event.receivedByName,
          receivingQuantity: item.receivingQuantity,
          previousQuantity: item.previousQuantity,
          newQuantity: item.newQuantity
        });
        map.set(item.purchaseItemId, list);
      }
    }
    return map;
  }, [purchase.receivingEvents]);

  /** Same generic ExportListRequest/ExportMenu every list page already uses (Receipts, Invoices,
   * Quotations, the Purchases list itself) — just scoped to this one purchase's own line items
   * instead of a filtered list of documents, so "print a single purchase" gets PDF/Excel/CSV for
   * free instead of a bespoke one-off template. */
  const exportRequest = useMemo<ExportListRequest>(
    () => ({
      module: "purchases",
      title: `Purchase Order ${purchase.purchaseNumber}`,
      subtitle: `${purchase.supplierName} · ${purchase.locationName} · ${statusLabel(purchase.status)}`,
      // One row per (product, receiving session) — same "every session gets its own truthful row"
      // reasoning as sessionsByItem/the modal's own nested rows, just flattened for a spreadsheet.
      // Pricing columns repeat on every session row for a given product (redundant but keeps each
      // row self-contained/sortable on its own, the normal convention for a flat export of
      // parent+child data) rather than only appearing once per product.
      columns: [
        { key: "product", header: "Product" },
        { key: "sku", header: "SKU" },
        { key: "ordered", header: "Ordered Qty", align: "right" },
        { key: "session", header: "Session" },
        { key: "receivedAt", header: "Received At" },
        { key: "receivedBy", header: "Received By" },
        { key: "sessionQty", header: "Qty This Session", align: "right" },
        { key: "stockBefore", header: "Stock Before", align: "right" },
        { key: "stockAfter", header: "Stock After", align: "right" },
        { key: "unitCost", header: "Unit Cost", align: "right" },
        { key: "discount", header: "Discount", align: "right" },
        { key: "tax", header: "Tax", align: "right" },
        { key: "lineTotal", header: "Line Total", align: "right" }
      ],
      rows: purchase.items.flatMap((item) => {
        const sessions = sessionsByItem.get(item.id) ?? [];
        const pricingColumns = {
          product: item.productName,
          sku: item.sku,
          ordered: String(item.orderedQuantity),
          unitCost: formatCents(item.unitCostCents),
          discount: formatCents(item.discountAmountCents),
          tax: formatCents(item.taxAmountCents),
          lineTotal: formatCents(item.lineTotalCents)
        };
        if (sessions.length === 0) {
          return [
            {
              ...pricingColumns,
              session: "—",
              receivedAt: "—",
              receivedBy: "—",
              sessionQty: "—",
              stockBefore: "—",
              stockAfter: "—"
            }
          ];
        }
        return sessions.map((session, index) => ({
          ...pricingColumns,
          session: `${index + 1} of ${sessions.length}`,
          receivedAt: formatDate(session.receivedAt),
          receivedBy: session.receivedByName,
          sessionQty: `+${session.receivingQuantity}`,
          stockBefore: String(session.previousQuantity),
          stockAfter: String(session.newQuantity)
        }));
      }),
      stats: [
        { label: "Supplier Invoice #", value: purchase.supplierInvoiceNumber ?? "—" },
        { label: "Ordered", value: formatDate(purchase.orderedAt) },
        { label: "Received", value: formatDate(purchase.receivedAt) },
        { label: "Subtotal", value: formatCents(purchase.subtotalCents) },
        { label: "Discount", value: formatCents(purchase.discountAmountCents) },
        { label: "Tax", value: formatCents(purchase.taxAmountCents) },
        ...(purchase.shippingCostCents > 0 ? [{ label: "Shipping", value: formatCents(purchase.shippingCostCents) }] : []),
        { label: "Total", value: formatCents(purchase.grandTotalCents) },
        { label: "Amount Paid", value: formatCents(purchase.amountPaidCents) }
      ],
      fileBaseName: `Purchase-${purchase.purchaseNumber}`
    }),
    [purchase, sessionsByItem]
  );

  function updateReceivingQuantity(itemId: string, value: string): void {
    setReceivingQuantities((prev) => ({ ...prev, [itemId]: value }));
  }

  async function submitReceive(quantities: Record<string, string>): Promise<void> {
    setActionError(null);
    const entries = Object.entries(quantities)
      .map(([purchaseItemId, value]) => ({ purchaseItemId, receivingQuantity: Math.floor(Number(value) || 0) }))
      .filter((entry) => entry.receivingQuantity > 0);

    if (entries.length === 0) {
      setActionError("Enter at least one quantity to receive");
      showErrorToast("Enter at least one quantity to receive");
      return;
    }

    setReceiveSaving(true);
    try {
      await window.blueLedger.purchase.receiveGoods(purchase.id, { items: entries });
      showSuccessToast("Goods received");
      setReceivingQuantities({});
      await onChanged();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to receive goods");
      setActionError(message);
      showErrorToast(message);
    } finally {
      setReceiveSaving(false);
    }
  }

  async function handleReceiveGoods(): Promise<void> {
    await submitReceive(receivingQuantities);
  }

  /** Fills every still-outstanding line to its own full remaining quantity AND receives them
   * immediately — one click for the common case of a delivery that arrived complete, instead of the
   * old two-step "fill every row, then scroll down and click Receive Goods separately". */
  async function handleReceiveAll(): Promise<void> {
    const fullQuantities = { ...receivingQuantities };
    for (const item of purchase.items) {
      if (item.remainingQuantity > 0) fullQuantities[item.id] = String(item.remainingQuantity);
    }
    setReceivingQuantities(fullQuantities);
    await submitReceive(fullQuantities);
  }

  async function handleMarkOrdered(): Promise<void> {
    setActionError(null);
    try {
      await window.blueLedger.purchase.markOrdered(purchase.id);
      showSuccessToast("Purchase marked as ordered");
      await onChanged();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to mark as ordered");
      setActionError(message);
      showErrorToast(message);
    }
  }

  async function handleCancel(): Promise<void> {
    if (!window.confirm(`Cancel purchase ${purchase.purchaseNumber}? This can't be undone.`)) return;
    setActionError(null);
    try {
      await window.blueLedger.purchase.cancel(purchase.id);
      showSuccessToast("Purchase cancelled");
      await onChanged();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to cancel purchase");
      setActionError(message);
      showErrorToast(message);
    }
  }

  async function handleOpenAttachment(): Promise<void> {
    if (!purchase.attachmentPath) return;
    try {
      await window.blueLedger.purchase.openAttachment(purchase.attachmentPath);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to open attachment");
      setActionError(message);
      showErrorToast(message);
    }
  }

  function openRecordPayment(): void {
    setPaymentMethodId("");
    setPaymentAmount("");
    setPaymentReference("");
    setPaymentNotes("");
    setPaymentError(null);
    setRecordPaymentOpen(true);
  }

  async function submitRecordPayment(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPaymentSaving(true);
    setPaymentError(null);
    try {
      await window.blueLedger.purchase.recordPayment(purchase.id, {
        paymentMethodId,
        amountCents: toCents(paymentAmount),
        reference: paymentReference,
        notes: paymentNotes
      });
      showSuccessToast("Payment recorded");
      setRecordPaymentOpen(false);
      await onChanged();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to record payment");
      setPaymentError(message);
      showErrorToast(message);
    } finally {
      setPaymentSaving(false);
    }
  }

  function openMarkPaid(): void {
    setMarkPaidMethodId("");
    setMarkPaidReference("");
    setMarkPaidError(null);
    setMarkPaidOpen(true);
  }

  async function submitMarkPaid(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setMarkPaidSaving(true);
    setMarkPaidError(null);
    try {
      await window.blueLedger.purchase.markPaid(purchase.id, {
        paymentMethodId: markPaidMethodId,
        reference: markPaidReference,
        notes: null
      });
      showSuccessToast("Purchase marked as paid");
      setMarkPaidOpen(false);
      await onChanged();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to mark as paid");
      setMarkPaidError(message);
      showErrorToast(message);
    } finally {
      setMarkPaidSaving(false);
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={purchase.purchaseNumber}
        description={`${purchase.supplierName} · ${purchase.locationName}`}
        widthClassName="max-w-5xl"
      >
        {actionError && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {actionError}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <DashedPill tone={statusTone(purchase.status)}>{statusLabel(purchase.status)}</DashedPill>
            <DashedPill tone="accent">{taxTypeLabel(purchase.items)}</DashedPill>
            <DashedPill tone={paymentStatusTone(purchase.paymentStatus)}>
              {purchase.paymentStatus === "partially_paid" ? "Partially Paid" : purchase.paymentStatus}
            </DashedPill>
          </div>
          {canExport && (
            <ExportMenu
              request={exportRequest}
              selectableFields
              defaultCheckedKeys={["product", "sku", "ordered", "received"]}
            />
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Supplier</p>
            <p className="mt-0.5 truncate text-sm font-bold text-ink">{purchase.supplierName}</p>
          </div>
          <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Destination</p>
            <p className="mt-0.5 truncate text-sm font-bold text-ink">{purchase.locationName}</p>
          </div>
          <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Supplier Invoice #</p>
            <p className="mt-0.5 truncate text-sm font-bold text-ink">{purchase.supplierInvoiceNumber ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Ordered</p>
            <p className="mt-0.5 text-sm font-bold text-ink">{formatDate(purchase.orderedAt)}</p>
          </div>
          <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Received</p>
            <p className="mt-0.5 text-sm font-bold text-ink">{formatDate(purchase.receivedAt)}</p>
          </div>
          <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Created By</p>
            <p className="mt-0.5 truncate text-sm font-bold text-ink">{purchase.createdByName ?? "—"}</p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Products</p>
            {canReceive && canEdit && (
              <button
                type="button"
                onClick={() => void handleReceiveAll()}
                disabled={receiveSaving}
                className="text-[11px] font-extrabold uppercase text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                Receive All
              </button>
            )}
          </div>
          <div className="mt-2 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[13%]" />
                <col className="w-[15%]" />
                {canReceive && <col className="w-[16%]" />}
              </colgroup>
              <thead>
                <tr className="bg-primary text-white">
                  <th className="px-3 py-2 text-left text-xs font-extrabold uppercase tracking-wider">Product</th>
                  <th className="px-3 py-2 text-right text-xs font-extrabold uppercase tracking-wider">Ordered</th>
                  <th className="px-3 py-2 text-right text-xs font-extrabold uppercase tracking-wider">Received</th>
                  <th className="px-3 py-2 text-right text-xs font-extrabold uppercase tracking-wider">Remaining</th>
                  <th className="px-3 py-2 text-right text-xs font-extrabold uppercase tracking-wider">Unit Cost</th>
                  <th className="px-3 py-2 text-right text-xs font-extrabold uppercase tracking-wider">Line Total</th>
                  {canReceive && (
                    <th className="px-3 py-2 text-right text-xs font-extrabold uppercase tracking-wider">
                      Receive Today
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {purchase.items.map((item) => {
                  const sessions = sessionsByItem.get(item.id) ?? [];
                  return (
                    <Fragment key={item.id}>
                      <tr className="border-t border-line odd:bg-white even:bg-soft/50">
                        <td className="line-clamp-2 px-3 py-2 leading-snug font-bold text-ink" title={item.productName}>
                          {item.productName}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{item.orderedQuantity}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{item.receivedQuantity}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-ink">{item.remainingQuantity}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{formatCents(item.unitCostCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-ink">
                          {formatCents(item.lineTotalCents)}
                        </td>
                        {canReceive && (
                          <td className="px-3 py-2 text-right">
                            {item.remainingQuantity > 0 ? (
                              <input
                                type="number"
                                min={0}
                                max={item.remainingQuantity}
                                value={receivingQuantities[item.id] ?? ""}
                                onChange={(event) => updateReceivingQuantity(item.id, event.target.value)}
                                placeholder="0"
                                className="h-8 w-20 rounded-md border border-line px-1.5 text-right text-xs font-bold outline-none focus:border-accent"
                              />
                            ) : (
                              <span className="text-xs font-bold text-success">Complete</span>
                            )}
                          </td>
                        )}
                      </tr>
                      {/* One row per receiving session that touched THIS product, oldest first — "the
                          first time," "the second time," etc. exactly as it happened, each with its
                          own real before/after. Replaces the old separate "Receiving History" section
                          (see sessionsByItem's own doc comment for why grouping by product here beats
                          grouping by date there). Nothing rendered for a line with zero sessions yet. */}
                      {sessions.map((session, index) => (
                        <tr key={`${item.id}-${index}`} className="border-t border-line/60 bg-soft/30">
                          <td colSpan={canReceive ? 7 : 6} className="px-3 py-2 pl-8 text-sm font-semibold text-muted">
                            <span className="font-extrabold text-ink">
                              {index === 0 ? "1st" : index === 1 ? "2nd" : index === 2 ? "3rd" : `${index + 1}th`} receipt
                            </span>{" "}
                            · {formatDate(session.receivedAt)} · {session.receivedByName} · +{session.receivingQuantity} ·
                            Stock Before ({purchase.locationName}): <span className="text-ink">{session.previousQuantity}</span> ·
                            Stock After ({purchase.locationName}):{" "}
                            <span className="font-extrabold text-success">{session.newQuantity}</span>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canReceive && canEdit && (
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                onClick={() => void handleReceiveGoods()}
                disabled={receiveSaving}
                className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {receiveSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                <Package className="mr-1.5 size-3.5" aria-hidden="true" />
                Receive Goods
              </Button>
            </div>
          )}
        </div>

        {purchase.notes && (
          <div className="mt-4 rounded-lg border border-line bg-soft px-3.5 py-2.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Notes</p>
            <p className="mt-1 whitespace-pre-line text-sm font-semibold text-ink">{purchase.notes}</p>
          </div>
        )}

        {purchase.attachmentPath && (
          <button
            type="button"
            onClick={() => void handleOpenAttachment()}
            className="mt-4 flex w-full items-center gap-2 rounded-lg border border-line bg-soft px-3.5 py-2.5 text-left text-sm font-bold text-ink hover:bg-soft/70 cursor-pointer"
          >
            <Paperclip className="size-3.5 flex-none text-muted" aria-hidden="true" />
            View attached document
          </button>
        )}

        <div className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between text-muted">
            <span className="font-semibold">Subtotal</span>
            <span className="font-bold tabular-nums">{formatCents(purchase.subtotalCents)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span className="font-semibold">Discount</span>
            <span className="font-bold tabular-nums">-{formatCents(purchase.discountAmountCents)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span className="font-semibold">Tax (included in Total)</span>
            <span className="font-bold tabular-nums">{formatCents(purchase.taxAmountCents)}</span>
          </div>
          {purchase.shippingCostCents > 0 && (
            <div className="flex justify-between text-muted">
              <span className="font-semibold">Shipping</span>
              <span className="font-bold tabular-nums">+{formatCents(purchase.shippingCostCents)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-extrabold text-ink">
            <span>Total</span>
            <span>{formatCents(purchase.grandTotalCents)}</span>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-line bg-soft p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Supplier Payments</p>
            <DashedPill tone={paymentStatusTone(purchase.paymentStatus)}>
              Paid {formatCents(purchase.amountPaidCents)} of {formatCents(purchase.grandTotalCents)}
            </DashedPill>
          </div>

          {purchase.payments.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {purchase.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-ink">{payment.paymentMethodName}</p>
                    <p className="text-[10px] font-semibold text-muted">
                      {formatDate(payment.paidAt)} · {payment.paidByName}
                      {payment.reference ? ` · Ref ${payment.reference}` : ""}
                    </p>
                  </div>
                  <span className="flex-none text-sm font-extrabold text-ink">{formatCents(payment.amountCents)}</span>
                </div>
              ))}
            </div>
          )}

          {canEdit && purchase.status !== "cancelled" && balanceDueCents > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button type="button" onClick={openRecordPayment} className="h-9 text-xs">
                <Wallet className="mr-1.5 size-3.5" aria-hidden="true" />
                Record Payment
              </Button>
              <Button
                type="button"
                onClick={openMarkPaid}
                className="h-9 border border-success/40 bg-white text-xs text-success shadow-none hover:bg-success/10"
              >
                <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden="true" />
                Mark as Paid
              </Button>
            </div>
          )}
        </div>

        {canEdit && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {canEditPurchase && (
              <Button type="button" onClick={onEdit} className="h-9 flex-1 text-xs">
                Edit Purchase
              </Button>
            )}
            {purchase.status === "draft" && (
              <Button
                type="button"
                onClick={() => void handleMarkOrdered()}
                className="h-9 flex-1 border border-primary/40 bg-white text-xs text-primary shadow-none hover:bg-primary/10"
              >
                <Send className="mr-1.5 size-3.5" aria-hidden="true" />
                Mark as Ordered
              </Button>
            )}
            {(purchase.status === "draft" || purchase.status === "ordered") && (
              <div className="flex-1">
                <Button
                  type="button"
                  onClick={() => void handleCancel()}
                  className="h-9 w-full border border-danger/30 bg-white text-xs text-danger shadow-none hover:bg-danger-soft"
                >
                  <Ban className="mr-1.5 size-3.5" aria-hidden="true" />
                  Cancel Purchase
                </Button>
                <p className="mt-1.5 text-[10px] font-semibold leading-snug text-muted">
                  Reports assume a cancelled purchase was never paid — or if it was, that the money was
                  returned. It won't count toward supplier spend either way.
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={recordPaymentOpen}
        onClose={() => setRecordPaymentOpen(false)}
        title="Record Payment"
        description="Multiple payments are supported — pay off the balance over several transactions."
        widthClassName="max-w-md"
      >
        <form onSubmit={submitRecordPayment}>
          {paymentError && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {paymentError}
            </div>
          )}
          <p className="mb-4 text-xs font-semibold text-muted">
            Outstanding balance: <span className="font-extrabold text-ink">{formatCents(balanceDueCents)}</span>
          </p>
          <SelectField
            label="Payment Method"
            value={paymentMethodId}
            onChange={setPaymentMethodId}
            options={[
              { value: "", label: "Select payment method" },
              ...activePaymentMethods.map((method) => ({ value: method.id, label: method.name }))
            ]}
          />
          <Field
            label="Amount"
            type="number"
            value={paymentAmount}
            onChange={setPaymentAmount}
            placeholder="0.00"
            required
            className="mt-4"
          />
          {selectedRecordMethod?.requiresReference && (
            <Field
              label="Reference"
              value={paymentReference}
              onChange={setPaymentReference}
              placeholder="e.g. M-Pesa code, transaction ID"
              required
              className="mt-4"
            />
          )}
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={() => setRecordPaymentOpen(false)}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={paymentSaving || !paymentMethodId}
              className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {paymentSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {paymentSaving ? "Saving..." : "Record Payment"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={markPaidOpen}
        onClose={() => setMarkPaidOpen(false)}
        title="Mark as Paid"
        description="Records a final payment for the full remaining balance."
        widthClassName="max-w-sm"
      >
        <form onSubmit={submitMarkPaid}>
          {markPaidError && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {markPaidError}
            </div>
          )}
          <p className="mb-4 text-xs font-semibold text-muted">
            This will record a payment of{" "}
            <span className="font-extrabold text-ink">{formatCents(balanceDueCents)}</span>.
          </p>
          <SelectField
            label="Payment Method"
            value={markPaidMethodId}
            onChange={setMarkPaidMethodId}
            options={[
              { value: "", label: "Select payment method" },
              ...activePaymentMethods.map((method) => ({ value: method.id, label: method.name }))
            ]}
          />
          {selectedMarkPaidMethod?.requiresReference && (
            <Field
              label="Reference"
              value={markPaidReference}
              onChange={setMarkPaidReference}
              placeholder="e.g. M-Pesa code, transaction ID"
              required
              className="mt-4"
            />
          )}
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={() => setMarkPaidOpen(false)}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={markPaidSaving || !markPaidMethodId}
              className="h-9 bg-success text-xs hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {markPaidSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {markPaidSaving ? "Saving..." : "Confirm Paid"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
