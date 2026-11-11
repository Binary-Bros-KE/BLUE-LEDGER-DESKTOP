import { Check } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import {
  DEFAULT_NOTICE_TEMPLATES,
  SUBSCRIPTION_NOTICE_LABELS,
  SUBSCRIPTION_NOTICE_STAGES,
  fillNoticeTemplate,
  type SubscriptionNoticeStage,
  type SubscriptionStage
} from "@shared/lib/subscription-schedule";
import type { Subscription } from "@shared/types/subscription";

/** One colour per stage, used for the pill, the row's left edge and the tiles. Orange sits between the
 * theme's warning (yellow) and danger (red) for "3 days left". */
export const STAGE_STYLE: Record<SubscriptionStage, { pill: string; edge: string; dot: string }> = {
  active: { pill: "border-success text-success", edge: "border-l-success", dot: "bg-success" },
  week: { pill: "border-warning text-warning", edge: "border-l-warning", dot: "bg-warning" },
  three_days: { pill: "border-orange-500 text-orange-600", edge: "border-l-orange-500", dot: "bg-orange-500" },
  due: { pill: "border-danger text-danger", edge: "border-l-danger", dot: "bg-danger" },
  expired: { pill: "border-red-900 bg-red-900 text-white", edge: "border-l-red-900", dot: "bg-red-900" }
};

/** Most urgent first: the order the reminder queue is worked through. */
export const STAGE_URGENCY: Record<SubscriptionStage, number> = { expired: 0, due: 1, three_days: 2, week: 3, active: 4 };

export function formatSubscriptionDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return "Expires today";
  if (daysLeft === 1) return "1 day left";
  if (daysLeft > 0) return `${daysLeft} days left`;
  return daysLeft === -1 ? "Expired yesterday" : `Expired ${-daysLeft} days ago`;
}

export function StagePill({ subscription }: { subscription: Pick<Subscription, "stage" | "daysLeft" | "status"> }): React.JSX.Element {
  if (subscription.status === "cancelled") {
    return <span className="inline-flex rounded-full border border-dashed border-line px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-muted">Cancelled</span>;
  }
  if (subscription.status === "renewed") {
    return <span className="inline-flex rounded-full border border-dashed border-line px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-muted">Renewed</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border border-dashed px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide",
        STAGE_STYLE[subscription.stage].pill
      )}
    >
      {daysLeftLabel(subscription.daysLeft)}
    </span>
  );
}

/** The four reminders as dots: filled once sent (who and when on hover), ringed when it's the one due
 * now, faint otherwise. */
export function NoticeTrack({ subscription }: { subscription: Subscription }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      {SUBSCRIPTION_NOTICE_STAGES.map((stage) => {
        const sent = subscription.notices.find((notice) => notice.stage === stage);
        const due = subscription.pendingNotice === stage;
        const title = sent
          ? `${SUBSCRIPTION_NOTICE_LABELS[stage]}: sent ${new Date(sent.sentAt).toLocaleString()}${sent.sentByName ? ` by ${sent.sentByName}` : ""} (${sent.channel})`
          : due
            ? `${SUBSCRIPTION_NOTICE_LABELS[stage]}: due now`
            : `${SUBSCRIPTION_NOTICE_LABELS[stage]}: not sent`;
        return (
          <span
            key={stage}
            title={title}
            className={cn(
              "grid size-5 place-items-center rounded-full border text-white",
              sent ? cn("border-transparent", STAGE_STYLE[stage].dot) : due ? "border-2 border-danger bg-white animate-pulse" : "border-line bg-soft"
            )}
          >
            {sent && <Check className="size-3" aria-hidden="true" />}
          </span>
        );
      })}
    </div>
  );
}

export function formatAmount(amountCents: number | null): string {
  return amountCents === null ? "—" : formatCents(amountCents);
}

// ---- Reminder messages: editable per stage, kept on this PC (like the WhatsApp share preference).

const TEMPLATES_KEY = "blueLedger.subscriptionNoticeTemplates";

export function loadNoticeTemplates(): Record<SubscriptionNoticeStage, string> {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Record<SubscriptionNoticeStage, string>>) : {};
    return {
      week: saved.week?.trim() ? saved.week : DEFAULT_NOTICE_TEMPLATES.week,
      three_days: saved.three_days?.trim() ? saved.three_days : DEFAULT_NOTICE_TEMPLATES.three_days,
      due: saved.due?.trim() ? saved.due : DEFAULT_NOTICE_TEMPLATES.due,
      expired: saved.expired?.trim() ? saved.expired : DEFAULT_NOTICE_TEMPLATES.expired
    };
  } catch {
    return { ...DEFAULT_NOTICE_TEMPLATES };
  }
}

export function saveNoticeTemplates(templates: Record<SubscriptionNoticeStage, string>): void {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch {
    // Storage blocked: the defaults keep working.
  }
}

export function buildNoticeMessage(subscription: Subscription, stage: SubscriptionNoticeStage, businessName: string): string {
  return fillNoticeTemplate(loadNoticeTemplates()[stage], {
    customer: subscription.customerName,
    service: subscription.serviceName,
    account: subscription.accountNumber ?? "—",
    end_date: formatSubscriptionDate(subscription.endDate),
    days: String(Math.abs(subscription.daysLeft)),
    business: businessName
  });
}
