import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CreditCard, Lock, Loader2, Pencil, Plus, Power, PowerOff, Search, Trash2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { CheckboxField, Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import type { PaymentMethod } from "@shared/types/payment-method";

type FormState = {
  name: string;
  code: string;
  description: string;
  requiresReference: boolean;
  sortOrder: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  name: "",
  code: "",
  description: "",
  requiresReference: false,
  sortOrder: "0",
  isActive: true
};

function toFormState(method: PaymentMethod): FormState {
  return {
    name: method.name,
    code: method.code,
    description: method.description ?? "",
    requiresReference: method.requiresReference,
    sortOrder: String(method.sortOrder),
    isActive: method.isActive
  };
}

export function PaymentMethodsRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("payment_methods", "create");
  const canEdit = can("payment_methods", "edit");
  const canDelete = can("payment_methods", "delete");

  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");

  const loadMethods = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await window.blueLedger.paymentMethod.list();
      setMethods(list);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load payment methods"));
    }
  }, []);

  useEffect(() => {
    void loadMethods();
  }, [loadMethods]);

  const filteredMethods = useMemo(() => {
    if (!methods) return null;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return methods;
    return methods.filter((method) => {
      const haystack = `${method.name} ${method.code} ${method.description ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [methods, searchTerm]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreateModal(): void {
    setEditingMethod(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  }

  function openEditModal(method: PaymentMethod): void {
    setEditingMethod(method);
    setForm(toFormState(method));
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name,
      code: form.code,
      description: form.description,
      requiresReference: form.requiresReference,
      sortOrder: Number(form.sortOrder) || 0,
      isActive: form.isActive
    };

    try {
      if (editingMethod) {
        await window.blueLedger.paymentMethod.update(editingMethod.id, payload);
      } else {
        await window.blueLedger.paymentMethod.create(payload);
      }
      await loadMethods();
      setModalOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save payment method"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(method: PaymentMethod): Promise<void> {
    setActionError(null);
    try {
      await window.blueLedger.paymentMethod.setActive(method.id, !method.isActive);
      await loadMethods();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to update status"));
    }
  }

  async function handleDelete(method: PaymentMethod): Promise<void> {
    setActionError(null);
    if (!window.confirm(`Delete "${method.name}"? This can't be undone.`)) return;

    try {
      await window.blueLedger.paymentMethod.delete(method.id);
      await loadMethods();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to delete payment method"));
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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">
              Payment Methods
            </p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <CreditCard className="size-5 text-primary" aria-hidden="true" />
              How customers can pay
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Enable, disable, or add the payment methods your checkout will offer.
            </p>
          </div>
          {canCreate && (
            <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              New Payment Method
            </Button>
          )}
        </div>

        {actionError && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {actionError}
          </div>
        )}

        {methods !== null && methods.length > 0 && (
          <div className="mt-4">
            <label className="block sm:max-w-xs">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Search
              </span>
              <div className="relative mt-1.5">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by name, code, or description"
                  className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </div>
            </label>
          </div>
        )}

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <p className="text-sm font-bold text-danger">{loadError}</p>
              <Button type="button" onClick={() => void loadMethods()} className="mt-4 h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : methods === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : methods.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <CreditCard className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No payment methods yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Add your first payment method to start accepting it at checkout.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Payment Method
                </Button>
              )}
            </div>
          ) : filteredMethods && filteredMethods.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No payment methods match your search</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Try a different search term.
              </p>
              <Button type="button" onClick={() => setSearchTerm("")} className="mt-5 h-9 text-xs">
                Clear search
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-fulltable-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[22%]" />
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Name</Th>
                    <Th>Code</Th>
                    <Th>Reference</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredMethods ?? []).map((method) => (
                    <tr key={method.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="truncate px-4 py-3 font-extrabold">
                        <div className="flex items-center gap-2">
                          {method.name}
                          {method.isSystemMethod && (
                            <DashedPill tone="accent">System</DashedPill>
                          )}
                        </div>
                      </td>
                      <td className="truncate px-4 py-3 text-xs font-bold tabular-nums text-muted">
                        {method.code}
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone={method.requiresReference ? "warning" : "neutral"}>
                          {method.requiresReference ? "Required" : "Not required"}
                        </DashedPill>
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone={method.isActive ? "success" : "neutral"}>
                          {method.isActive ? "Active" : "Inactive"}
                        </DashedPill>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(method)}
                              aria-label={`Edit ${method.name}`}
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => void handleToggleActive(method)}
                              aria-label={method.isActive ? `Deactivate ${method.name}` : `Activate ${method.name}`}
                              className={cn(
                                "grid size-8 place-items-center rounded-lg border transition cursor-pointer",
                                method.isActive
                                  ? "border-line text-muted hover:bg-danger-soft hover:text-danger"
                                  : "border-line text-muted hover:bg-success/15 hover:text-success"
                              )}
                            >
                              {method.isActive ? (
                                <PowerOff className="size-3.5" aria-hidden="true" />
                              ) : (
                                <Power className="size-3.5" aria-hidden="true" />
                              )}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => void handleDelete(method)}
                              disabled={method.isSystemMethod}
                              aria-label={
                                method.isSystemMethod
                                  ? `${method.name} is a system method and can't be deleted`
                                  : `Delete ${method.name}`
                              }
                              title={method.isSystemMethod ? "System methods can't be deleted" : undefined}
                              className={cn(
                                "grid size-8 place-items-center rounded-lg border transition",
                                method.isSystemMethod
                                  ? "cursor-not-allowed border-line text-muted/30"
                                  : "cursor-pointer border-line text-muted hover:bg-danger-soft hover:text-danger"
                              )}
                            >
                              {method.isSystemMethod ? (
                                <Lock className="size-3.5" aria-hidden="true" />
                              ) : (
                                <Trash2 className="size-3.5" aria-hidden="true" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingMethod ? "Edit payment method" : "New payment method"}
        description="This determines what customers can select as a payment option during checkout."
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
              label="Name"
              value={form.name}
              onChange={(value) => updateField("name", value)}
              placeholder="e.g. Airtel Money"
              required
            />
            <Field
              label="Code"
              value={form.code}
              onChange={(value) => updateField("code", value)}
              placeholder="e.g. AIRTEL_MONEY"
              required
              disabled={Boolean(editingMethod?.isSystemMethod)}
            />
            <Field
              label="Sort Order"
              type="number"
              value={form.sortOrder}
              onChange={(value) => updateField("sortOrder", value)}
              placeholder="0"
            />
          </div>

          <TextAreaField
            label="Description"
            value={form.description}
            onChange={(value) => updateField("description", value)}
            placeholder="e.g. Mobile money payments via Airtel"
            className="mt-4"
          />

          <div className="mt-4">
            <CheckboxField
              label="Requires Reference"
              description="Cashier must enter a transaction/reference number for this payment"
              checked={form.requiresReference}
              onChange={(checked) => updateField("requiresReference", checked)}
            />
          </div>

          {editingMethod?.isSystemMethod && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-accent">
              <Lock className="size-3.5 flex-none" aria-hidden="true" />
              This is a system method — its code is locked, but everything else can be tuned.
            </p>
          )}

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
              {saving ? "Saving..." : editingMethod ? "Save changes" : "Create payment method"}
            </Button>
          </div>
        </form>
      </Modal>
    </motion.div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}
