import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, Minus, Plus, RefreshCw, Smartphone, Wallet, XCircle } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { useAppStore } from "@renderer/shared/stores/app-store";
import type { BillingMpesaTransactionStatus } from "@shared/types/billing-mpesa";
import type { PaymentScheduleResult } from "@shared/types/subscription-payment";

const PAYMENT_METHODS = [
  { key: "mpesa", label: "M-Pesa", icon: Smartphone },
  { key: "card", label: "Card", icon: CreditCard },
  { key: "paypal", label: "PayPal", icon: Wallet }
] as const;

const MPESA_MESSAGES: Record<BillingMpesaTransactionStatus, string> = {
  pending: "Waiting for you to enter your M-Pesa PIN...",
  success: "Payment completed successfully — you're all settled up.",
  insufficient: "Insufficient M-Pesa balance to complete this payment.",
  cancelled: "Cancelled — the request was cancelled on your phone.",
  wrong_pin: "Incorrect M-Pesa PIN entered. Please try again.",
  timeout: "Request timed out — please re-initiate and respond quicker.",
  failed: "Payment failed. Please try again."
};

type MpesaFlowState = "idle" | "sending" | "awaiting" | "success" | "error";

/** Payment-method picker shown wherever a tenant needs to pay their Blue Ledger bill — the
 * subscription is overdue (grace-period warning/lockout) or they're settling ahead of time from
 * Business Profile. M-Pesa is the one real, wired-up flow (Till STK push against the tenant's own
 * Outlet credentials, configured on the admin dashboard) — every other method is still a preview,
 * same as before. Success triggers a live heartbeat + re-hydrate so a device locked out by
 * LicenseBlockedRoute gets back in immediately, without an app restart. */
