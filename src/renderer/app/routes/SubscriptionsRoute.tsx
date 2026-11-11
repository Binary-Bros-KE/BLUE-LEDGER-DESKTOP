import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, BellRing, CalendarClock, CalendarX2, CheckCircle2, MessageSquareText, Plus, Search, Send, Tv } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { SelectField } from "@renderer/shared/components/form-fields";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast } from "@renderer/shared/lib/toast";
import { useSubscriptionAlertsStore } from "@renderer/shared/stores/subscription-alerts-store";
import { SUBSCRIPTION_NOTICE_LABELS, SUBSCRIPTION_STAGE_LABELS, type SubscriptionNoticeStage, type SubscriptionStage } from "@shared/lib/subscription-schedule";
import type { ExportListRequest } from "@shared/types/export";
import type { Subscription, SubscriptionServiceSuggestion } from "@shared/types/subscription";
import { NoticeTemplatesModal } from "./subscriptions/NoticeTemplatesModal";
import { RenewSubscriptionModal } from "./subscriptions/RenewSubscriptionModal";
import { SendReminderModal } from "./subscriptions/SendReminderModal";
import { SubscriptionDetailModal } from "./subscriptions/SubscriptionDetailModal";
import { SubscriptionFormModal } from "./subscriptions/SubscriptionFormModal";
import { NoticeTrack, STAGE_STYLE, STAGE_URGENCY, StagePill, daysLeftLabel, formatAmount, formatSubscriptionDate } from "./subscriptions/subscription-ui";

type StageFilter = "all" | SubscriptionStage | "cancelled" | "needs_reminder";

