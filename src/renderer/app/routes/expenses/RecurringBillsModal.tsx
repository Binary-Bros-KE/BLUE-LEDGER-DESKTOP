import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronsRight, Loader2, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { useConfirm } from "@renderer/shared/components/ConfirmModal";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getDashboardVariant } from "@renderer/shared/lib/dashboard-role";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, toCents, fromCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { ExpenseCategory } from "@shared/types/expense-category";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { PaymentMethod } from "@shared/types/payment-method";
import { RECURRING_BILL_CYCLE_OPTIONS, type RecurringBill } from "@shared/types/recurring-bill";

type FormState = {
  name: string;
  categoryId: string;
  storefrontId: string;
  amount: string;
  cycle: RecurringBill["cycle"];
  startDate: string;
  notes: string;
};

function emptyForm(): FormState {
  return {
    name: "",
    categoryId: "",
    storefrontId: "",
    amount: "",
    cycle: "monthly",
    startDate: new Date().toISOString().slice(0, 10),
    notes: ""
  };
}

function toFormState(bill: RecurringBill): FormState {
  return {
    name: bill.name,
    categoryId: bill.categoryId,
    storefrontId: bill.storefrontId,
    amount: fromCents(bill.amountCents),
    cycle: bill.cycle,
    startDate: bill.startDate.slice(0, 10),
    notes: bill.notes ?? ""
  };
}

function reminderTone(bill: RecurringBill): "danger" | "warning" | "neutral" {
  if (bill.status === "paused") return "neutral";
  if (bill.reminderStatus === "overdue") return "danger";
  if (bill.reminderStatus === "due_soon") return "warning";
  return "neutral";
}

function reminderLabel(bill: RecurringBill): string {
  if (bill.status === "paused") return "Paused";
  if (bill.reminderStatus === "overdue") return `Overdue by ${Math.abs(bill.daysUntilDue)}d`;
  if (bill.reminderStatus === "due_soon") return bill.daysUntilDue === 0 ? "Due today" : `Due in ${bill.daysUntilDue}d`;
  return "Upcoming";
}

