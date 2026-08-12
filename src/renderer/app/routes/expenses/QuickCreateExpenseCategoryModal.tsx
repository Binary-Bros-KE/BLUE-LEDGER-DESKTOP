import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { ExpenseCategory } from "@shared/types/expense-category";

/** The fast path for adding a category mid-expense-entry — full management (edit, activate,
 * deactivate) lives in the "Manage Categories" screen. */
export function QuickCreateExpenseCategoryModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (category: ExpenseCategory) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setName("");
    setDescription("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const category = await window.blueLedger.expenseCategory.create({ name, description });
      showSuccessToast(`Category "${category.name}" created`);
      reset();
      onCreated(category);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to create category");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New Expense Category"
      description="Add a spending bucket on the fly — refine it later from Manage Categories."
      widthClassName="max-w-sm"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <Field label="Name" value={name} onChange={setName} placeholder="e.g. Fuel" required />
          <TextAreaField
            label="Description (optional)"
            value={description}
            onChange={setDescription}
            placeholder="What this category covers"
            rows={2}
          />
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
          <Button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? "Creating..." : "Create Category"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