// Days left change at midnight and reminders arrive by sync: a cheap local re-read every minute keeps
// the screen honest if it's left open all day.
const REFRESH_MS = 60 * 1000;

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <th className={cn("px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>{children}</th>;
}

/**
 * Subscriptions the shop sells and tracks for its customers (DStv, GOtv...): days left at a glance,
 * colour by stage, and the manual reminder queue at the top — each reminder opens WhatsApp or email
 * with the message ready, and is marked sent so nobody sends it twice.
 */
export function SubscriptionsRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("subscriptions", "create");
  const canEdit = can("subscriptions", "edit");
  const canExport = can("subscriptions", "export");
  const setPendingCount = useSubscriptionAlertsStore((state) => state.setPendingCount);

  const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
  const [suggestions, setSuggestions] = useState<SubscriptionServiceSuggestion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [serviceFilter, setServiceFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [viewing, setViewing] = useState<Subscription | null>(null);
  const [renewing, setRenewing] = useState<Subscription | null>(null);
  const [sending, setSending] = useState<{ subscription: Subscription; stage: SubscriptionNoticeStage } | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, services] = await Promise.all([
        window.blueLedger.subscription.list(),
        window.blueLedger.subscription.serviceSuggestions()
      ]);
      setSubscriptions(list);
      setSuggestions(services);
      setPendingCount(list.filter((subscription) => subscription.pendingNotice !== null).length);
      setLoadError(null);
      // Keep an open detail panel showing the latest version of what it's showing.
      setViewing((open) => (open ? (list.find((subscription) => subscription.id === open.id) ?? open) : open));
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load subscriptions");
      setLoadError(message);
      showErrorToast(message);
    }
  }, [setPendingCount]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  const active = useMemo(() => (subscriptions ?? []).filter((subscription) => subscription.status === "active"), [subscriptions]);
  const counts = useMemo(() => {
    const byStage = (stage: SubscriptionStage) => active.filter((subscription) => subscription.stage === stage).length;
    return {
      active: byStage("active"),
      week: byStage("week"),
      threeDays: byStage("three_days"),
      due: byStage("due"),
      expired: byStage("expired"),
      reminders: active.filter((subscription) => subscription.pendingNotice !== null).length
    };
  }, [active]);

  const queue = useMemo(
    () =>
      active
        .filter((subscription) => subscription.pendingNotice !== null)
        .sort((a, b) => STAGE_URGENCY[a.stage] - STAGE_URGENCY[b.stage] || a.daysLeft - b.daysLeft),
    [active]
  );

  const services = useMemo(() => [...new Set((subscriptions ?? []).map((subscription) => subscription.serviceName))].sort(), [subscriptions]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (subscriptions ?? [])
      .filter((subscription) => {
        if (stageFilter === "cancelled") return subscription.status === "cancelled";
        if (subscription.status !== "active") return false;
        if (stageFilter === "needs_reminder") return subscription.pendingNotice !== null;
        return stageFilter === "all" || subscription.stage === stageFilter;
      })
      .filter((subscription) => !serviceFilter || subscription.serviceName === serviceFilter)
      .filter(
        (subscription) =>
          !term ||
          `${subscription.customerName} ${subscription.customerPhone ?? ""} ${subscription.serviceName} ${subscription.accountNumber ?? ""}`
            .toLowerCase()
            .includes(term)
      )
      .sort((a, b) => a.daysLeft - b.daysLeft || a.customerName.localeCompare(b.customerName));
  }, [subscriptions, search, stageFilter, serviceFilter]);

  const exportRequest = useMemo<ExportListRequest>(
    () => ({
      module: "subscriptions",
      title: "Subscriptions",
      columns: [
        { key: "customer", header: "Customer" },
        { key: "phone", header: "Phone" },
        { key: "service", header: "Service" },
        { key: "account", header: "Smartcard / IUC" },
        { key: "start", header: "Start" },
        { key: "end", header: "Ends" },
        { key: "daysLeft", header: "Days Left", align: "right" },
        { key: "stage", header: "Stage" },
        { key: "amount", header: "Amount", align: "right" },
        { key: "reminders", header: "Reminders Sent" }
      ],
      rows: rows.map((subscription) => ({
        customer: subscription.customerName,
        phone: subscription.customerPhone ?? "",
        service: subscription.serviceName,
        account: subscription.accountNumber ?? "",
        start: formatSubscriptionDate(subscription.startDate),
        end: formatSubscriptionDate(subscription.endDate),
        daysLeft: String(subscription.daysLeft),
        stage: subscription.status === "cancelled" ? "Cancelled" : SUBSCRIPTION_STAGE_LABELS[subscription.stage],
        amount: formatAmount(subscription.amountCents),
        reminders: subscription.notices.map((notice) => SUBSCRIPTION_NOTICE_LABELS[notice.stage]).join(", ")
      })),
      stats: [
        { label: "Active", value: String(active.length) },
        { label: "Due this week", value: String(counts.week + counts.threeDays + counts.due) },
        { label: "Expired", value: String(counts.expired) }
      ],
      fileBaseName: "Subscriptions"
    }),
    [rows, active.length, counts]
  );

  function openSend(subscription: Subscription, stage: SubscriptionNoticeStage | null = subscription.pendingNotice): void {
    if (stage) setSending({ subscription, stage });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile icon={CheckCircle2} label="Active" value={String(counts.active)} tone="success" />
        <StatTile icon={CalendarClock} label="Due This Week" value={String(counts.week)} tone="warning" />
        <StatTile icon={AlarmClock} label="Due in 3 Days" value={String(counts.threeDays)} tone="accent" />
        <StatTile icon={CalendarX2} label="Expires Today" value={String(counts.due)} tone="danger" />
        <StatTile icon={Tv} label="Expired" value={String(counts.expired)} tone="primary" />
        <StatTile icon={BellRing} label="Reminders Waiting" value={String(counts.reminders)} tone={counts.reminders > 0 ? "danger" : "warning"} />
      </div>

      {queue.length > 0 && (
        <section className="rounded-lg border-2 border-danger/30 bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BellRing className="size-4 text-danger" aria-hidden="true" />
              <h3 className="text-sm font-extrabold text-ink">Needs a reminder ({queue.length})</h3>
            </div>
            <p className="text-[11px] font-semibold text-muted">Most urgent first. Sent by hand, then marked so nobody sends twice.</p>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {queue.slice(0, 8).map((subscription) => (
              <div key={subscription.id} className={cn("flex items-center justify-between gap-3 rounded-lg border border-line border-l-4 px-3 py-2", STAGE_STYLE[subscription.stage].edge)}>
                <button type="button" onClick={() => setViewing(subscription)} className="min-w-0 text-left cursor-pointer">
                  <p className="truncate text-sm font-extrabold text-ink">{subscription.customerName}</p>
                  <p className="truncate text-xs font-semibold text-muted">
                    {subscription.serviceName} · {daysLeftLabel(subscription.daysLeft)} · {SUBSCRIPTION_NOTICE_LABELS[subscription.pendingNotice!]} reminder
                  </p>
                </button>
                {canEdit && (
                  <Button type="button" onClick={() => openSend(subscription)} className="h-8 flex-none bg-danger text-[11px] hover:bg-danger/90">
                    <Send className="mr-1.5 size-3.5" aria-hidden="true" />
                    Send
                  </Button>
                )}
              </div>
            ))}
          </div>
          {queue.length > 8 && (
            <button type="button" onClick={() => setStageFilter("needs_reminder")} className="mt-2 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer">
              Show all {queue.length}
            </button>
          )}
        </section>
      )}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Customers</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <Tv className="size-5 text-primary" aria-hidden="true" />
              Subscriptions
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">DStv, GOtv and other subscriptions you renew for customers.</p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && <ExportMenu request={exportRequest} />}
            {canEdit && (
              <Button type="button" onClick={() => setTemplatesOpen(true)} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
                <MessageSquareText className="mr-1.5 size-4" aria-hidden="true" />
                Messages
              </Button>
            )}
            {canCreate && (
              <Button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className="h-9 text-xs"
              >
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Subscription
              </Button>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Search</span>
            <div className="relative mt-1.5">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Customer, phone, service or smartcard"
                className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>
          </label>
          <SelectField
            label="Stage"
            value={stageFilter}
            onChange={(value) => setStageFilter(value as StageFilter)}
            options={[
              { value: "all", label: "All active" },
              { value: "needs_reminder", label: "Needs a reminder" },
              { value: "active", label: SUBSCRIPTION_STAGE_LABELS.active },
              { value: "week", label: SUBSCRIPTION_STAGE_LABELS.week },
              { value: "three_days", label: SUBSCRIPTION_STAGE_LABELS.three_days },
              { value: "due", label: SUBSCRIPTION_STAGE_LABELS.due },
              { value: "expired", label: SUBSCRIPTION_STAGE_LABELS.expired },
              { value: "cancelled", label: "Cancelled" }
            ]}
          />
          <SelectField
            label="Service"
            value={serviceFilter}
            onChange={setServiceFilter}
            options={[{ value: "", label: "All services" }, ...services.map((service) => ({ value: service, label: service }))]}
          />
        </div>

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-8 text-center">
              <p className="text-sm font-bold text-danger">{loadError}</p>
              <Button type="button" onClick={() => void load()} className="mt-4 h-9 text-xs">
                Try again
              </Button>
            </div>
          ) : subscriptions === null ? (
            <p className="py-10 text-center text-sm font-semibold text-muted">Loading…</p>
          ) : subscriptions.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Tv className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No subscriptions yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">Add a customer's DStv or GOtv subscription to track its days left and send renewal reminders.</p>
              {canCreate && (
                <Button type="button" onClick={() => setFormOpen(true)} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Subscription
                </Button>
              )}
            </div>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line bg-soft/60 py-10 text-center text-sm font-semibold text-muted">Nothing matches your filters.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Customer</Th>
                    <Th>Service</Th>
                    <Th>Period</Th>
                    <Th>Days Left</Th>
                    <Th>Reminders</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((subscription) => (
                    <tr
                      key={subscription.id}
                      onClick={() => setViewing(subscription)}
                      className={cn(
                        "cursor-pointer border-t border-line border-l-4 odd:bg-white even:bg-soft/50 hover:bg-soft",
                        subscription.status === "cancelled" ? "border-l-line" : STAGE_STYLE[subscription.stage].edge
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <p className="font-extrabold text-ink">{subscription.customerName}</p>
                        <p className="text-xs font-semibold text-muted">{subscription.customerPhone ?? "—"}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-bold text-ink">{subscription.serviceName}</p>
                        <p className="text-xs font-semibold text-muted">{subscription.accountNumber ?? "No smartcard number"}</p>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-semibold text-muted">
                        {formatSubscriptionDate(subscription.startDate)} → <span className="font-bold text-ink">{formatSubscriptionDate(subscription.endDate)}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <StagePill subscription={subscription} />
                      </td>
                      <td className="px-3 py-2.5">
                        <NoticeTrack subscription={subscription} />
                      </td>
                      <td className="px-3 py-2.5 text-right" onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          {canEdit && subscription.pendingNotice && (
                            <Button type="button" onClick={() => openSend(subscription)} className="h-8 bg-danger px-2.5 text-[11px] hover:bg-danger/90">
                              <Send className="mr-1 size-3.5" aria-hidden="true" />
                              Remind
                            </Button>
                          )}
                          {canCreate && subscription.status === "active" && (
                            <Button type="button" onClick={() => setRenewing(subscription)} className="h-8 border border-line bg-white px-2.5 text-[11px] text-ink shadow-none hover:bg-soft">
                              Renew
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <SubscriptionFormModal
        open={formOpen}
        editing={editing}
        suggestions={suggestions}
        onClose={() => setFormOpen(false)}
        onSaved={(saved) => {
          setFormOpen(false);
          setEditing(null);
          void load();
          setViewing((open) => (open ? saved : open));
        }}
      />
      <SubscriptionDetailModal
        subscription={viewing}
        onClose={() => setViewing(null)}
        onChanged={load}
        onEdit={(subscription) => {
          setEditing(subscription);
          setFormOpen(true);
        }}
        onRenew={setRenewing}
        onSend={(subscription, stage) => openSend(subscription, stage)}
      />
      <RenewSubscriptionModal
        subscription={renewing}
        onClose={() => setRenewing(null)}
        onRenewed={(renewed) => {
          setRenewing(null);
          void load();
          setViewing((open) => (open ? renewed : open));
        }}
      />
      <SendReminderModal
        target={sending}
        onClose={() => setSending(null)}
        onSent={(updated) => {
          setSending(null);
          void load();
          setViewing((open) => (open && open.id === updated.id ? updated : open));
        }}
      />
      <NoticeTemplatesModal open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
    </div>
  );
}
