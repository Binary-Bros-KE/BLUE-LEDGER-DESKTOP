import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { QuickCreateCustomerModal } from "@renderer/shared/components/QuickCreateCustomerModal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { DEFAULT_SUBSCRIPTION_PERIOD_DAYS, endDateFor, isValidDate, localTodayIso } from "@shared/lib/subscription-schedule";
import type { Customer } from "@shared/types/customer";
import type { Location } from "@shared/types/location";
import type { Subscription, SubscriptionServiceSuggestion } from "@shared/types/subscription";
import { formatSubscriptionDate } from "./subscription-ui";

const QUICK_PERIODS = [7, 30, 60, 90, 365];

/** Add a subscription, or correct the current period of one. The end date is shown live as the start
 * date or period changes; the service field remembers past services with their usual period and price. */
export function SubscriptionFormModal({
  open,
  editing,
  suggestions,
  onClose,
  onSaved
}: {
  open: boolean;
  editing: Subscription | null;
  suggestions: SubscriptionServiceSuggestion[];
  onClose: () => void;
  onSaved: (subscription: Subscription) => void;
}): React.JSX.Element {
  const { session } = usePermissions();
  const branchLocked = Boolean(session?.branch);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [startDate, setStartDate] = useState(localTodayIso());
  const [periodDays, setPeriodDays] = useState(String(DEFAULT_SUBSCRIPTION_PERIOD_DAYS));
  const [amount, setAmount] = useState("");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    void window.blueLedger.customer
      .list()
      .then(setCustomers)
      .catch(() => setCustomers([]));
    if (!branchLocked) {
      void window.blueLedger.location
        .list()
        .then(setLocations)
        .catch(() => setLocations([]));
    }
    setCustomerId(editing?.customerId ?? null);
    setCustomerSearch("");
    setServiceName(editing?.serviceName ?? "");
    setAccountNumber(editing?.accountNumber ?? "");
    setStartDate(editing?.startDate ?? localTodayIso());
    setPeriodDays(String(editing?.periodDays ?? DEFAULT_SUBSCRIPTION_PERIOD_DAYS));
    setAmount(editing?.amountCents != null ? fromCents(editing.amountCents) : "");
    setLocationId(editing?.locationId ?? "");
    setNotes(editing?.notes ?? "");
    setError(null);
  }, [open, editing, branchLocked]);

  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const customerMatches = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return [];
    return customers
      .filter((customer) => customer.status === "active")
      .filter((customer) => `${customer.name} ${customer.phone} ${customer.customerCode}`.toLowerCase().includes(term))
      .slice(0, 30);
  }, [customers, customerSearch]);

  const period = Number(periodDays);
  const periodValid = Number.isInteger(period) && period >= 1 && period <= 3660;
  const endDate = isValidDate(startDate) && periodValid ? endDateFor(startDate, period) : null;

  function pickService(name: string): void {
    setServiceName(name);
    // A remembered service fills in its usual period and price, unless they've already been changed.
    const match = suggestions.find((suggestion) => suggestion.serviceName.toLowerCase() === name.trim().toLowerCase());
    if (!match || editing) return;
    if (periodDays === String(DEFAULT_SUBSCRIPTION_PERIOD_DAYS)) setPeriodDays(String(match.periodDays));
    if (!amount && match.amountCents !== null) setAmount(fromCents(match.amountCents));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!customerId) return setError("Choose the customer.");
    if (!serviceName.trim()) return setError("Enter the service, e.g. DStv Compact.");
    if (!isValidDate(startDate)) return setError("Enter a valid start date.");
    if (!periodValid) return setError("The period must be between 1 and 3660 days.");
    setSaving(true);
    setError(null);
    const payload = {
      customerId,
      serviceName: serviceName.trim(),
      accountNumber: accountNumber.trim() || null,
      startDate,
      periodDays: period,
      amountCents: amount.trim() ? toCents(amount) : null,
      locationId: branchLocked ? null : locationId || null,
      notes: notes.trim() || null
    };
    try {
      const saved = editing
        ? await window.blueLedger.subscription.update(editing.id, payload)
        : await window.blueLedger.subscription.create(payload);
      showSuccessToast(editing ? "Subscription updated" : `Subscription added — ends ${formatSubscriptionDate(saved.endDate)}`);
      onSaved(saved);
    } catch (err) {
      const message = getErrorMessage(err, "Couldn't save this subscription");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={editing ? "Edit Subscription" : "New Subscription"}
        description="Track a customer's DStv, GOtv or other subscription. This only tracks it: ring up the payment at Checkout as usual."
        widthClassName="max-w-2xl"
      >
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          {error && <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>}

          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Customer<span className="text-danger"> *</span>
              </span>
              <button
                type="button"
                onClick={() => setQuickCreateOpen(true)}
                className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
              >
                <Plus className="size-3" aria-hidden="true" />
                New Customer
              </button>
            </div>
            {selectedCustomer ? (
              <div className="mt-1.5 flex items-center justify-between rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
                <div>
                  <p className="text-sm font-extrabold text-ink">{selectedCustomer.name}</p>
                  <p className="text-xs font-semibold text-muted">
                    {selectedCustomer.phone}
                    {selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomerId(null)}
                  aria-label="Change customer"
                  className="grid size-8 place-items-center rounded-lg text-muted hover:bg-white hover:text-ink cursor-pointer"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="relative mt-1.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  type="text"
                  autoFocus
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder="Search customer by name, phone or code"
                  className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
                {customerMatches.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-soft">
                    {customerMatches.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => {
                          setCustomerId(customer.id);
                          setCustomerSearch("");
                        }}
                        className="flex w-full items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-soft cursor-pointer"
                      >
                        <span className="font-bold text-ink">{customer.name}</span>
                        <span className="text-xs font-semibold text-muted">{customer.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Service<span className="text-danger"> *</span>
              </span>
              <input
                list="subscription-services"
                value={serviceName}
                onChange={(event) => pickService(event.target.value)}
                placeholder="e.g. DStv Compact"
                maxLength={120}
                className="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              <datalist id="subscription-services">
                {suggestions.map((suggestion) => (
                  <option key={suggestion.serviceName} value={suggestion.serviceName}>
                    {suggestion.periodDays} days
                  </option>
                ))}
              </datalist>
            </label>
            <Field label="Smartcard / IUC Number" value={accountNumber} onChange={setAccountNumber} placeholder="Optional" maxLength={60} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Start Date" type="date" value={startDate} onChange={setStartDate} required />
            <Field label="Period (days)" type="number" value={periodDays} onChange={setPeriodDays} required />
            <Field label="Amount (optional)" type="number" value={amount} onChange={setAmount} placeholder="0.00" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_PERIODS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setPeriodDays(String(days))}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold transition cursor-pointer ${
                  periodDays === String(days) ? "border-primary bg-primary text-white" : "border-line text-muted hover:border-accent"
                }`}
              >
                {days === 365 ? "1 year" : `${days} days`}
              </button>
            ))}
          </div>
          <div className="rounded-lg border border-dashed border-line bg-soft/60 px-4 py-3">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Ends on</p>
            <p className="mt-0.5 text-base font-extrabold text-ink">{endDate ? formatSubscriptionDate(endDate) : "—"}</p>
            {endDate && <p className="text-xs font-semibold text-muted">Reminders come due 7 days and 3 days before, on the day, and the day after.</p>}
          </div>

          {!branchLocked && locations.length > 0 && (
            <SelectField
              label="Storefront"
              value={locationId}
              onChange={setLocationId}
              options={[{ value: "", label: "Not tied to a storefront" }, ...locations.map((location) => ({ value: location.id, label: location.locationName }))]}
            />
          )}
          <TextAreaField label="Notes" value={notes} onChange={setNotes} rows={2} placeholder="Optional" />

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" onClick={onClose} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="h-9 text-xs">
              {saving && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
              {editing ? "Save Changes" : "Add Subscription"}
            </Button>
          </div>
        </form>
      </Modal>

      <QuickCreateCustomerModal
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        onCreated={(customer) => {
          setCustomers((prev) => [...prev, customer]);
          setCustomerId(customer.id);
          setQuickCreateOpen(false);
        }}
      />
    </>
  );
}
