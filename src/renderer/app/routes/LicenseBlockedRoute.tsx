import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CreditCard, ShieldAlert } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { PayNowModal } from "@renderer/shared/components/PayNowModal";
import { formatCents } from "@renderer/shared/lib/money";
import type { PaymentScheduleResult } from "@shared/types/subscription-payment";

export type LockedStatus = "suspended" | "cancelled" | "grace_expired";

const COPY: Record<LockedStatus, { title: string; body: string; showPayNow: boolean }> = {
  suspended: {
    title: "License Suspended",
    body: "This installation's license has been suspended. Contact Blue Ledger support to resolve this and resume using the app.",
    showPayNow: true
  },
  cancelled: {
    title: "License Cancelled",
    body: "This installation's license has been cancelled. Contact Blue Ledger support if you believe this is a mistake.",
    showPayNow: false
  },
  grace_expired: {
    title: "Subscription Expired",
    body: "Your 30-day grace period has ended without a payment. Pay now to unlock the POS again — no data has been lost.",
    showPayNow: true
  }
};

/** Shown instead of the normal app the moment a cached license status is "suspended"/"cancelled",
 * or a MONTHLY subscription's grace period has fully lapsed (see shared/lib/grace-period.ts) — the
 * actual enforcement points for a revoked or unpaid license. Every status here only ever comes from
 * a real server response (activation/heartbeat) or a pure calculation over that response's cached
 * fields, never anything else, so there's no way to route around it from inside the app. The "Pay
 * Now" button only appears where paying is actually the fix — a cancelled license needs support,
 * not a self-serve payment. */
export function LicenseBlockedRoute({ status }: { status: LockedStatus }): React.JSX.Element {
  const copy = COPY[status];
  const [payOpen, setPayOpen] = useState(false);
  const [schedule, setSchedule] = useState<PaymentScheduleResult | null>(null);

  // Fetched purely to show WHAT'S owed on the lock screen itself, before the user even opens the
  // modal — "pay 2000" means nothing on its own if someone's been away for months; showing exactly
  // which periods are covered is what makes that number trustworthy. PayNowModal fetches its own
  // copy independently when opened (deliberately not shared state — same "always fetch fresh, never
  // cache" discipline as everywhere else money is involved in this app).
  useEffect(() => {
    if (!copy.showPayNow) return;
    let cancelled = false;
    void window.blueLedger.activation.paymentSchedule().then((result) => {
      if (!cancelled) setSchedule(result);
    });
    return () => {
      cancelled = true;
    };
  }, [copy.showPayNow]);

  const owed = schedule?.periods.filter((entry) => entry.status === "overdue" || entry.status === "due") ?? [];
  const totalOwedCents = schedule?.pricePerPeriodCents ? schedule.pricePerPeriodCents * owed.length : 0;
  const amountLabel =
    owed.length > 0 && schedule
      ? `${owed.length} ${owed.length === 1 ? "period" : "periods"} (${schedule.currency} ${formatCents(totalOwedCents)})`
      : undefined;

  return (
    <div className="flex h-screen w-full items-center justify-center bg-sidebar px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-soft"
      >
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-danger-soft text-danger">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-extrabold">{copy.title}</h1>
        <p className="mt-2 text-sm font-semibold text-muted">{copy.body}</p>

        {owed.length > 0 && schedule && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-left">
            <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-danger">
              <AlertTriangle className="size-3.5 flex-none" aria-hidden="true" />
              {owed.some((e) => e.status === "overdue") ? "Overdue" : "Due Now"}
            </p>
            <p className="mt-1 text-sm font-bold text-ink">{owed.map((entry) => entry.label).join(", ")}</p>
            <div className="mt-2 flex items-center justify-between border-t border-danger/20 pt-2">
              <span className="text-xs font-bold text-muted">Total</span>
              <span className="text-sm font-extrabold text-ink">
                {schedule.currency} {formatCents(totalOwedCents)}
              </span>
            </div>
          </div>
        )}

        {copy.showPayNow && (
          <Button
            type="button"
            onClick={() => setPayOpen(true)}
            className="mx-auto mt-5 cursor-pointer"
          >
            <CreditCard className="mr-2 size-4" aria-hidden="true" />
            Pay Now
          </Button>
        )}
      </motion.div>

      <PayNowModal open={payOpen} onClose={() => setPayOpen(false)} amountLabel={amountLabel} />
    </div>
  );
}
