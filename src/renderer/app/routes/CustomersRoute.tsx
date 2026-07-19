import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Eye, Loader2, Pencil, Plus, Power, PowerOff, Search, Users } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { CUSTOMER_TYPE_OPTIONS, type Customer, type CustomerType } from "@shared/types/customer";
import type { ExportListRequest } from "@shared/types/export";
import { CustomerDetailModal } from "./customers/CustomerDetailModal";

type FormState = {
  name: string;
  phone: string;
  customerType: CustomerType;
  email: string;
  physicalAddress: string;
  creditLimit: string;
  notes: string;
};

const emptyForm: FormState = {
  name: "",
  phone: "",
  customerType: "retail",
  email: "",
  physicalAddress: "",
  creditLimit: "",
  notes: ""
};

function toFormState(customer: Customer): FormState {
  return {
    name: customer.name,
    phone: customer.phone,
    customerType: customer.customerType,
    email: customer.email ?? "",
    physicalAddress: customer.physicalAddress ?? "",
    creditLimit: fromCents(customer.creditLimitCents),
    notes: customer.notes ?? ""
  };
}

function customerTypeLabel(value: CustomerType): string {
  return CUSTOMER_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function CustomersRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("customers", "create");
  const canEdit = can("customers", "edit");
  const canExport = can("customers", "export");

  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");

  const loadCustomers = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await window.blueLedger.customer.list();
      setCustomers(list);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load customers"));
    }
  }, []);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const filteredCustomers = useMemo(() => {
    if (!customers) return null;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((customer) => {
      const haystack = `${customer.name} ${customer.phone} ${customer.email ?? ""} ${customer.customerCode}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [customers, searchTerm]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredCustomers) return null;
    return {
      module: "customers",
      title: "Customers",
      subtitle: searchTerm.trim() ? `Search: "${searchTerm.trim()}"` : "Full customer directory",
      columns: [
        { key: "code", header: "Code" },
        { key: "name", header: "Name" },
        { key: "phone", header: "Phone" },
        { key: "type", header: "Type" },
        { key: "balance", header: "Balance", align: "right" },
        { key: "status", header: "Status" }
      ],
      rows: filteredCustomers.map((customer) => ({
        code: customer.customerCode,
        name: customer.name,
        phone: customer.phone,
        type: customerTypeLabel(customer.customerType),
        balance: formatCents(customer.currentBalanceCents),
        status: customer.status === "active" ? "Active" : "Inactive"
      })),
      stats: [
        { label: "Total Customers", value: String(filteredCustomers.length) },
        { label: "Active", value: String(filteredCustomers.filter((c) => c.status === "active").length) }
      ],
      fileBaseName: `Customers_${new Date().toISOString().slice(0, 10)}`
    };
  }, [filteredCustomers, searchTerm]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreateModal(): void {
    setEditingCustomer(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  }

  function openEditModal(customer: Customer): void {
    setEditingCustomer(customer);
    setForm(toFormState(customer));
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name,
      phone: form.phone,
      customerType: form.customerType,
      email: form.email,
      physicalAddress: form.physicalAddress,
      creditLimitCents: form.creditLimit.trim() === "" ? null : toCents(form.creditLimit),
      notes: form.notes
    };

    try {
      if (editingCustomer) {
        await window.blueLedger.customer.update(editingCustomer.id, payload);
      } else {
        await window.blueLedger.customer.create(payload);
      }
      await loadCustomers();
      setModalOpen(false);
      showSuccessToast(editingCustomer ? "Customer updated" : "Customer created");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save customer");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(customer: Customer): Promise<void> {
    setActionError(null);
    try {
      const nextStatus = customer.status === "active" ? "inactive" : "active";
      await window.blueLedger.customer.setStatus(customer.id, nextStatus);
      await loadCustomers();
      showSuccessToast(nextStatus === "active" ? "Customer activated" : "Customer deactivated");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to update status");
      setActionError(message);
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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Customers</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <Users className="size-5 text-primary" aria-hidden="true" />
              Customer Directory
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Save returning customers for faster checkout, or leave sales anonymous for walk-ins.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && exportRequest && <ExportMenu request={exportRequest} />}
            {canCreate && (
              <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Customer
              </Button>
            )}
          </div>
        </div>

        {actionError && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {actionError}
          </div>
        )}

        {customers !== null && customers.length > 0 && (
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
                  placeholder="Search by name, phone, email, or code"
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
              <Button type="button" onClick={() => void loadCustomers()} className="mt-4 h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : customers === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : customers.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Users className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No customers yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Add your first customer to start building a directory of returning buyers.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Customer
                </Button>
              )}
            </div>
          ) : filteredCustomers && filteredCustomers.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No customers match your search</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Try a different search term.
              </p>
              <Button type="button" onClick={() => setSearchTerm("")} className="mt-5 h-9 text-xs">
                Clear search
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[13%]" />
                  <col className="w-[21%]" />
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                  <col className="w-[10%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Code</Th>
                    <Th>Name</Th>
                    <Th>Phone</Th>
                    <Th>Type</Th>
                    <Th>Balance</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredCustomers ?? []).map((customer) => (
                    <tr key={customer.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="truncate px-4 py-3 text-xs font-bold tabular-nums text-muted">
                        {customer.customerCode}
                      </td>
                      <td className="truncate px-4 py-3 font-extrabold">{customer.name}</td>
                      <td className="truncate px-4 py-3 text-xs font-semibold text-muted">
                        {customer.phone}
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone="accent">{customerTypeLabel(customer.customerType)}</DashedPill>
                      </td>
                      <td className="truncate px-4 py-3 text-xs font-bold tabular-nums text-muted">
                        {formatCents(customer.currentBalanceCents)}
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone={customer.status === "active" ? "success" : "neutral"}>
                          {customer.status === "active" ? "Active" : "Inactive"}
                        </DashedPill>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setViewingCustomer(customer)}
                            aria-label={`View ${customer.name}`}
                            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                          >
                            <Eye className="size-3.5" aria-hidden="true" />
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(customer)}
                              aria-label={`Edit ${customer.name}`}
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => void handleToggleStatus(customer)}
                              aria-label={
                                customer.status === "active"
                                  ? `Deactivate ${customer.name}`
                                  : `Activate ${customer.name}`
                              }
                              className={cn(
                                "grid size-8 place-items-center rounded-lg border transition cursor-pointer",
                                customer.status === "active"
                                  ? "border-line text-muted hover:bg-danger-soft hover:text-danger"
                                  : "border-line text-muted hover:bg-success/15 hover:text-success"
                              )}
                            >
                              {customer.status === "active" ? (
                                <PowerOff className="size-3.5" aria-hidden="true" />
                              ) : (
                                <Power className="size-3.5" aria-hidden="true" />
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
        title={editingCustomer ? "Edit customer" : "New customer"}
        description="Only name and phone are required — everything else can be filled in later."
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
              placeholder="e.g. Jane Wanjiru"
              required
            />
            <Field
              label="Phone"
              value={form.phone}
              onChange={(value) => updateField("phone", value)}
              placeholder="e.g. 0712 345 678"
              required
            />
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
              Additional Details (Optional)
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Customer Type"
                value={form.customerType}
                onChange={(value) => updateField("customerType", value as CustomerType)}
                options={CUSTOMER_TYPE_OPTIONS}
              />
              <Field
                label="Email"
                type="email"
                value={form.email}
                onChange={(value) => updateField("email", value)}
                placeholder="e.g. jane@example.com"
              />
              <Field
                label="Credit Limit"
                type="number"
                value={form.creditLimit}
                onChange={(value) => updateField("creditLimit", value)}
                placeholder="0.00"
              />
            </div>

            <TextAreaField
              label="Physical Address"
              value={form.physicalAddress}
              onChange={(value) => updateField("physicalAddress", value)}
              placeholder="e.g. Ronald Ngala Street, Nairobi"
              className="mt-4"
              rows={2}
            />

            <TextAreaField
              label="Notes"
              value={form.notes}
              onChange={(value) => updateField("notes", value)}
              placeholder="Any other remarks about this customer"
              className="mt-4"
            />
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
              {saving ? "Saving..." : editingCustomer ? "Save changes" : "Create customer"}
            </Button>
          </div>
        </form>
      </Modal>

      {viewingCustomer && (
        <CustomerDetailModal customer={viewingCustomer} onClose={() => setViewingCustomer(null)} />
      )}
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
