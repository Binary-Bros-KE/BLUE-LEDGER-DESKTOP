import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Globe,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Truck,
  Workflow,
  X
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { useOnlineOrderAlertsStore } from "@renderer/shared/stores/online-order-alerts-store";
import type { OnlineOrder, OnlineOrderList, OnlineOrderStatus } from "@shared/types/online-store";
import { OrderDetail } from "./online-orders/OrderDetail";
import { OrderMessageModal, type OrderMessageRequest } from "./online-orders/OrderMessageModal";
import { PAYMENT_LABEL, PAYMENT_PILL, STATUS_LABEL, STATUS_PILL, paymentState, routeOf } from "./online-orders/order-flow";

type TabKey = "all" | "pending" | "confirmed" | "on_the_way" | "to_complete" | "completed" | "cancelled";

const TABS: { key: TabKey; label: string; statuses: OnlineOrderStatus[] | "ALL" }[] = [
  { key: "all", label: "All orders", statuses: "ALL" },
  { key: "pending", label: "Pending", statuses: ["NEW"] },
  { key: "confirmed", label: "Confirmed", statuses: ["CONFIRMED"] },
  { key: "on_the_way", label: "Ready / Shipped", statuses: ["READY", "SHIPPED"] },
  { key: "to_complete", label: "To complete", statuses: ["PICKED_UP", "DELIVERED"] },
  { key: "completed", label: "Completed", statuses: ["COMPLETED"] },
  { key: "cancelled", label: "Cancelled", statuses: ["CANCELLED"] }
];

type DateKey = "any" | "today" | "yesterday" | "7d" | "30d" | "month" | "custom";

const DATE_OPTIONS: { key: DateKey; label: string }[] = [
  { key: "any", label: "Any date" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom range…" }
];

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Local calendar days → the [from, to) instants the server filters createdAt by. */
function dateRange(key: DateKey, customFrom: string, customTo: string): { from: string | null; to: string | null } {
  const today = startOfLocalDay(new Date());
  const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
  switch (key) {
    case "today":
      return { from: iso(today), to: null };
    case "yesterday":
      return { from: iso(addDays(today, -1)), to: iso(today) };
    case "7d":
      return { from: iso(addDays(today, -6)), to: null };
    case "30d":
      return { from: iso(addDays(today, -29)), to: null };
    case "month":
      return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: null };
    case "custom": {
      const parse = (s: string): Date | null => {
        const [y, m, d] = s.split("-").map(Number);
        return y && m && d ? new Date(y, m - 1, d) : null;
      };
      const from = parse(customFrom);
      const to = parse(customTo);
      return { from: iso(from), to: iso(to ? addDays(to, 1) : null) };
    }
    default:
      return { from: null, to: null };
  }
}

const REFRESH_MS = 60 * 1000;

const filterControl =
  "h-10 rounded-lg border border-line bg-white px-3 text-sm font-bold text-ink outline-none transition focus:border-accent cursor-pointer";

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The shop's inbox for orders placed on its website. Online-only: orders live in the cloud and are
 * read/updated through /shop-admin/orders. Each order walks its route step by step (pending →
 * confirmed → ready/shipped → picked up/delivered), can take payments on the way, and is finally
 * completed into a normal POS sale — only then does it move stock and count in sales reports.
 */