export function RecurringBillsModal({
  open,
  onClose,
  categories,
  storefronts,
  paymentMethods,
  canManage
}: {
  open: boolean;
  onClose: () => void;
  categories: ExpenseCategory[];
  storefronts: Location[];
  paymentMethods: PaymentMethod[];
  canManage: boolean;
}): React.JSX.Element {
  const confirm = useConfirm();
  const { session } = usePermissions();
  const isSuperAdmin = getDashboardVariant(session) === "superAdmin";

  const [bills, setBills] = useState<RecurringBill[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<RecurringBill | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [payingBill, setPayingBill] = useState<RecurringBill | null>(null);
  const [payPaymentMethodId, setPayPaymentMethodId] = useState("");
  const [payReference, setPayReference] = useState("");
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const activePaymentMethods = paymentMethods.filter((method) => method.isActive);
  const selectedPayMethod = activePaymentMethods.find((method) => method.id === payPaymentMethodId) ?? null;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await window.blueLedger.recurringBill.list();
      setBills(list);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load recurring bills"));
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // A branch-scoped Manager can only ever schedule/see a recurring bill against THEIR OWN storefront.
  const storefrontOptions = storefronts
    .filter((location) => isStorefrontType(location.locationType))
    .filter((location) => isSuperAdmin || location.id === session?.branch?.id);

  function openCreateForm(): void {
    setEditingBill(null);
    setForm({ ...emptyForm(), storefrontId: isSuperAdmin ? "" : (session?.branch?.id ?? "") });
    setError(null);
    setFormOpen(true);
  }

  function openEditForm(bill: RecurringBill): void {
    setEditingBill(bill);
    setForm(toFormState(bill));
    setError(null);
    setFormOpen(true);
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name,
      categoryId: form.categoryId,
      storefrontId: form.storefrontId,
      amountCents: toCents(form.amount),
      cycle: form.cycle,
      startDate: form.startDate,
      notes: form.notes
    };

    try {
      if (editingBill) {
        await window.blueLedger.recurringBill.update(editingBill.id, payload);
      } else {
        await window.blueLedger.recurringBill.create(payload);
      }
      setFormOpen(false);
      await load();
      showSuccessToast(editingBill ? "Recurring bill updated" : "Recurring bill created");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save recurring bill");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(bill: RecurringBill): Promise<void> {
    setActionError(null);
    try {
      const nextStatus = bill.status === "active" ? "paused" : "active";
      await window.blueLedger.recurringBill.setStatus(bill.id, nextStatus);
      await load();
      showSuccessToast(nextStatus === "active" ? "Recurring bill resumed" : "Recurring bill paused");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to update status");
      setActionError(message);
      showErrorToast(message);
    }
  }

  async function handlePushWithoutPaying(bill: RecurringBill): Promise<void> {
    const confirmed = await confirm({
      title: "Push to next cycle without paying?",
      message: `"${bill.name}" will roll forward to its next due date with no expense recorded. Use "Mark as Paid" instead if it was actually paid.`,
      confirmLabel: "Push Forward"
    });
    if (!confirmed) return;

    setActionError(null);
    try {
      await window.blueLedger.recurringBill.advance(bill.id);
      await load();
      showSuccessToast(`${bill.name} rolled forward to its next cycle`);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to advance recurring bill");
      setActionError(message);
      showErrorToast(message);
    }
  }

  function openPayForm(bill: RecurringBill): void {
    setPayingBill(bill);
    setPayPaymentMethodId("");
    setPayReference("");
    setPayError(null);
  }

  async function handleMarkPaid(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!payingBill) return;
    setPaySaving(true);
    setPayError(null);
    try {
      await window.blueLedger.recurringBill.markPaid(payingBill.id, {
        paymentMethodId: payPaymentMethodId,
        reference: payReference
      });
      showSuccessToast(`${payingBill.name} recorded as paid and rolled forward`);
      setPayingBill(null);
      await load();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to record payment");
      setPayError(message);
      showErrorToast(message);
    } finally {
      setPaySaving(false);
    }
  }

  async function handleDelete(bill: RecurringBill): Promise<void> {
    const confirmed = await confirm({
      title: "Delete recurring bill?",
      message: `This removes "${bill.name}" and its reminder schedule. This can't be undone.`,
      tone: "danger",
      confirmLabel: "Delete"
    });
    if (!confirmed) return;

    setActionError(null);
    try {
      await window.blueLedger.recurringBill.delete(bill.id);
      await load();
      showSuccessToast("Recurring bill deleted");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to delete recurring bill");
      setActionError(message);
      showErrorToast(message);
    }
  }

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title="Recurring Bills"
      description="A reminder schedule — nothing is recorded until you say so. Use “Mark as Paid” once it's actually paid to record the expense and roll the reminder forward in one step."
      widthClassName="max-w-2xl"
    >
      {actionError && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
          {actionError}
        </div>
      )}
      {loadError && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
          {loadError}
        </div>
      )}

      {!formOpen && canManage && (
        <div className="mb-3 flex justify-end">
          <Button type="button" onClick={openCreateForm} className="h-9 text-xs">
            <Plus className="mr-1.5 size-4" aria-hidden="true" />
            New Recurring Bill
          </Button>
        </div>
      )}

      {formOpen ? (
        <form onSubmit={handleSubmit} className="rounded-lg border border-line bg-soft/60 p-3.5">
          {error && (
            <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Name"
              value={form.name}
              onChange={(value) => updateField("name", value)}
              placeholder="e.g. Office Rent"
              required
              className="sm:col-span-2"
            />
            <SelectField
              label="Category"
              value={form.categoryId}
              onChange={(value) => updateField("categoryId", value)}
              options={[{ value: "", label: "Select category" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            />
            <SelectField
              label="Storefront"
              value={form.storefrontId}
              onChange={(value) => updateField("storefrontId", value)}
              options={[
                { value: "", label: "Select storefront" },
                ...storefrontOptions.map((location) => ({ value: location.id, label: location.locationName }))
              ]}
              disabled={!isSuperAdmin}
            />
            <Field
              label="Amount"
              type="number"
              value={form.amount}
              onChange={(value) => updateField("amount", value)}
              placeholder="0.00"
              required
            />
            <SelectField
              label="Cycle"
              value={form.cycle}
              onChange={(value) => updateField("cycle", value as RecurringBill["cycle"])}
              options={RECURRING_BILL_CYCLE_OPTIONS}
            />
            <Field
              label="Begin Date"
              type="date"
              value={form.startDate}
              onChange={(value) => updateField("startDate", value)}
              required
            />
            <TextAreaField
              label="Notes"
              value={form.notes}
              onChange={(value) => updateField("notes", value)}
              placeholder="Optional context — account number, contact, etc."
              className="sm:col-span-2"
              rows={2}
            />
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              onClick={() => setFormOpen(false)}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {saving ? "Saving..." : editingBill ? "Save changes" : "Create Recurring Bill"}
            </Button>
          </div>
        </form>
      ) : bills === null ? (
        <div className="flex min-h-[160px] items-center justify-center text-muted">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        </div>
      ) : bills.length === 0 ? (
        <p className="py-6 text-center text-sm font-semibold text-muted">No recurring bills set up yet.</p>
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
          {bills.map((bill) => (
            <div key={bill.id} className="rounded-lg border border-line px-3.5 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-extrabold text-ink">{bill.name}</p>
                    <DashedPill tone={reminderTone(bill)}>{reminderLabel(bill)}</DashedPill>
                  </div>
                  <p className="text-xs font-semibold text-muted">
                    {formatCents(bill.amountCents)} · {RECURRING_BILL_CYCLE_OPTIONS.find((o) => o.value === bill.cycle)?.label} ·{" "}
                    {bill.categoryName} · {bill.storefrontName}
                  </p>
                  <p className="text-[11px] font-semibold text-muted">
                    Next due {new Date(bill.nextDueDate).toLocaleDateString()}
                  </p>
                </div>
                {canManage && (
                  <div className="flex flex-none items-center gap-1.5">
                    {bill.status === "active" && (
                      <>
                        <button
                          type="button"
                          onClick={() => openPayForm(bill)}
                          aria-label={`Mark ${bill.name} paid`}
                          title="Mark as Paid — records the expense and rolls to next cycle"
                          className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-success/15 hover:text-success cursor-pointer"
                        >
                          <CheckCircle2 className="size-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handlePushWithoutPaying(bill)}
                          aria-label={`Push ${bill.name} to next cycle without paying`}
                          title="Push to next cycle without paying"
                          className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                        >
                          <ChevronsRight className="size-3.5" aria-hidden="true" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditForm(bill)}
                      aria-label={`Edit ${bill.name}`}
                      className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleStatus(bill)}
                      aria-label={bill.status === "active" ? `Pause ${bill.name}` : `Resume ${bill.name}`}
                      className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                    >
                      {bill.status === "active" ? (
                        <PowerOff className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Power className="size-3.5" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(bill)}
                      aria-label={`Delete ${bill.name}`}
                      className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>

    {payingBill && (
        <Modal
          open
          onClose={() => setPayingBill(null)}
          title={`Mark "${payingBill.name}" as Paid`}
          description={`Records ${formatCents(payingBill.amountCents)} as a real expense (${payingBill.categoryName} · ${payingBill.storefrontName}) and rolls the reminder forward to its next cycle.`}
          widthClassName="max-w-sm"
        >
          <form onSubmit={handleMarkPaid}>
            {payError && (
              <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
                {payError}
              </div>
            )}
            <div className="space-y-3">
              <SelectField
                label="Payment Method"
                value={payPaymentMethodId}
                onChange={setPayPaymentMethodId}
                options={[
                  { value: "", label: "Select payment method" },
                  ...activePaymentMethods.map((method) => ({ value: method.id, label: method.name }))
                ]}
              />
              {selectedPayMethod?.requiresReference && (
                <Field
                  label="Reference"
                  value={payReference}
                  onChange={setPayReference}
                  placeholder="Transaction/reference number"
                  required
                />
              )}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2 border-t border-line pt-4">
              <Button
                type="button"
                onClick={() => setPayingBill(null)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={paySaving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
                {paySaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                {paySaving ? "Saving..." : "Confirm Paid"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