export function PayNowModal({
  open,
  onClose,
  amountLabel
}: {
  open: boolean;
  onClose: () => void;
  amountLabel?: string | undefined;
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  const hydrate = useAppStore((state) => state.hydrate);

  const [schedule, setSchedule] = useState<PaymentScheduleResult | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [phone, setPhone] = useState("");
  const [periodCount, setPeriodCount] = useState(1);
  const [state, setState] = useState<MpesaFlowState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [checkoutRequestId, setCheckoutRequestId] = useState<string | null>(null);
  const [manualChecking, setManualChecking] = useState(false);

  useEffect(() => {
    if (selected !== "mpesa") return;
    setScheduleLoading(true);
    void window.blueLedger.activation
      .paymentSchedule()
      .then((result) => {
        setSchedule(result);
        if (result) {
          const owedCount = result.periods.filter((entry) => entry.status === "overdue" || entry.status === "due").length;
          setPeriodCount(Math.max(1, owedCount));
        }
      })
      .finally(() => setScheduleLoading(false));
  }, [selected]);

  function markResolved(result: { status: BillingMpesaTransactionStatus; mpesaReceiptNumber: string | null }): void {
    if (result.status === "success") {
      setState("success");
      setMessage(MPESA_MESSAGES.success);
      void window.blueLedger.activation.heartbeat().then(() => hydrate());
    } else {
      setState("error");
      setMessage(MPESA_MESSAGES[result.status]);
    }
  }

  useEffect(() => {
    if (state !== "awaiting" || !checkoutRequestId) return;
    let cancelled = false;
    const requestId = checkoutRequestId;
    const interval = setInterval(() => {
      void window.blueLedger.billingMpesa
        .getStkStatus(requestId)
        .then((result) => {
          if (cancelled || result.status === "pending") return;
          markResolved(result);
        })
        .catch(() => {
          // Transient network hiccup — try again next tick rather than ending the flow.
        });
    }, 3_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, checkoutRequestId]);

  async function handleCheckStatusNow(): Promise<void> {
    if (!checkoutRequestId) return;
    setManualChecking(true);
    try {
      const result = await window.blueLedger.billingMpesa.checkStkStatus(checkoutRequestId);
      if (result.status !== "pending") markResolved(result);
    } catch (err) {
      setMessage(getErrorMessage(err, "Failed to check payment status"));
    } finally {
      setManualChecking(false);
    }
  }

  async function handleSend(): Promise<void> {
    if (phone.trim().length < 9) {
      setState("error");
      setMessage("Enter a valid phone number");
      return;
    }
    setState("sending");
    setMessage(null);
    try {
      const result = await window.blueLedger.billingMpesa.sendStkPush({ phone: phone.trim(), periodCount });
      setCheckoutRequestId(result.checkoutRequestId);
      setState("awaiting");
      setMessage(MPESA_MESSAGES.pending);
    } catch (err) {
      setState("error");
      setMessage(getErrorMessage(err, "Failed to send STK push"));
    }
  }

  function handleClose(): void {
    setSelected(null);
    setSchedule(null);
    setPhone("");
    setPeriodCount(1);
    setState("idle");
    setMessage(null);
    setCheckoutRequestId(null);
    onClose();
  }

  const periodNoun = schedule?.billingCycle === "YEARLY" ? "year" : "month";
  const amountCents = schedule?.pricePerPeriodCents ? schedule.pricePerPeriodCents * periodCount : 0;
  const nothingToPay = !schedule || schedule.billingCycle === "ONCE" || !schedule.pricePerPeriodCents;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Pay Now"
      description={
        amountLabel ? `Settle ${amountLabel} with Blue Ledger.` : "Choose a payment method to settle your Blue Ledger account."
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PAYMENT_METHODS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelected(key)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border px-3 py-5 text-xs font-bold transition cursor-pointer",
              selected === key
                ? "border-accent bg-accent/10 text-accent"
                : "border-line bg-soft text-ink hover:border-accent/50 hover:bg-accent/5"
            )}
          >
            <Icon className="size-6" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {selected === "mpesa" &&
        (scheduleLoading ? (
          <div className="mt-4 flex min-h-[120px] items-center justify-center text-muted">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : nothingToPay ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-soft/60 px-4 py-3 text-xs font-semibold text-muted">
            Nothing is currently set up to bill on M-Pesa for this account. Contact Blue Ledger support if
            you believe this is wrong.
          </p>
        ) : (
          <div className="mt-4">
            {(state === "idle" || state === "error") && (
              <div>
                {(() => {
                  const owed = schedule.periods.filter((entry) => entry.status === "overdue" || entry.status === "due");
                  if (owed.length === 0) return null;
                  return (
                    <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-danger">
                        {owed.filter((e) => e.status === "overdue").length > 0 ? "Overdue" : "Due Now"}
                      </p>
                      <p className="mt-1 text-xs font-bold text-ink">{owed.map((entry) => entry.label).join(", ")}</p>
                    </div>
                  );
                })()}

                <Field label="M-Pesa Phone Number" value={phone} onChange={setPhone} placeholder="e.g. 0712 345 678" />

                <div className="mt-3 flex items-center justify-between rounded-lg border border-line bg-soft/60 px-3.5 py-2.5">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-muted">
                    Pay for
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPeriodCount((n) => Math.max(1, n - 1))}
                      disabled={periodCount <= 1}
                      className="grid size-7 place-items-center rounded-md border border-line text-muted transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Minus className="size-3.5" aria-hidden="true" />
                    </button>
                    <span className="w-24 text-center text-sm font-extrabold text-ink">
                      {periodCount} {periodNoun}
                      {periodCount === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPeriodCount((n) => Math.min(24, n + 1))}
                      disabled={periodCount >= 24}
                      className="grid size-7 place-items-center rounded-md border border-line text-muted transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between rounded-lg bg-ink px-4 py-3">
                  <span className="text-xs font-extrabold uppercase tracking-wide text-white/70">Total</span>
                  <span className="text-lg font-extrabold text-white">
                    {schedule.currency} {formatCents(amountCents)}
                  </span>
                </div>

                {state === "error" && message && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm font-bold text-danger">
                    <XCircle className="size-4 flex-none" aria-hidden="true" />
                    {message}
                  </div>
                )}

                <Button type="button" onClick={() => void handleSend()} className="mt-3 h-10 w-full text-xs">
                  <Smartphone className="mr-1.5 size-4" aria-hidden="true" />
                  Send STK Push
                </Button>
              </div>
            )}

            {state === "sending" && (
              <div className="flex items-center gap-2 text-sm font-bold text-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Sending STK push...
              </div>
            )}

            {state === "awaiting" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-bold text-teal">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {message ?? MPESA_MESSAGES.pending}
                </div>
                <Button
                  type="button"
                  onClick={() => void handleCheckStatusNow()}
                  disabled={manualChecking}
                  className="h-8 border border-line bg-white px-2.5 text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {manualChecking ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                  )}
                  {manualChecking ? "Checking..." : "Taking long? Check Status Now"}
                </Button>
              </div>
            )}

            {state === "success" && (
              <div>
                <div className="flex items-center gap-2 text-sm font-extrabold text-success">
                  <CheckCircle2 className="size-4 flex-none" aria-hidden="true" />
                  {message ?? MPESA_MESSAGES.success}
                </div>
                <Button type="button" onClick={handleClose} className="mt-3 h-9 w-full text-xs">
                  Done
                </Button>
              </div>
            )}
          </div>
        ))}

      {selected && selected !== "mpesa" && (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-soft/60 px-4 py-3 text-xs font-semibold text-muted">
          Online payments through {PAYMENT_METHODS.find((m) => m.key === selected)?.label} aren't
          wired up yet — this is a preview of how you'll pay once it's live. Contact Blue Ledger
          support in the meantime to settle your account.
        </p>
      )}
    </Modal>
  );
}
