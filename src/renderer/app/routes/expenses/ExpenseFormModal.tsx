import { useEffect, useMemo, useState } from "react";
import { Loader2, Paperclip, Plus, X } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getDashboardVariant } from "@renderer/shared/lib/dashboard-role";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { Expense } from "@shared/types/expense";
import type { ExpenseCategory } from "@shared/types/expense-category";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { PaymentMethod } from "@shared/types/payment-method";
import { QuickCreateExpenseCategoryModal } from "./QuickCreateExpenseCategoryModal";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type FormState = {
  expenseDate: string;
  categoryId: string;
  amount: string;
  paymentMethodId: string;
  storefrontId: string;
  reference: string;
  description: string;
  attachmentPath: string | null;
};

function emptyForm(): FormState {
  return {
    expenseDate: todayIsoDate(),
    categoryId: "",
    amount: "",
    paymentMethodId: "",
    storefrontId: "",
    reference: "",
    description: "",
    attachmentPath: null
  };
}

function toFormState(expense: Expense): FormState {
  return {
    expenseDate: expense.expenseDate.slice(0, 10),
    categoryId: expense.categoryId,
    amount: fromCents(expense.amountCents),
    paymentMethodId: expense.paymentMethodId,
    storefrontId: expense.storefrontId ?? "",
    reference: expense.reference ?? "",
    description: expense.description ?? "",
    attachmentPath: expense.attachmentPath
  };
}

