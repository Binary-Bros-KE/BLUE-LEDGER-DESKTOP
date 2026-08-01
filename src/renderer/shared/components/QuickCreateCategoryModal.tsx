import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { CATEGORY_COLOR_SWATCHES, type Category } from "@shared/types/category";

/** The fast path for adding a category mid-product-creation — just a name. Color/sort order/parent
 * can be refined later from Categories; this always creates a plain top-level category with the
 * first swatch, same defaults the bulk-import auto-create path already uses. */
export function QuickCreateCategoryModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (category: Category) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setName("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const category = await window.blueLedger.category.create({
        name,
        description: null,
        color: CATEGORY_COLOR_SWATCHES[0]!.value,
        sortOrder: 0,
        parentId: null
      });
      reset();
      onCreated(category);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create category"));
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
      title="New Category"
      description="Just a name — pick a color and reorder it later from Categories."
      widthClassName="max-w-sm"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </div>
        )}

        <Field label="Category Name" value={name} onChange={setName} placeholder="e.g. Beverages" required />

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
