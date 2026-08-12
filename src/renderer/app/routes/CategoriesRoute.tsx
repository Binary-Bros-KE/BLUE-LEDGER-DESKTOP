import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FolderTree, Loader2, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import {
  CATEGORY_COLOR_SWATCHES,
  type Category,
  type CategoryLevel,
  type CategoryTreeNode
} from "@shared/types/category";

type FormState = {
  name: string;
  description: string;
  color: string;
  sortOrder: string;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  color: CATEGORY_COLOR_SWATCHES[0].value,
  sortOrder: "0"
};

function toFormState(category: Category): FormState {
  return {
    name: category.name,
    description: category.description ?? "",
    color: category.color,
    sortOrder: String(category.sortOrder)
  };
}

type ParentContext = {
  parentId: string | null;
  parentLabel: string;
  level: CategoryLevel;
};

function buildCategoryTree(categories: Category[]): CategoryTreeNode[] {
  const byId = new Map<string, CategoryTreeNode>();
  categories.forEach((category) => byId.set(category.id, { ...category, children: [] }));

  const roots: CategoryTreeNode[] = [];
  categories.forEach((category) => {
    const node = byId.get(category.id);
    if (!node) return;
    const parent = category.parentId ? byId.get(category.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  function sortRec(nodes: CategoryTreeNode[]): void {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    nodes.forEach((node) => sortRec(node.children));
  }
  sortRec(roots);

  return roots;
}

function countDescendants(node: CategoryTreeNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}

export function CategoriesRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("categories", "create");
  const canEdit = can("categories", "edit");
  const canDelete = can("categories", "delete");

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [parentContext, setParentContext] = useState<ParentContext>({
    parentId: null,
    parentLabel: "Top level",
    level: 1
  });
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await window.blueLedger.category.list();
      setCategories(list);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load categories");
      setLoadError(message);
      showErrorToast(message);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const tree = useMemo(() => buildCategoryTree(categories ?? []), [categories]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreateModal(): void {
    setEditingId(null);
    setParentContext({ parentId: null, parentLabel: "Top level", level: 1 });
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  }

  function openAddChildModal(node: CategoryTreeNode): void {
    setEditingId(null);
    setParentContext({
      parentId: node.id,
      parentLabel: node.name,
      level: (node.level + 1) as CategoryLevel
    });
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  }

  function openEditModal(node: CategoryTreeNode, parentLabel: string): void {
    setEditingId(node.id);
    setParentContext({ parentId: node.parentId, parentLabel, level: node.level });
    setForm(toFormState(node));
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (editingId) {
        await window.blueLedger.category.update(editingId, form);
        showSuccessToast(`Category "${form.name}" updated`);
      } else {
        await window.blueLedger.category.create({ ...form, parentId: parentContext.parentId });
        showSuccessToast(`Category "${form.name}" created`);
      }
      await loadCategories();
      setModalOpen(false);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save category");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(node: CategoryTreeNode): Promise<void> {
    const nextStatus = node.status === "active" ? "inactive" : "active";
    try {
      await window.blueLedger.category.setStatus(node.id, nextStatus);
      showSuccessToast(`Category "${node.name}" ${nextStatus === "active" ? "activated" : "deactivated"}`);
      await loadCategories();
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to update status"));
    }
  }

  async function handleDelete(node: CategoryTreeNode): Promise<void> {
    if (node.children.length > 0) return;
    if (!window.confirm(`Delete "${node.name}"? This can't be undone.`)) return;
    try {
      await window.blueLedger.category.delete(node.id);
      showSuccessToast(`Category "${node.name}" deleted`);
      await loadCategories();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to delete category");
      setError(message);
      showErrorToast(message);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative mt-6 space-y-5 pb-10 pl-4"
    >
      <span
        className="pointer-events-none absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-2 left-0 top-2 border-l-2 border-dashed border-line"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -left-[5px] bottom-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-violet-600">
              Categories
            </p>
            <h2 className="mt-1 text-xl font-extrabold">Product catalog structure</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Up to three levels deep — organize your catalog before adding products.
            </p>
          </div>
          {canCreate && (
            <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              New Category
            </Button>
          )}
        </div>

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <p className="text-sm font-bold text-danger">{loadError}</p>
              <Button type="button" onClick={() => void loadCategories()} className="mt-4 h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : categories === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : tree.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <FolderTree className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No categories yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Create your first top-level category — you can nest up to two more levels beneath it.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Category
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              {tree.map((node) => (
                <CategoryRow
                  key={node.id}
                  node={node}
                  depth={0}
                  parentLabel="Top level"
                  canCreate={canCreate}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onAddChild={openAddChildModal}
                  onEdit={openEditModal}
                  onToggleStatus={(n) => void handleToggleStatus(n)}
                  onDelete={(n) => void handleDelete(n)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit category" : "New category"}
        description={
          editingId
            ? `Level ${parentContext.level} · Parent: ${parentContext.parentLabel}`
            : `This will be a Level ${parentContext.level} category under "${parentContext.parentLabel}".`
        }
      >
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <Field
              label="Category Name"
              value={form.name}
              onChange={(value) => updateField("name", value)}
              placeholder="e.g. Beverages"
              required
            />
            <TextAreaField
              label="Description"
              value={form.description}
              onChange={(value) => updateField("description", value)}
              placeholder="e.g. All cold and hot drinks sold across branches"
            />
            <Field
              label="Sort Order"
              type="number"
              value={form.sortOrder}
              onChange={(value) => updateField("sortOrder", value)}
              placeholder="0"
            />

            <div>
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Color Tag
              </span>
              <div className="mt-2 flex flex-wrap gap-2.5">
                {CATEGORY_COLOR_SWATCHES.map((swatch) => (
                  <button
                    key={swatch.value}
                    type="button"
                    title={swatch.label}
                    aria-label={`Color: ${swatch.label}`}
                    onClick={() => updateField("color", swatch.value)}
                    className={cn(
                      "size-8 flex-none rounded-full border-2 shadow-stamp transition cursor-pointer",
                      form.color === swatch.value
                        ? "scale-110 border-ink"
                        : "border-white/80 hover:scale-105"
                    )}
                    style={{ backgroundColor: swatch.value }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
            <Button
              type="button"
              onClick={() => setModalOpen(false)}
              className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {saving ? "Saving..." : editingId ? "Save changes" : "Create category"}
            </Button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}

function CategoryRow({
  node,
  depth,
  parentLabel,
  canCreate,
  canEdit,
  canDelete,
  onAddChild,
  onEdit,
  onToggleStatus,
  onDelete
}: {
  node: CategoryTreeNode;
  depth: number;
  parentLabel: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onAddChild: (node: CategoryTreeNode) => void;
  onEdit: (node: CategoryTreeNode, parentLabel: string) => void;
  onToggleStatus: (node: CategoryTreeNode) => void;
  onDelete: (node: CategoryTreeNode) => void;
}): React.JSX.Element {
  const hasChildren = node.children.length > 0;
  const descendantCount = countDescendants(node);

  return (
    <div>
      <div
        className="flex items-center gap-3 rounded-lg border border-line bg-white py-2.5 pl-3 pr-3 shadow-stamp transition hover:shadow-soft"
        style={{ marginLeft: depth * 28, borderLeftWidth: 4, borderLeftColor: node.color }}
      >
        <span
          className="size-2.5 flex-none rounded-full"
          style={{ backgroundColor: node.color }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold">{node.name}</p>
          {node.description && (
            <p className="truncate text-xs font-semibold text-muted">{node.description}</p>
          )}
        </div>
        {descendantCount > 0 && (
          <span className="hidden text-[11px] font-bold uppercase tracking-wide text-muted sm:inline">
            {descendantCount} sub{descendantCount === 1 ? "" : "s"}
          </span>
        )}
        <DashedPill tone={node.status === "active" ? "success" : "neutral"}>{node.status}</DashedPill>
        <div className="flex flex-none items-center gap-1.5">
          {node.level < 3 && canCreate && (
            <IconButton onClick={() => onAddChild(node)} label={`Add subcategory to ${node.name}`}>
              <Plus className="size-3.5" aria-hidden="true" />
            </IconButton>
          )}
          {canEdit && (
            <IconButton onClick={() => onEdit(node, parentLabel)} label={`Edit ${node.name}`}>
              <Pencil className="size-3.5" aria-hidden="true" />
            </IconButton>
          )}
          {canEdit && (
            <IconButton
              onClick={() => onToggleStatus(node)}
              label={node.status === "active" ? `Deactivate ${node.name}` : `Activate ${node.name}`}
              tone={node.status === "active" ? "danger" : "success"}
            >
              {node.status === "active" ? (
                <PowerOff className="size-3.5" aria-hidden="true" />
              ) : (
                <Power className="size-3.5" aria-hidden="true" />
              )}
            </IconButton>
          )}
          {canDelete && (
            <IconButton
              onClick={() => onDelete(node)}
              label={hasChildren ? `Delete subcategories of ${node.name} first` : `Delete ${node.name}`}
              tone="danger"
              disabled={hasChildren}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </div>
      {hasChildren && (
        <div className="mt-1.5 space-y-1.5">
          {node.children.map((child) => (
            <CategoryRow
              key={child.id}
              node={child}
              depth={depth + 1}
              parentLabel={node.name}
              canCreate={canCreate}
              canEdit={canEdit}
              canDelete={canDelete}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onToggleStatus={onToggleStatus}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function IconButton({
  onClick,
  label,
  tone = "muted",
  disabled = false,
  children
}: {
  onClick: () => void;
  label: string;
  tone?: "muted" | "success" | "danger";
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const toneClass = {
    muted: "border-line text-muted hover:bg-soft hover:text-ink",
    success: "border-line text-muted hover:bg-success/15 hover:text-success",
    danger: "border-line text-muted hover:bg-danger-soft hover:text-danger"
  } as const;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "grid size-8 flex-none place-items-center rounded-lg border transition cursor-pointer",
        disabled ? "cursor-not-allowed opacity-30" : toneClass[tone]
      )}
    >
      {children}
    </button>
  );
}
