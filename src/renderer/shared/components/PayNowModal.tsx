import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Smartphone,
  Wallet,
  XCircle,
  Zap
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { useAppStore } from "@renderer/shared/stores/app-store";
import type { BillingMpesaTransactionStatus } from "@shared/types/billing-mpesa";
import type { BillingPesapalTransactionStatus } from "@shared/types/billing-pesapal";
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

const PESAPAL_MESSAGES: Record<BillingPesapalTransactionStatus, string> = {
  pending: "Waiting for you to complete payment on Pesapal's secure page...",
  success: "Payment completed successfully — you're all settled up.",
  failed: "Payment failed. Please try again.",
  reversed: "This payment was reversed. Contact Blue Ledger support if unexpected.",
  invalid: "This payment was cancelled or is invalid. Please try again."
};

type MpesaFlowState = "idle" | "sending" | "awaiting" | "success" | "error";
type PesapalFlowState = "idle" | "submitting" | "awaiting" | "success" | "error";

/** Payment-method picker shown wherever a tenant needs to pay their Blue Ledger bill — the
 * subscription is overdue (grace-period warning/lockout) or they're settling ahead of time from
 * Business Profile. M-Pesa is a direct STK push; Card and PayPal both go through Pesapal's hosted
 * checkout (opened in the system browser, never embedded — this is a third-party PCI-scoped page) and
 * share one code path, since "both card and paypal will just lead to same landing." Success on any
 * method triggers a live heartbeat + re-hydrate so a device locked out by LicenseBlockedRoute gets
 * back in immediately, without an app restart. */
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

  const [pesapalState, setPesapalState] = useState<PesapalFlowState>("idle");
  const [pesapalMessage, setPesapalMessage] = useState<string | null>(null);
  const [orderTrackingId, setOrderTrackingId] = useState<string | null>(null);
  const [pesapalManualChecking, setPesapalManualChecking] = useState(false);
  const [autoBillingFlow, setAutoBillingFlow] = useState(false);
  const [autoBillingAccountNumber, setAutoBillingAccountNumber] = useState<string | null>(null);

  const isPesapalMethod = selected === "card" || selected === "paypal";

  useEffect(() => {
    if (!selected) return;
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

  function markPesapalResolved(result: { status: BillingPesapalTransactionStatus }): void {
    if (result.status === "success") {
      setPesapalState("success");
      setPesapalMessage(PESAPAL_MESSAGES.success);
      void window.blueLedger.activation.heartbeat().then(() => hydrate());
    } else {
      setPesapalState("error");
      setPesapalMessage(PESAPAL_MESSAGES[result.status]);
    }
  }

  useEffect(() => {
    if (pesapalState !== "awaiting" || !orderTrackingId) return;
    let cancelled = false;
    const trackingId = orderTrackingId;
    const interval = setInterval(() => {
      void window.blueLedger.billingPesapal
        .getStatus(trackingId)
        .then((result) => {
          if (cancelled || result.status === "pending") return;
          markPesapalResolved(result);
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
  }, [pesapalState, orderTrackingId]);

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

  async function handleCheckPesapalStatusNow(): Promise<void> {
    if (!orderTrackingId) return;
    setPesapalManualChecking(true);
    try {
      const result = await window.blueLedger.billingPesapal.checkStatus(orderTrackingId);
      if (result.status !== "pending") markPesapalResolved(result);
    } catch (err) {
      setPesapalMessage(getErrorMessage(err, "Failed to check payment status"));
    } finally {
      setPesapalManualChecking(false);
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

  /** Pay Now and Setup Auto Billing are two distinct submissions, not a checkbox on one flow — a
   * plain Pay Now order never carries account_number/subscription_details, so Pesapal's hosted page
   * never shows the recurring checkbox for it; only the dedicated Setup Auto Billing button does
   * (see billing-pesapal-service.ts's own comment on why these stay separate on Pesapal's side too). */
  async function handlePesapalSubmit(enroll: boolean): Promise<void> {
    setAutoBillingFlow(enroll);
    setPesapalState("submitting");
    setPesapalMessage(null);
    try {
      const result = await window.blueLedger.billingPesapal.submitOrder({
        periodCount: enroll ? 1 : periodCount,
        enrollAutoBilling: enroll
      });
      setOrderTrackingId(result.orderTrackingId);
      setAutoBillingAccountNumber(result.accountNumber);
      void window.blueLedger.billingPesapal.openRedirect(result.redirectUrl);
      setPesapalState("awaiting");
      setPesapalMessage(PESAPAL_MESSAGES.pending);
    } catch (err) {
      setPesapalState("error");
      setPesapalMessage(getErrorMessage(err, "Failed to start payment"));
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
    setPesapalState("idle");
    setPesapalMessage(null);
    setOrderTrackingId(null);
    setAutoBillingFlow(false);
    setAutoBillingAccountNumber(null);
    onClose();
  }

  const periodNoun = schedule?.billingCycle === "YEARLY" ? "year" : "month";
  const amountCents = schedule?.pricePerPeriodCents ? schedule.pricePerPeriodCents * periodCount : 0;
  const nothingToPay = !schedule || schedule.billingCycle === "ONCE" || !schedule.pricePerPeriodCents;
  const owed = schedule?.periods.filter((entry) => entry.status === "overdue" || entry.status === "due") ?? [];

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
                {owed.length > 0 && (
                  <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-danger">
                      {owed.filter((e) => e.status === "overdue").length > 0 ? "Overdue" : "Due Now"}
                    </p>
                    <p className="mt-1 text-xs font-bold text-ink">{owed.map((entry) => entry.label).join(", ")}</p>
                  </div>
                )}

                <Field label="M-Pesa Phone Number" value={phone} onChange={setPhone} placeholder="e.g. 0712 345 678" />

                <PeriodStepper periodCount={periodCount} setPeriodCount={setPeriodCount} periodNoun={periodNoun} />

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

      {isPesapalMethod &&
        (scheduleLoading ? (
          <div className="mt-4 flex min-h-[120px] items-center justify-center text-muted">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : nothingToPay ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-soft/60 px-4 py-3 text-xs font-semibold text-muted">
            Nothing is currently due for this account. Contact Blue Ledger support if you believe this
            is wrong.
          </p>
        ) : (
          <div className="mt-4">
            {(pesapalState === "idle" || pesapalState === "error") && (
              <div>
                {owed.length > 0 && (
                  <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-danger">
                      {owed.filter((e) => e.status === "overdue").length > 0 ? "Overdue" : "Due Now"}
                    </p>
                    <p className="mt-1 text-xs font-bold text-ink">{owed.map((entry) => entry.label).join(", ")}</p>
                  </div>
                )}

                <PeriodStepper periodCount={periodCount} setPeriodCount={setPeriodCount} periodNoun={periodNoun} />

                <div className="mt-3 flex items-center justify-between rounded-lg bg-ink px-4 py-3">
                  <span className="text-xs font-extrabold uppercase tracking-wide text-white/70">Total</span>
                  <span className="text-lg font-extrabold text-white">
                    {schedule.currency} {formatCents(amountCents)}
                  </span>
                </div>

                {pesapalState === "error" && pesapalMessage && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm font-bold text-danger">
                    <XCircle className="size-4 flex-none" aria-hidden="true" />
                    {pesapalMessage}
                  </div>
                )}

                <Button type="button" onClick={() => void handlePesapalSubmit(false)} className="mt-3 h-10 w-full text-xs">
                  <ExternalLink className="mr-1.5 size-4" aria-hidden="true" />
                  Pay with {selected === "card" ? "Card" : "PayPal"}
                </Button>

                <p className="mt-2 text-center text-[10px] font-semibold text-muted">
                  Payment processing is handled securely by Pesapal — you'll be redirected to complete it.
                </p>

                <AutoBillingPanel accountNumber={autoBillingAccountNumber} onSetup={() => void handlePesapalSubmit(true)} />
              </div>
            )}

            {pesapalState === "submitting" && (
              <div className="flex items-center gap-2 text-sm font-bold text-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Creating your secure checkout...
              </div>
            )}

            {pesapalState === "awaiting" && (
              <div className="space-y-3">
                {autoBillingFlow && <AutoBillingPanel accountNumber={autoBillingAccountNumber} awaiting />}
                <div className="flex items-center gap-2 text-sm font-bold text-teal">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {pesapalMessage ?? PESAPAL_MESSAGES.pending}
                </div>
                <Button
                  type="button"
                  onClick={() => void handleCheckPesapalStatusNow()}
                  disabled={pesapalManualChecking}
                  className="h-8 border border-line bg-white px-2.5 text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pesapalManualChecking ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                  )}
                  {pesapalManualChecking ? "Checking..." : "Taking long? Check Status Now"}
                </Button>
              </div>
            )}

            {pesapalState === "success" && (
              <div>
                <div className="flex items-center gap-2 text-sm font-extrabold text-success">
                  <CheckCircle2 className="size-4 flex-none" aria-hidden="true" />
                  {pesapalMessage ?? PESAPAL_MESSAGES.success}
                </div>
                {autoBillingFlow && (
                  <p className="mt-2 text-xs font-semibold text-muted">
                    If you completed the recurring setup checkbox on Pesapal's page, auto-billing will
                    show as active here once your first automatic charge lands.
                  </p>
                )}
                <Button type="button" onClick={handleClose} className="mt-3 h-9 w-full text-xs">
                  Done
                </Button>
              </div>
            )}
          </div>
        ))}
    </Modal>
  );
}

function PeriodStepper({
  periodCount,
  setPeriodCount,
  periodNoun
}: {
  periodCount: number;
  setPeriodCount: (updater: (n: number) => number) => void;
  periodNoun: string;
}): React.JSX.Element {
  return (
    <div className="mt-3 flex items-center justify-between rounded-lg border border-line bg-soft/60 px-3.5 py-2.5">
      <span className="text-xs font-extrabold uppercase tracking-wider text-muted">Pay for</span>
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
  );
}

/** The "Setup Auto Billing" instructions — Pesapal's recurring-payments checkbox lives entirely on
 * ITS OWN hosted checkout page, outside anything this app controls, so the only thing this UI can do
 * is tell the tenant exactly what to look for once they get there. Shown both before submitting
 * (`awaiting` false — so they know what's about to happen) and while their checkout tab is open
 * (`awaiting` true — a reminder while they're over in the browser). accountNumber is only known after
 * the order is actually submitted (SERVER generates/reuses it) — the pre-submit copy is generic. */
function AutoBillingPanel({
  accountNumber,
  awaiting = false,
  onSetup
}: {
  accountNumber: string | null;
  awaiting?: boolean;
  onSetup?: () => void;
}): React.JSX.Element {
  return (
    <div className="mt-4 rounded-lg border-2 border-danger/40 bg-danger-soft/40 p-4">
      <div className="flex items-center gap-2 text-sm font-extrabold text-danger">
        <Zap className="size-4 flex-none" aria-hidden="true" />
        Automatic Billing
      </div>
      <p className="mt-1 text-xs font-semibold text-ink">
        Never worry about a late payment again — Pesapal can charge your card automatically every
        billing cycle.
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] font-semibold text-muted">
        {!awaiting && <li>Click the "Setup Auto Billing" button below.</li>}
        <li>You'll be redirected to Pesapal's secure checkout page.</li>
        <li>Choose your preferred payment method and complete this first payment.</li>
        <li className="font-extrabold text-ink">Automatic payments are only available for Card/Visa options.</li>
        <li>
          Scroll to the bottom and check "Setup future recurring / subscription based payments for
          account {accountNumber ?? "SUB-XXXXXX-XXXXXX"} (Optional)".
        </li>
        <li>Leave the suggested start date as-is — it's already set to your next billing cycle.</li>
        <li>After this first payment, Pesapal will handle every payment after automatically.</li>
      </ol>
      {onSetup && (
        <Button
          type="button"
          onClick={onSetup}
          className="mt-3 h-10 w-full border-none bg-danger text-xs text-white shadow-none hover:bg-danger/90"
        >
          <Zap className="mr-1.5 size-4" aria-hidden="true" />
          Setup Auto Billing
        </Button>
      )}
    </div>
  );
}
