import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Copy,
  Globe,
  Loader2,
  Receipt,
  MapPin,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  StickyNote,
  Truck,
  XCircle
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { useConfirm } from "@renderer/shared/components/ConfirmModal";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { normalizePhoneForWhatsApp } from "@renderer/shared/lib/phone";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { useOnlineOrderAlertsStore } from "@renderer/shared/stores/online-order-alerts-store";
import type { OnlineOrder, OnlineOrderList, OnlineOrderStatus } from "@shared/types/online-store";
import { RingUpSaleModal } from "./online-orders/RingUpSaleModal";

type Filter = OnlineOrderStatus | "ALL";

const REFRESH_MS = 60 * 1000;

const STATUS_LABEL: Record<OnlineOrderStatus, string> = {
  NEW: "New",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled"
};

const STATUS_PILL: Record<OnlineOrderStatus, string> = {
  NEW: "bg-primary text-white",
  CONFIRMED: "bg-accent text-white",
  COMPLETED: "bg-success text-white",
  CANCELLED: "bg-white text-muted border border-line"
};

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * The shop's inbox for orders placed on its website (storefront checkout). Online-only: orders live
 * in the cloud and are read/updated through /shop-admin/orders. A web order is NOT a sale — it deducts
 * no stock and counts no revenue; staff confirm it with the customer (phone/WhatsApp), then ring it
 * up at Checkout as usual.
 */