export function ExpenseFormModal({
  open,
  onClose,
  editingExpense,
  categories,
  locations,
  paymentMethods,
  canEdit,
  onCategoryCreated,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  editingExpense: Expense | null;
  categories: ExpenseCategory[];
  locations: Location[];
  paymentMethods: PaymentMethod[];
  canEdit: boolean;
  onCategoryCreated: (category: ExpenseCategory) => void;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const { session } = usePermissions();
  const isSuperAdmin = getDashboardVariant(session) === "superAdmin";

  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [quickCreateCategoryOpen, setQuickCreateCategoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readOnly = editingExpense !== null && (!canEdit || editingExpense.status === "archived");
  // A branch-scoped Manager can only ever record/see an expense against THEIR OWN storefront — the
  // field is locked (never a blank/other-branch pick) whether creating new or editing an existing one.
  const storefrontLocked = !isSuperAdmin;

  /** Always the logged-in employee — never manually typed, same as Local Purchases' own "Bought By".
   * On create it's whoever is submitting the form; on edit it stays whatever was originally
   * recorded, since editing metadata later isn't the same as having made the payment. */
  const paidByName = editingExpense
    ? (editingExpense.paidBy ?? "—")
    : `${session?.employee.firstName ?? ""} ${session?.employee.lastName ?? ""}`.trim() || "—";

  useEffect(() => {
    if (!open) return;
    if (editingExpense) {
      setForm(toFormState(editingExpense));
    } else {
      setForm({ ...emptyForm(), storefrontId: isSuperAdmin ? "" : (session?.branch?.id ?? "") });
    }
    setError(null);
  }, [open, editingExpense, isSuperAdmin, session?.branch?.id]);

  const activeCategories = useMemo(() => categories.filter((category) => category.status === "active"), [categories]);
  const activePaymentMethods = useMemo(
    () => paymentMethods.filter((method) => method.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [paymentMethods]
  );
  // Main Store isn't a selling till — an expense belongs to a real storefront, never a "General"
  // catch-all or the warehouse.
  const storefronts = useMemo(() => locations.filter((location) => isStorefrontType(location.locationType)), [locations]);
  const formStorefrontOptions = useMemo(
    () => (isSuperAdmin ? storefronts : storefronts.filter((location) => location.id === session?.branch?.id)),
    [storefronts, isSuperAdmin, session?.branch?.id]
  );
  const selectedPaymentMethod = activePaymentMethods.find((method) => method.id === form.paymentMethodId) ?? null;

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handlePickAttachment(): Promise<void> {
    setAttachmentBusy(true);
    setError(null);
    try {
      const relativePath = await window.blueLedger.expense.pickAttachment();
      if (relativePath) updateField("attachmentPath", relativePath);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to attach file");
      setError(message);
      showErrorToast(message);
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function handleOpenAttachment(): Promise<void> {
    if (!form.attachmentPath) return;
    try {
      await window.blueLedger.expense.openAttachment(form.attachmentPath);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to open attachment");
      setError(message);
      showErrorToast(message);
    }
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      expenseDate: form.expenseDate,
      categoryId: form.categoryId,
      amountCents: toCents(form.amount),
      paidBy: paidByName,
      paymentMethodId: form.paymentMethodId,
      storefrontId: form.storefrontId,
      reference: form.reference,
      description: form.description,
      attachmentPath: form.attachmentPath
    };

    try {
      if (editingExpense) {
        await window.blueLedger.expense.update(editingExpense.id, payload);
      } else {
        await window.blueLedger.expense.create(payload);
      }
      showSuccessToast(editingExpense ? "Expense updated" : "Expense created");
      await onSaved();
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save expense");
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
        title={editingExpense ? editingExpense.expenseNumber : "New Expense"}
        description={
          readOnly
            ? "This expense can't be edited."
            : "Category, storefront, payment method, and amount are required — everything else can be filled in as needed."
        }
        widthClassName="max-w-lg"
      >
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Expense Date"
              type="date"
              value={form.expenseDate}
              onChange={(value) => updateField("expenseDate", value)}
              required
              disabled={readOnly}
            />
            <Field
              label="Amount"
              type="number"
              value={form.amount}
              onChange={(value) => updateField("amount", value)}
              placeholder="0.00"
              required
              disabled={readOnly}
            />
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Category</span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setQuickCreateCategoryOpen(true)}
                  className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
                >
                  <Plus className="size-3" aria-hidden="true" />
                  New Category
                </button>
              )}
            </div>
            <select
              value={form.categoryId}
              onChange={(event) => updateField("categoryId", event.target.value)}
              disabled={readOnly}
              className="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-soft disabled:text-muted"
            >
              <option value="">Select category</option>
              {activeCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Payment Method"
              value={form.paymentMethodId}
              onChange={(value) => updateField("paymentMethodId", value)}
              options={[
                { value: "", label: "Select payment method" },
                ...activePaymentMethods.map((method) => ({ value: method.id, label: method.name }))
              ]}
              className={readOnly ? "pointer-events-none opacity-60" : ""}
            />
            <SelectField
              label="Storefront"
              value={form.storefrontId}
              onChange={(value) => updateField("storefrontId", value)}
              options={[
                { value: "", label: "Select storefront" },
                ...formStorefrontOptions.map((location) => ({ value: location.id, label: location.locationName }))
              ]}
              className={readOnly ? "pointer-events-none opacity-60" : ""}
              disabled={readOnly || storefrontLocked}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Paid By" value={paidByName} onChange={() => {}} disabled />
            <Field
              label={selectedPaymentMethod?.requiresReference ? "Reference" : "Reference (optional)"}
              value={form.reference}
              onChange={(value) => updateField("reference", value)}
              placeholder="Transaction code, cheque #, bank ref"
              required={Boolean(selectedPaymentMethod?.requiresReference)}
              disabled={readOnly}
            />
          </div>

          <TextAreaField
            label="Description"
            value={form.description}
            onChange={(value) => updateField("description", value)}
            placeholder="What was this expense for?"
            className="mt-4"
            rows={2}
          />

          {!readOnly && (
            <div className="mt-4">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Attachment</span>
              <div className="mt-1.5 flex items-center gap-2">
                {form.attachmentPath ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleOpenAttachment()}
                      className="flex flex-1 items-center gap-2 truncate rounded-lg border border-line bg-soft px-3.5 py-2.5 text-left text-sm font-bold text-ink hover:bg-soft/70 cursor-pointer"
                    >
                      <Paperclip className="size-3.5 flex-none text-muted" aria-hidden="true" />
                      <span className="truncate">View attached document</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateField("attachmentPath", null)}
                      aria-label="Remove attachment"
                      className="grid size-9 flex-none place-items-center rounded-lg border border-line text-muted hover:bg-danger-soft hover:text-danger cursor-pointer"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <Button
                    type="button"
                    onClick={() => void handlePickAttachment()}
                    disabled={attachmentBusy}
                    className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {attachmentBusy ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Paperclip className="mr-1.5 size-3.5" aria-hidden="true" />
                    )}
                    Attach Receipt / Invoice
                  </Button>
                )}
              </div>
            </div>
          )}

          {form.attachmentPath && readOnly && (
            <button
              type="button"
              onClick={() => void handleOpenAttachment()}
              className="mt-4 flex w-full items-center gap-2 rounded-lg border border-line bg-soft px-3.5 py-2.5 text-left text-sm font-bold text-ink hover:bg-soft/70 cursor-pointer"
            >
              <Paperclip className="size-3.5 flex-none text-muted" aria-hidden="true" />
              View attached document
            </button>
          )}

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={onClose}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={saving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                {saving ? "Saving..." : editingExpense ? "Save changes" : "Create Expense"}
              </Button>
            )}
          </div>
        </form>
      </Modal>

      <QuickCreateExpenseCategoryModal
        open={quickCreateCategoryOpen}
        onClose={() => setQuickCreateCategoryOpen(false)}
        onCreated={(category) => {
          onCategoryCreated(category);
          updateField("categoryId", category.id);
          setQuickCreateCategoryOpen(false);
        }}
      />
    </>
  );
}
