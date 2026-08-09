import { useEffect, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { CreditCard, Loader2, Receipt, ShieldCheck } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { PayNowModal } from "@renderer/shared/components/PayNowModal";
import { PaymentScheduleCalendar } from "./business-profile/PaymentScheduleCalendar";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { SubscriptionPaymentRecord } from "@shared/types/subscription-payment";
import type { TenantRecord } from "@shared/types/tenant";

function formatDate(value: string | null, withTime = false): string {
  if (!value) return withTime ? "Never synced" : "—";
  try {
    return format(new Date(value), withTime ? "PP p" : "PP");
  } catch {
    return value;
  }
}

const licenseStatusTone: Record<TenantRecord["licenseStatus"], "warning" | "success" | "danger"> = {
  trial: "warning",
  active: "success",
  suspended: "danger",
  cancelled: "danger"
};

/** Moved out of BusinessProfileRoute.tsx into its own tab — same data, same logic, same
 * window.blueLedger.activation.payments() call and PayNowModal flow, just a dedicated place to
 * live now that it's grown into its own real feature (calendar, pay-in-advance, per-invoice pay)
 * rather than a small section tacked onto the business profile form. */
export function PaymentsRoute(): React.JSX.Element {
  const [profile, setProfile] = useState<TenantRecord | null>(null);
  const [payments, setPayments] = useState<{
    recentPayments: SubscriptionPaymentRecord[];
    pendingPayments: SubscriptionPaymentRecord[];
  } | null>(null);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [payTarget, setPayTarget] = useState<SubscriptionPaymentRecord | null>(null);
  const [payInAdvanceOpen, setPayInAdvanceOpen] = useState(false);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void window.blueLedger.tenant.getProfile().then((record) => {
      if (!cancelled) setProfile(record);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void window.blueLedger.activation.payments().then((result) => {
      if (cancelled) return;
      setPayments(result);
      setPaymentsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Re-fetches the payment list and re-triggers PaymentScheduleCalendar's own fetch — called from
   * PayNowModal's onPaymentSuccess so a just-paid period stops showing grayed out immediately,
   * instead of only updating after the next full page reload. */
  function handlePaymentSuccess(): void {
    void window.blueLedger.activation.payments().then(setPayments);
    setScheduleRefreshKey((n) => n + 1);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative mt-6 space-y-5 pb-10 pl-4"
    >
      <span
        className="pointer-events-none absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-2 left-0 top-2 border-l-2 border-dashed border-line"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -left-[5px] bottom-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />

      {profile && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">
                Blue Ledger Management
              </p>
              <h2 className="mt-1 text-xl font-extrabold">License &amp; subscription</h2>
              <p className="mt-1 text-xs font-semibold text-muted">
                Read-only. These fields will be managed from the online dashboard once cloud sync is available.
              </p>
            </div>
            <ShieldCheck className="size-7 flex-none text-accent" aria-hidden="true" />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <InfoRow label="Tenant ID" value={profile.tenantId} mono />
            <InfoRow label="License Key" value={profile.licenseKey ?? "Not issued"} mono />
            <InfoRow label="License Status">
              <DashedPill tone={licenseStatusTone[profile.licenseStatus]} className="mt-1">
                {profile.licenseStatus}
              </DashedPill>
            </InfoRow>
            <InfoRow label="Subscription Plan">
              <DashedPill tone="accent" className="mt-1">
                {profile.subscriptionPlan}
              </DashedPill>
            </InfoRow>
            <InfoRow label="Subscription Start" value={formatDate(profile.subscriptionStartDate)} />
            <InfoRow label="Next Due Date" value={formatDate(profile.nextDueDate)} />
            <InfoRow label="Max Branches" value={String(profile.maxBranches)} mono />
            <InfoRow label="Max Users" value={String(profile.maxUsers)} mono />
            <InfoRow label="Max Devices" value={String(profile.maxDevices)} mono />
            <InfoRow label="App Version" value={profile.appVersion} mono />
            <InfoRow label="Last Successful Sync" value={formatDate(profile.lastSyncedAt, true)} />
            <InfoRow label="Last License Check" value={formatDate(profile.lastLicenseCheckAt, true)} />
            <InfoRow label="Pending Sync Records" value={String(profile.pendingSyncRecords)} mono />
            <InfoRow label="Suspended">
              <DashedPill tone={profile.isSuspended ? "danger" : "success"} className="mt-1">
                {profile.isSuspended ? "Yes" : "No"}
              </DashedPill>
            </InfoRow>
          </div>

          {profile.developerNotes && (
            <div className="mt-5 rounded-lg border border-line bg-soft p-4">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Developer Notes
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">{profile.developerNotes}</p>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">
              Blue Ledger Management
            </p>
            <h2 className="mt-1 text-xl font-extrabold">Payments</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Your last 5 payments, plus anything still outstanding.
            </p>
          </div>
          <Receipt className="size-7 flex-none text-accent" aria-hidden="true" />
        </div>

        {paymentsLoading ? (
          <div className="mt-5 flex items-center justify-center py-8 text-muted">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          </div>
        ) : !payments ? (
          <p className="mt-5 rounded-lg border border-dashed border-line bg-soft/60 px-4 py-3 text-xs font-semibold text-muted">
            Unable to load payment history — check your internet connection and reopen this page.
          </p>
        ) : (
          <>
            {payments.pendingPayments.length > 0 && (
              <div className="mt-5">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-warning">
                  Pending
                </p>
                <div className="mt-2 space-y-2">
                  {payments.pendingPayments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-extrabold text-ink">
                          {payment.currency} {formatCents(payment.amountCents)}
                        </p>
                        <p className="text-xs font-semibold text-muted">
                          {payment.billingPeriod} · Due {formatDate(payment.paymentDate)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        onClick={() => setPayTarget(payment)}
                        className="h-9 cursor-pointer text-xs"
                      >
                        <CreditCard className="mr-2 size-3.5" aria-hidden="true" />
                        Pay Now
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Recent Payments
              </p>
              {payments.recentPayments.length === 0 ? (
                <p className="mt-2 text-xs font-semibold text-muted">No payments recorded yet.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {payments.recentPayments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-soft px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-extrabold text-ink">
                          {payment.currency} {formatCents(payment.amountCents)}
                        </p>
                        <p className="text-xs font-semibold text-muted">
                          {payment.billingPeriod} · {payment.paymentMethod} ·{" "}
                          {formatDate(payment.paymentDate)}
                        </p>
                      </div>
                      <DashedPill tone="success">Paid</DashedPill>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <PaymentScheduleCalendar onPayInAdvance={() => setPayInAdvanceOpen(true)} refreshKey={scheduleRefreshKey} />
          </>
        )}
      </section>

      <PayNowModal
        open={payTarget !== null || payInAdvanceOpen}
        onClose={() => {
          setPayTarget(null);
          setPayInAdvanceOpen(false);
        }}
        amountLabel={payTarget ? `${payTarget.currency} ${formatCents(payTarget.amountCents)}` : undefined}
        onPaymentSuccess={handlePaymentSuccess}
      />
    </motion.div>
  );
}

function InfoRow({
  label,
  value,
  mono,
  children
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-soft px-3 py-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      {children ?? (
        <p
          className={cn(
            "mt-1 truncate text-sm font-bold text-ink",
            mono && "text-xs tabular-nums tracking-tight"
          )}
        >
          {value}
        </p>
      )}
    </div>
  );
}
