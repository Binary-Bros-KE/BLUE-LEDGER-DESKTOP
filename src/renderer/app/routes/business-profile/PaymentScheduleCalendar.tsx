import { useEffect, useState } from "react";
import { CalendarClock, CreditCard, Loader2, Zap } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { cn } from "@renderer/shared/lib/cn";
import type { BillingPeriodEntry, PaymentScheduleResult } from "@shared/types/subscription-payment";

const STATUS_STYLE: Record<BillingPeriodEntry["status"], string> = {
  paid: "border-success/30 bg-success/10 text-success",
  overdue: "border-danger/30 bg-danger-soft text-danger",
  due: "border-warning/30 bg-warning/10 text-warning",
  future: "border-line bg-soft text-muted"
};

/** Ported from the admin dashboard's own PaymentCalendar.tsx "Jan ✅ Feb ✅ Mar ❌" view — same
 * computed-not-stored logic (see SERVER's computePaymentSchedule), fetched fresh via
 * activation:payment-schedule. Grouped by year (MONTHLY can span multiple years once a tenant's
 * been around a while; YEARLY is naturally one entry per row). */
export function PaymentScheduleCalendar({
  onPayInAdvance,
  refreshKey
}: {
  onPayInAdvance: () => void;
  /** Bump this (e.g. a counter incremented on payment success) to force a re-fetch — otherwise this
   * only ever loads once on mount, so a just-completed payment keeps showing its period grayed out
   * ("future"/"due") until the whole page is reloaded. */
  refreshKey?: number;
}): React.JSX.Element | null {
  const [schedule, setSchedule] = useState<PaymentScheduleResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void window.blueLedger.activation
      .paymentSchedule()
      .then((result) => {
        if (!cancelled) setSchedule(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="mt-5 flex items-center justify-center py-8 text-muted">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  // ONCE (a pure one-time purchase with no maintenance fee) has no recurring schedule at all.
  if (!schedule || schedule.periods.length === 0) return null;

  const years = new Map<string, BillingPeriodEntry[]>();
  for (const entry of schedule.periods) {
    const year = schedule.billingCycle === "MONTHLY" ? entry.key.slice(0, 4) : entry.key;
    const bucket = years.get(year) ?? [];
    bucket.push(entry);
    years.set(year, bucket);
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
            Payment Calendar
          </p>
          <p className="mt-1 text-xs font-semibold text-muted">
            {schedule.billingCycle === "MONTHLY" ? "Every month" : "Every year"} since this account
            started — green is paid, amber is due now, red is overdue, grey hasn't come due yet.
          </p>
          {schedule.pesapalAutoBillingEnabled && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-success">
              <Zap className="size-3 flex-none" aria-hidden="true" />
              Auto-Billing Active
              {schedule.pesapalAutoBillingActivatedAt &&
                ` since ${new Date(schedule.pesapalAutoBillingActivatedAt).toLocaleDateString()}`}
            </span>
          )}
        </div>
        <Button type="button" onClick={onPayInAdvance} className="h-9 text-xs">
          <CreditCard className="mr-1.5 size-3.5" aria-hidden="true" />
          Pay in Advance
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {[...years.entries()].map(([year, entries]) => (
          <div key={year}>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{year}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {entries.map((entry) => (
                <span
                  key={entry.key}
                  title={entry.label}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] font-bold",
                    STATUS_STYLE[entry.status]
                  )}
                >
                  {schedule.billingCycle === "MONTHLY" ? entry.label.split(" ")[0] : entry.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-muted">
        <CalendarClock className="size-3.5 flex-none" aria-hidden="true" />
        Next due: {schedule.nextDueDate ? new Date(schedule.nextDueDate).toLocaleDateString() : "—"}
      </p>
    </div>
  );
}
