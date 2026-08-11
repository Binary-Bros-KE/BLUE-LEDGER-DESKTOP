import { useEffect, useMemo, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getDashboardVariant } from "@renderer/shared/lib/dashboard-role";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { fromCents, toCents } from "@renderer/shared/lib/money";
import type { Expense } from "@shared/types/expense";
import type { ExpenseCategory } from "@shared/types/expense-category";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { PaymentMethod } from "@shared/types/payment-method";

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

function toFormState(purchase: Expense): FormState {
  return {
    expenseDate: purchase.expenseDate.slice(0, 10),
    categoryId: purchase.categoryId,
    amount: fromCents(purchase.amountCents),
    paymentMethodId: purchase.paymentMethodId,
    storefrontId: purchase.storefrontId ?? "",
    reference: purchase.reference ?? "",
    description: purchase.description ?? "",
    attachmentPath: purchase.attachmentPath
  };
}

/** Mirrors ExpenseFormModal but posts to the "local-purchase:*" IPC namespace and drops the
 * quick-create-category shortcut — categories stay a shared, admin-managed list (see
 * expense-category-service.ts's listExpenseCategories doc comment), and a Cashier holding only
 * "local_purchases" never holds "expense_categories" so that create would just fail anyway. */
export function LocalPurchaseFormModal({
  open,
  onClose,
  editingPurchase,
  categories,
  locations,
  paymentMethods,
  canEdit,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  editingPurchase: Expense | null;
  categories: ExpenseCategory[];
  locations: Location[];
  paymentMethods: PaymentMethod[];
  canEdit: boolean;
  onSaved: () => Promise<void>;
}): React.JSX.Element {
  const { session } = usePermissions();
  const isSuperAdmin = getDashboardVariant(session) === "superAdmin";

  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readOnly = editingPurchase !== null && (!canEdit || editingPurchase.status === "archived");
  const storefrontLocked = !isSuperAdmin;

  /** Always the logged-in employee — never manually typed. On create it's whoever is submitting
   * the form; on edit it stays whatever was originally recorded, since editing metadata later
   * isn't the same as having made the purchase. */
  const boughtByName = editingPurchase
    ? (editingPurchase.paidBy ?? "—")
    : `${session?.employee.firstName ?? ""} ${session?.employee.lastName ?? ""}`.trim() || "—";

  useEffect(() => {
    if (!open) return;
    if (editingPurchase) {
      setForm(toFormState(editingPurchase));
    } else {
      setForm({ ...emptyForm(), storefrontId: isSuperAdmin ? "" : (session?.branch?.id ?? "") });
    }
    setError(null);
  }, [open, editingPurchase, isSuperAdmin, session?.branch?.id]);

  const activeCategories = useMemo(() => categories.filter((category) => category.status === "active"), [categories]);
  const activePaymentMethods = useMemo(
    () => paymentMethods.filter((method) => method.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [paymentMethods]
  );
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
      const relativePath = await window.blueLedger.localPurchase.pickAttachment();
      if (relativePath) updateField("attachmentPath", relativePath);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to attach file"));
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function handleOpenAttachment(): Promise<void> {
    if (!form.attachmentPath) return;
    try {
      await window.blueLedger.localPurchase.openAttachment(form.attachmentPath);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to open attachment"));
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
      paidBy: boughtByName,
      paymentMethodId: form.paymentMethodId,
      storefrontId: form.storefrontId,
      reference: form.reference,
      description: form.description,
      attachmentPath: form.attachmentPath
    };

    try {
      if (editingPurchase) {
        await window.blueLedger.localPurchase.update(editingPurchase.id, payload);
      } else {
        await window.blueLedger.localPurchase.create(payload);
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save daily expense"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingPurchase ? editingPurchase.expenseNumber : "New Daily Expense"}
      description={
        readOnly
          ? "This daily expense can't be edited."
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
            label="Date"
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

        <SelectField
          label="Category"
          value={form.categoryId}
          onChange={(value) => updateField("categoryId", value)}
          options={[
            { value: "", label: "Select category" },
            ...activeCategories.map((category) => ({ value: category.id, label: category.name }))
          ]}
          className={readOnly ? "pointer-events-none opacity-60" : ""}
        />

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
          <Field label="Bought By" value={boughtByName} onChange={() => {}} disabled />
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
          placeholder="What was bought?"
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
                  Attach Receipt
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
              {saving ? "Saving..." : editingPurchase ? "Save changes" : "Create Daily Expense"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