export function OnlineOrdersRoute(): React.JSX.Element {
  const currency = useAppStore((state) => state.context?.tenant.currency ?? "");
  const businessName = useAppStore((state) => state.context?.tenant.businessName ?? "");
  const setNewCount = useOnlineOrderAlertsStore((state) => state.setNewCount);
  const { can } = usePermissions();
  const canEdit = can("online_store", "edit");
  const canSell = canEdit && can("sales", "create");
  const [ringUpOpen, setRingUpOpen] = useState(false);
  const confirm = useConfirm();

  const [filter, setFilter] = useState<Filter>("NEW");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OnlineOrderList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const requestSeq = useRef(0);

  const money = useCallback((cents: number) => `${currency} ${formatCents(cents)}`.trim(), [currency]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const result = await window.blueLedger.onlineOrders.list(filter, page);
      if (seq !== requestSeq.current) return; // a newer request (filter/page change) won
      setData(result);
      setLoadError(null);
      setUpdatedAt(new Date());
      setNewCount(result.counts.NEW);
      // Looking at them counts as "seen" — stops them being announced as new elsewhere.
      const unseenIds = result.orders.filter((o) => !o.seen).map((o) => o.id);
      if (unseenIds.length > 0) void window.blueLedger.onlineOrders.markSeen(unseenIds).catch(() => undefined);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setLoadError(getErrorMessage(err, "Couldn't load online orders"));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filter, page, setNewCount]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const orders = data?.orders ?? [];
  const selected = useMemo(
    () => orders.find((o) => o.id === selectedId) ?? orders[0] ?? null,
    [orders, selectedId]
  );
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  async function changeStatus(order: OnlineOrder, status: OnlineOrderStatus): Promise<void> {
    if (status === "CANCELLED") {
      const ok = await confirm({
        title: `Cancel ${order.orderNumber}?`,
        message: `Let ${order.customerName} know first — the website does not notify them automatically.`,
        tone: "danger",
        confirmLabel: "Cancel order",
        cancelLabel: "Keep order"
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await window.blueLedger.onlineOrders.setStatus(order.id, status);
      showSuccessToast(`${order.orderNumber} marked ${STATUS_LABEL[status].toLowerCase()}`);
      setSelectedId(order.id);
      await load();
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't update the order"));
    } finally {
      setBusy(false);
    }
  }

  function whatsappHref(order: OnlineOrder): string {
    const text = `Hi ${order.customerName.split(" ")[0]}, this is ${businessName || "the shop"} about your order ${order.orderNumber}.`;
    return `https://wa.me/${normalizePhoneForWhatsApp(order.customerPhone, "254")}?text=${encodeURIComponent(text)}`;
  }

  const counts = data?.counts ?? { NEW: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 };
  const allCount = counts.NEW + counts.CONFIRMED + counts.COMPLETED + counts.CANCELLED;
  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "NEW", label: "New", count: counts.NEW },
    { key: "CONFIRMED", label: "Confirmed", count: counts.CONFIRMED },
    { key: "COMPLETED", label: "Completed", count: counts.COMPLETED },
    { key: "CANCELLED", label: "Cancelled", count: counts.CANCELLED },
    { key: "ALL", label: "All", count: allCount }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Online Orders</h1>
          <p className="mt-1 max-w-[680px] text-sm font-semibold text-muted">
            Orders placed on your website. Call or WhatsApp the customer to confirm, then use{" "}
            <span className="font-extrabold text-ink">Ring up sale</span> to record it as a normal sale — a web order
            doesn&apos;t move stock or count as a sale until then.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt && (
            <span className="text-xs font-semibold text-muted">
              Updated {updatedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button onClick={() => void load()} disabled={loading} className="gap-2">
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={ShoppingBag} label="New — waiting" value={String(counts.NEW)} tone="primary" />
        <StatTile icon={CheckCircle2} label="Confirmed" value={String(counts.CONFIRMED)} tone="accent" />
        <StatTile icon={PackageCheck} label="Completed" value={String(counts.COMPLETED)} tone="success" />
        <StatTile icon={XCircle} label="Cancelled" value={String(counts.CANCELLED)} tone="warning" />
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setFilter(t.key);
              setPage(1);
              setSelectedId(null);
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-extrabold transition cursor-pointer",
              filter === t.key ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:border-ink"
            )}
          >
            {t.label}
            <span className={cn("tabular-nums", filter === t.key ? "text-white/70" : "text-muted")}>{t.count}</span>
          </button>
        ))}
      </div>

      {loadError && !data ? (
        <div className="rounded-lg border border-line bg-white p-8 text-center shadow-soft">
          <Globe className="mx-auto size-8 text-muted" aria-hidden="true" />
          <p className="mt-3 text-sm font-extrabold text-ink">Couldn&apos;t load online orders</p>
          <p className="mt-1 text-sm font-semibold text-muted">{loadError}</p>
          <p className="mt-1 text-xs font-semibold text-muted">
            Online orders need an internet connection — they live in the cloud, not on this computer.
          </p>
          <Button onClick={() => void load()} className="mt-4">
            Try again
          </Button>
        </div>
      ) : !data ? (
        <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-line bg-white shadow-soft">
          <Loader2 className="size-6 animate-spin text-muted" aria-hidden="true" />
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-white p-10 text-center">
          <ShoppingBag className="mx-auto size-8 text-muted" aria-hidden="true" />
          <p className="mt-3 text-sm font-extrabold text-ink">
            {filter === "NEW" ? "No new orders right now" : `No ${filter === "ALL" ? "" : STATUS_LABEL[filter].toLowerCase() + " "}orders`}
          </p>
          <p className="mt-1 text-sm font-semibold text-muted">
            New website orders appear here automatically — you&apos;ll also get a notification.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          {/* list */}
          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
            <ul className="divide-y divide-line">
              {orders.map((o) => {
                const active = selected?.id === o.id;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(o.id)}
                      className={cn(
                        "flex w-full items-start gap-3 p-4 text-left transition cursor-pointer",
                        active ? "bg-soft" : "hover:bg-soft/60"
                      )}
                    >
                      <span
                        className={cn("mt-1.5 size-2 flex-none rounded-full", o.seen ? "bg-transparent" : "bg-primary")}
                        aria-label={o.seen ? undefined : "Not seen yet"}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-extrabold text-ink">{o.orderNumber}</span>
                          <span className="text-sm font-extrabold tabular-nums text-ink">{money(o.totalCents)}</span>
                        </span>
                        <span className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-muted">
                            {o.customerName} · {o.items.length} item{o.items.length === 1 ? "" : "s"}
                          </span>
                          <span className="flex-none text-[11px] font-semibold text-muted">{timeAgo(o.createdAt)}</span>
                        </span>
                      </span>
                      <span
                        className={cn(
                          "flex-none rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
                          STATUS_PILL[o.status]
                        )}
                      >
                        {STATUS_LABEL[o.status]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-line p-3">
                <Button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="h-8 border border-line bg-white text-ink shadow-none hover:bg-soft disabled:opacity-40"
                >
                  Previous
                </Button>
                <span className="text-xs font-semibold text-muted">
                  Page {page} of {totalPages}
                </span>
                <Button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="h-8 border border-line bg-white text-ink shadow-none hover:bg-soft disabled:opacity-40"
                >
                  Next
                </Button>
              </div>
            )}
          </div>

          {selected && (
            <RingUpSaleModal
              order={selected}
              open={ringUpOpen}
              currency={currency}
              onClose={() => setRingUpOpen(false)}
              onDone={() => {
                setRingUpOpen(false);
                void load();
              }}
            />
          )}

          {/* detail */}
          {selected && (
            <div className="h-fit rounded-lg border border-line bg-white shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-extrabold text-ink">{selected.orderNumber}</h2>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
                        STATUS_PILL[selected.status]
                      )}
                    >
                      {STATUS_LABEL[selected.status]}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
                    <Clock className="size-3.5" aria-hidden="true" /> Placed {fullDate(selected.createdAt)}
                  </p>
                  {selected.linkedReceiptNumber || selected.linkedSaleId ? (
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-extrabold text-success">
                      <Receipt className="size-3.5" aria-hidden="true" /> Rung up as receipt{" "}
                      {selected.linkedReceiptNumber ?? selected.linkedSaleId}
                    </p>
                  ) : null}
                </div>
                <p className="text-right">
                  <span className="block text-[10px] font-extrabold uppercase tracking-wide text-muted">Total</span>
                  <span className="text-xl font-extrabold tabular-nums text-ink">{money(selected.totalCents)}</span>
                </p>
              </div>

              {/* customer */}
              <div className="grid gap-4 border-b border-line p-5 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Customer</p>
                  <p className="mt-1 text-sm font-extrabold text-ink">{selected.customerName}</p>
                  <p className="text-sm font-semibold text-ink">{selected.customerPhone}</p>
                  {selected.customerEmail && (
                    <p className="text-xs font-semibold text-muted">{selected.customerEmail}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      href={whatsappHref(selected)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-success px-3 text-[11px] font-extrabold uppercase tracking-wide text-white hover:brightness-110"
                    >
                      <MessageCircle className="size-3.5" aria-hidden="true" /> WhatsApp
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(selected.customerPhone)
                          .then(() => showSuccessToast("Phone number copied"))
                          .catch(() => showErrorToast("Couldn't copy"));
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-[11px] font-extrabold uppercase tracking-wide text-ink hover:bg-soft cursor-pointer"
                    >
                      <Copy className="size-3.5" aria-hidden="true" /> Copy phone
                    </button>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {selected.deliveryType === "pickup" ? (
                  <div>
                    <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-muted">
                      <MapPin className="size-3" aria-hidden="true" /> Pick up or delivery
                    </p>
                    <p className="mt-0.5 text-sm font-extrabold text-ink">Customer will pick up from the shop</p>
                  </div>
                  ) : (
                  <>
                  <div>
                    <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-muted">
                      <MapPin className="size-3" aria-hidden="true" /> Delivery address
                    </p>
                    <p className="mt-0.5 whitespace-pre-line text-sm font-semibold text-ink">
                      {selected.deliveryAddress || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-muted">
                      <Truck className="size-3" aria-hidden="true" /> Delivery
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-ink">
                      {selected.deliveryMethodName ?? "To be arranged"}
                      {selected.deliveryFeeCents > 0 ? ` · ${money(selected.deliveryFeeCents)}` : ""}
                    </p>
                  </div>
                  </>
                  )}
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Payment</p>
                    <p className="mt-0.5 text-sm font-semibold text-ink">To be agreed with the customer — nothing was paid online</p>
                  </div>
                </div>
              </div>

              {selected.notes && (
                <div className="flex gap-2 border-b border-line bg-soft/60 px-5 py-3">
                  <StickyNote className="mt-0.5 size-4 flex-none text-muted" aria-hidden="true" />
                  <p className="whitespace-pre-line text-sm font-semibold text-ink">{selected.notes}</p>
                </div>
              )}

              {/* items */}
              <div className="p-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-extrabold uppercase tracking-wide text-muted">
                      <th className="pb-2">Item</th>
                      <th className="pb-2 text-right">Qty</th>
                      <th className="pb-2 text-right">Price</th>
                      <th className="pb-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {selected.items.map((it) => (
                      <tr key={it.productId}>
                        <td className="py-2 pr-3 font-semibold text-ink">
                          <span className="line-clamp-2">{it.name}</span>
                        </td>
                        <td className="py-2 text-right tabular-nums font-semibold">{it.qty}</td>
                        <td className="py-2 text-right tabular-nums font-semibold text-muted">{money(it.unitPriceCents)}</td>
                        <td className="py-2 text-right tabular-nums font-extrabold">{money(it.lineTotalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 space-y-1 border-t border-dashed border-line pt-3 text-sm">
                  <div className="flex justify-between font-semibold text-muted">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{money(selected.subtotalCents)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-muted">
                    <span>Delivery</span>
                    <span className="tabular-nums">{money(selected.deliveryFeeCents)}</span>
                  </div>
                  <div className="flex justify-between text-base font-extrabold text-ink">
                    <span>Total</span>
                    <span className="tabular-nums">{money(selected.totalCents)}</span>
                  </div>
                </div>
              </div>

              {/* actions */}
              {canEdit && (
                <div className="flex flex-wrap justify-end gap-2 border-t border-line p-4">
                  {(selected.status === "NEW" || selected.status === "CONFIRMED") && (
                    <Button
                      onClick={() => void changeStatus(selected, "CANCELLED")}
                      disabled={busy}
                      className="border border-danger bg-white text-danger shadow-none hover:bg-danger hover:text-white"
                    >
                      Cancel order
                    </Button>
                  )}
                  {canSell && !selected.linkedSaleId && (selected.status === "NEW" || selected.status === "CONFIRMED") && (
                    <Button onClick={() => setRingUpOpen(true)} disabled={busy} className="gap-2 bg-success">
                      <Receipt className="size-4" aria-hidden="true" /> Ring up sale
                    </Button>
                  )}
                  {selected.status === "NEW" && (
                    <Button onClick={() => void changeStatus(selected, "CONFIRMED")} disabled={busy} className="gap-2 bg-primary">
                      <CheckCircle2 className="size-4" aria-hidden="true" /> Confirm order
                    </Button>
                  )}
                  {selected.status === "CONFIRMED" && !canSell && (
                    <Button onClick={() => void changeStatus(selected, "COMPLETED")} disabled={busy} className="gap-2 bg-success">
                      <PackageCheck className="size-4" aria-hidden="true" /> Mark completed
                    </Button>
                  )}
                  {(selected.status === "COMPLETED" || selected.status === "CANCELLED") && !selected.linkedSaleId && (
                    <Button
                      onClick={() => void changeStatus(selected, "NEW")}
                      disabled={busy}
                      className="gap-2 border border-line bg-white text-ink shadow-none hover:bg-soft"
                    >
                      <RotateCcw className="size-4" aria-hidden="true" /> Reopen
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