export function OnlineOrdersRoute(): React.JSX.Element {
  const currency = useAppStore((state) => state.context?.tenant.currency ?? "");
  const businessName = useAppStore((state) => state.context?.tenant.businessName ?? "");
  const setNewCount = useOnlineOrderAlertsStore((state) => state.setNewCount);
  const { can } = usePermissions();
  const canEdit = can("online_store", "edit");
  const canSell = canEdit && can("sales", "create");

  const [tab, setTab] = useState<TabKey>("all");
  const [dateKey, setDateKey] = useState<DateKey>("any");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OnlineOrderList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The order being worked on stays on screen after a step moves it out of the current tab.
  const [pinned, setPinned] = useState<OnlineOrder | null>(null);
  const [message, setMessage] = useState<OrderMessageRequest | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const requestSeq = useRef(0);

  const money = useCallback((cents: number) => `${currency} ${formatCents(cents)}`.trim(), [currency]);

  // Typing settles for a moment before it searches.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchText.trim()), 350);
    return () => clearTimeout(id);
  }, [searchText]);

  // Any filter change starts again from the first page with nothing pinned.
  useEffect(() => {
    setPage(1);
    setSelectedId(null);
    setPinned(null);
  }, [tab, dateKey, customFrom, customTo, search]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const statuses = TABS.find((t) => t.key === tab)?.statuses ?? "ALL";
      const range = dateRange(dateKey, customFrom, customTo);
      const result = await window.blueLedger.onlineOrders.list({ statuses, page, search: search || null, ...range });
      if (seq !== requestSeq.current) return; // a newer request (filter/page change) won
      setData(result);
      setLoadError(null);
      setUpdatedAt(new Date());
      // The sidebar badge counts every pending order — only trust these counts when unfiltered.
      if (!search && !range.from && !range.to) setNewCount(result.counts.NEW);
      // Looking at them counts as "seen" — stops them being announced as new elsewhere.
      const unseenIds = result.orders.filter((o) => !o.seen).map((o) => o.id);
      if (unseenIds.length > 0) void window.blueLedger.onlineOrders.markSeen(unseenIds).catch(() => undefined);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setLoadError(getErrorMessage(err, "Couldn't load online orders"));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [tab, page, search, dateKey, customFrom, customTo, setNewCount]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const orders = data?.orders ?? [];
  const selected = useMemo(() => {
    const listed = orders.find((o) => o.id === selectedId);
    if (listed) return listed;
    if (pinned && pinned.id === selectedId) return pinned;
    return orders[0] ?? null;
  }, [orders, selectedId, pinned]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function handleChanged(updated: OnlineOrder): void {
    setPinned(updated);
    setSelectedId(updated.id);
    setData((prev) => (prev ? { ...prev, orders: prev.orders.map((o) => (o.id === updated.id ? updated : o)) } : prev));
    void load();
  }

  const c = data?.counts;
  const count = (keys: OnlineOrderStatus[]): number => keys.reduce((s, k) => s + (c?.[k] ?? 0), 0);
  const tabCount = (t: (typeof TABS)[number]): number =>
    t.statuses === "ALL" ? (c ? Object.values(c).reduce((s, n) => s + n, 0) : 0) : count(t.statuses);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={ShoppingBag} label="Pending" value={String(count(["NEW"]))} tone="primary" />
        <StatTile icon={Workflow} label="In progress" value={String(count(["CONFIRMED", "READY", "SHIPPED"]))} tone="accent" />
        <StatTile icon={PackageCheck} label="To complete" value={String(count(["PICKED_UP", "DELIVERED"]))} tone="warning" />
        <StatTile icon={CheckCircle2} label="Completed" value={String(count(["COMPLETED"]))} tone="success" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search orders</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search order no., customer, phone or email"
            className={cn(filterControl, "w-full cursor-text pl-9 font-semibold")}
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText("")}
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-soft cursor-pointer"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Clear search</span>
            </button>
          )}
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select value={tab} onChange={(e) => setTab(e.target.value as TabKey)} className={filterControl}>
            {TABS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} ({tabCount(t)})
              </option>
            ))}
          </select>
        </label>
        <label className="relative">
          <span className="sr-only">Date placed</span>
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <select value={dateKey} onChange={(e) => setDateKey(e.target.value as DateKey)} className={cn(filterControl, "pl-9")}>
            {DATE_OPTIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        {dateKey === "custom" && (
          <span className="flex items-center gap-1.5">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={filterControl} aria-label="From" />
            <span className="text-xs font-bold text-muted">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={filterControl} aria-label="To" />
          </span>
        )}
        {(tab !== "all" || dateKey !== "any" || searchText) && (
          <button
            type="button"
            onClick={() => {
              setTab("all");
              setDateKey("any");
              setSearchText("");
            }}
            className="h-10 px-2 text-xs font-extrabold text-accent underline cursor-pointer"
          >
            Clear filters
          </button>
        )}
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
      ) : orders.length === 0 && !selected ? (
        <div className="rounded-lg border border-dashed border-line bg-white p-10 text-center">
          <ShoppingBag className="mx-auto size-8 text-muted" aria-hidden="true" />
          <p className="mt-3 text-sm font-extrabold text-ink">
            {search || dateKey !== "any" || tab !== "all" ? "No orders match these filters" : "No online orders yet"}
          </p>
          <p className="mt-1 text-sm font-semibold text-muted">
            {search || dateKey !== "any" || tab !== "all"
              ? "Try another status, date or search."
              : "New website orders appear here automatically — you'll also get a notification."}
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* list */}
          <div className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
            {orders.length === 0 ? (
              <p className="p-6 text-center text-sm font-semibold text-muted">No other orders in this tab.</p>
            ) : (
              <ul className="divide-y divide-line">
                {orders.map((o) => {
                  const active = selected?.id === o.id;
                  const pay = paymentState(o);
                  const RouteIcon = routeOf(o) === "pickup" ? Store : Truck;
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(o.id)}
                        className={cn(
                          "flex w-full items-start gap-3 border-l-4 p-4 text-left transition cursor-pointer",
                          active ? "border-l-accent bg-soft" : "border-l-transparent hover:bg-soft/60"
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
                              {o.customerName} · {o.items.reduce((s, it) => s + it.qty, 0)} item
                              {o.items.reduce((s, it) => s + it.qty, 0) === 1 ? "" : "s"}
                            </span>
                            <span className="flex-none text-[11px] font-semibold text-muted">{timeAgo(o.createdAt)}</span>
                          </span>
                          <span className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
                                STATUS_PILL[o.status] ?? STATUS_PILL.NEW
                              )}
                            >
                              {STATUS_LABEL[o.status] ?? o.status}
                            </span>
                            {o.status !== "CANCELLED" && (
                              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide", PAYMENT_PILL[pay])}>
                                {PAYMENT_LABEL[pay]}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted">
                              <RouteIcon className="size-3" aria-hidden="true" />
                              {routeOf(o) === "pickup" ? "Pick up" : "Delivery"}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
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
            <OrderDetail
              key={selected.id}
              order={selected}
              currency={currency}
              businessName={businessName}
              canEdit={canEdit}
              canSell={canSell}
              onChanged={handleChanged}
              onMessage={setMessage}
            />
          )}
        </div>
      )}

      <OrderMessageModal request={message} onClose={() => setMessage(null)} />
    </div>
  );
}
