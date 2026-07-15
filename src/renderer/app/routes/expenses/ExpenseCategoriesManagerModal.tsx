import { useState } from "react";
import { Loader2, Pencil, Plus, Power, PowerOff } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import type { ExpenseCategory } from "@shared/types/expense-category";

type FormState = { name: string; description: string };

const emptyForm: FormState = { name: "", description: "" };

export function ExpenseCategoriesManagerModal({
  open,
  onClose,
  categories,
  canManage,
  onChanged
}: {
  open: boolean;
  onClose: () => void;
  categories: ExpenseCategory[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function openCreateForm(): void {
    setEditingCategory(null);
    setForm(emptyForm);
    setError(null);
    setFormOpen(true);
  }

  function openEditForm(category: ExpenseCategory): void {
    setEditingCategory(category);
    setForm({ name: category.name, description: category.description ?? "" });
    setError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingCategory) {
        await window.blueLedger.expenseCategory.update(editingCategory.id, form);
      } else {
        await window.blueLedger.expenseCategory.create(form);
      }
      setFormOpen(false);
      await onChanged();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save category"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(category: ExpenseCategory): Promise<void> {
    setActionError(null);
    try {
      await window.blueLedger.expenseCategory.setStatus(
        category.id,
        category.status === "active" ? "inactive" : "active"
      );
      await onChanged();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to update status"));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage Expense Categories"
      description="Inactive categories drop out of selection lists but stay on any expense that already used them."
      widthClassName="max-w-lg"
    >
      {actionError && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
          {actionError}
        </div>
      )}

      {!formOpen && canManage && (
        <div className="mb-3 flex justify-end">
          <Button type="button" onClick={openCreateForm} className="h-9 text-xs">
            <Plus className="mr-1.5 size-4" aria-hidden="true" />
            New Category
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
          <div className="space-y-3">
            <Field
              label="Name"
              value={form.name}
              onChange={(value) => setForm((prev) => ({ ...prev, name: value }))}
              placeholder="e.g. Fuel"
              required
            />
            <TextAreaField
              label="Description (optional)"
              value={form.description}
              onChange={(value) => setForm((prev) => ({ ...prev, description: value }))}
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
              {saving ? "Saving..." : editingCategory ? "Save changes" : "Create Category"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          {categories.length === 0 ? (
            <p className="py-6 text-center text-sm font-semibold text-muted">No categories yet.</p>
          ) : (
            categories.map((category) => (
              <div
                key={category.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-extrabold text-ink">{category.name}</p>
                    <DashedPill tone={category.status === "active" ? "success" : "neutral"}>
                      {category.status === "active" ? "Active" : "Inactive"}
                    </DashedPill>
                  </div>
                  {category.description && (
                    <p className="truncate text-xs font-semibold text-muted">{category.description}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex flex-none items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditForm(category)}
                      aria-label={`Edit ${category.name}`}
                      className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleStatus(category)}
                      aria-label={category.status === "active" ? `Deactivate ${category.name}` : `Activate ${category.name}`}
                      className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                    >
                      {category.status === "active" ? (
                        <PowerOff className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Power className="size-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </Modal>
  );
}
