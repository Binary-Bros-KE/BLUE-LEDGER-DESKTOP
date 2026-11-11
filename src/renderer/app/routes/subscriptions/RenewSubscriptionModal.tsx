import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { endDateFor, isValidDate } from "@shared/lib/subscription-schedule";
import type { Subscription } from "@shared/types/subscription";
import { daysLeftLabel, formatSubscriptionDate } from "./subscription-ui";

/** The next paid period. Starts where the old one ends if renewed early, or today if it had run out
 * (from the main process, so it's the same rule everywhere); both can be changed. */
export function RenewSubscriptionModal({
  subscription,
  onClose,
  onRenewed
}: {
  subscription: Subscription | null;
  onClose: () => void;
  onRenewed: (renewed: Subscription) => void;
}): React.JSX.Element {
  const [startDate, setStartDate] = useState("");
  const [periodDays, setPeriodDays] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!subscription) return;
    setError(null);
    void window.blueLedger.subscription
      .renewalDefaults(subscription.id)
      .then((defaults) => {
        setStartDate(defaults.startDate);
        setPeriodDays(String(defaults.periodDays));
        setAmount(defaults.amountCents !== null ? fromCents(defaults.amountCents) : "");
      })
      .catch((err) => setError(getErrorMessage(err, "Couldn't load this subscription")));
  }, [subscription]);

  const period = Number(periodDays);
  const valid = isValidDate(startDate) && Number.isInteger(period) && period >= 1 && period <= 3660;
  const newEnd = valid ? endDateFor(startDate, period) : null;

  async function handleRenew(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!subscription || !valid) return setError("Enter a valid start date and period.");
    setSaving(true);
    setError(null);
    try {
      const renewed = await window.blueLedger.subscription.renew(subscription.id, {
        startDate,
        periodDays: period,
        amountCents: amount.trim() ? toCents(amount) : null
      });
      showSuccessToast(`Renewed — now ends ${formatSubscriptionDate(renewed.endDate)}`);
      onRenewed(renewed);
    } catch (err) {
      const message = getErrorMessage(err, "Couldn't renew this subscription");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={subscription !== null}
      onClose={onClose}
      title="Renew Subscription"
      description={subscription ? `${subscription.customerName} · ${subscription.serviceName}${subscription.accountNumber ? ` · ${subscription.accountNumber}` : ""}` : ""}
    >
      {subscription && (
        <form onSubmit={(event) => void handleRenew(event)} className="space-y-4">
          {error && <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>}
          <p className="text-xs font-semibold text-muted">
            Current period ends {formatSubscriptionDate(subscription.endDate)} ({daysLeftLabel(subscription.daysLeft).toLowerCase()}).
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="New Start Date" type="date" value={startDate} onChange={setStartDate} required />
            <Field label="Period (days)" type="number" value={periodDays} onChange={setPeriodDays} required />
            <Field label="Amount (optional)" type="number" value={amount} onChange={setAmount} placeholder="0.00" />
          </div>
          <div className="rounded-lg border border-dashed border-line bg-soft/60 px-4 py-3">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">New end date</p>
            <p className="mt-0.5 text-base font-extrabold text-ink">{newEnd ? formatSubscriptionDate(newEnd) : "—"}</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" onClick={onClose} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !valid} className="h-9 text-xs">
              {saving && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
              Renew
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
