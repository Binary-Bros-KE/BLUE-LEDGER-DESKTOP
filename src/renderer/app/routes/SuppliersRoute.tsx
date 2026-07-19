import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Eye,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Truck,
  XCircle
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, fromCents, toCents } from "@renderer/shared/lib/money";
import type { ExportListRequest } from "@shared/types/export";
import {
  SUPPLIER_PAYMENT_OPTION_OPTIONS,
  type Supplier,
  type SupplierPaymentOption
} from "@shared/types/supplier";
import { SupplierDetailModal } from "./suppliers/SupplierDetailModal";

type StatusFilter = "all" | "active" | "inactive";

type FormState = {
  businessName: string;
  contactPerson: string;
  phone1: string;
  phone2: string;
  email: string;
  website: string;
  country: string;
  county: string;
  town: string;
  physicalAddress: string;
  paymentOption: SupplierPaymentOption;
  mpesaName: string;
  mpesaNumber: string;
  mpesaAlternativeNumber: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  creditLimit: string;
  notes: string;
};

function emptyForm(): FormState {
  return {
    businessName: "",
    contactPerson: "",
    phone1: "",
    phone2: "",
    email: "",
    website: "",
    country: "",
    county: "",
    town: "",
    physicalAddress: "",
    paymentOption: "cash",
    mpesaName: "",
    mpesaNumber: "",
    mpesaAlternativeNumber: "",
    bankName: "",
    bankAccountName: "",
    bankAccountNumber: "",
    creditLimit: "",
    notes: ""
  };
}

function toFormState(supplier: Supplier): FormState {
  return {
    businessName: supplier.businessName,
    contactPerson: supplier.contactPerson ?? "",
    phone1: supplier.phone1,
    phone2: supplier.phone2 ?? "",
    email: supplier.email ?? "",
    website: supplier.website ?? "",
    country: supplier.country ?? "",
    county: supplier.county ?? "",
    town: supplier.town ?? "",
    physicalAddress: supplier.physicalAddress ?? "",
    paymentOption: supplier.paymentOption,
    mpesaName: supplier.mpesaName ?? "",
    mpesaNumber: supplier.mpesaNumber ?? "",
    mpesaAlternativeNumber: supplier.mpesaAlternativeNumber ?? "",
    bankName: supplier.bankName ?? "",
    bankAccountName: supplier.bankAccountName ?? "",
    bankAccountNumber: supplier.bankAccountNumber ?? "",
    creditLimit: fromCents(supplier.creditLimitCents),
    notes: supplier.notes ?? ""
  };
}

function paymentOptionLabel(value: string): string {
  return SUPPLIER_PAYMENT_OPTION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function SuppliersRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("suppliers", "create");
  const canEdit = can("suppliers", "edit");
  const canExport = can("suppliers", "export");

  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [viewingSupplier, setViewingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [paymentOptionFilter, setPaymentOptionFilter] = useState("");

  const loadSuppliers = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await window.blueLedger.supplier.list();
      setSuppliers(list);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load suppliers"));
    }
  }, []);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  useEffect(() => {
    if (!actionError) return undefined;
    const timer = setTimeout(() => setActionError(null), 4000);
    return () => clearTimeout(timer);
  }, [actionError]);

  const stats = useMemo(() => {
    const total = suppliers?.length ?? 0;
    const active = suppliers?.filter((supplier) => supplier.status === "active").length ?? 0;
    const inactive = total - active;
    return { total, active, inactive };
  }, [suppliers]);

  const filteredSuppliers = useMemo(() => {
    if (!suppliers) return null;
    let list = suppliers;

    if (statusFilter !== "all") {
      list = list.filter((supplier) => supplier.status === statusFilter);
    }
    if (paymentOptionFilter) {
      list = list.filter((supplier) => supplier.paymentOption === paymentOptionFilter);
    }
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((supplier) => {
        const haystack = `${supplier.supplierCode} ${supplier.businessName} ${supplier.contactPerson ?? ""} ${supplier.phone1} ${supplier.phone2 ?? ""} ${supplier.email ?? ""}`.toLowerCase();
        return haystack.includes(term);
      });
    }
    return list;
  }, [suppliers, statusFilter, paymentOptionFilter, searchTerm]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredSuppliers) return null;
    const filterParts: string[] = [];
    if (statusFilter !== "all") filterParts.push(`Status: ${statusFilter}`);
    if (paymentOptionFilter) filterParts.push(`Payment Option: ${paymentOptionLabel(paymentOptionFilter)}`);
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);

    return {
      module: "suppliers",
      title: "Suppliers",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "Full supplier directory",
      columns: [
        { key: "code", header: "Code" },
        { key: "businessName", header: "Business Name" },
        { key: "contactPerson", header: "Contact Person" },
        { key: "phone", header: "Phone" },
        { key: "paymentOption", header: "Payment Option" },
        { key: "creditLimit", header: "Credit Limit", align: "right" },
        { key: "status", header: "Status" }
      ],
      rows: filteredSuppliers.map((supplier) => ({
        code: supplier.supplierCode,
        businessName: supplier.businessName,
        contactPerson: supplier.contactPerson ?? "—",
        phone: supplier.phone1,
        paymentOption: paymentOptionLabel(supplier.paymentOption),
        creditLimit: supplier.creditLimitCents !== null ? formatCents(supplier.creditLimitCents) : "—",
        status: supplier.status === "active" ? "Active" : "Inactive"
      })),
      stats: [
        { label: "Total Suppliers", value: String(stats.total) },
        { label: "Active", value: String(stats.active) },
        { label: "Inactive", value: String(stats.inactive) }
      ],
      fileBaseName: `Suppliers_${new Date().toISOString().slice(0, 10)}`
    };
  }, [filteredSuppliers, stats, statusFilter, paymentOptionFilter, searchTerm]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreateModal(): void {
    setEditingSupplier(null);
    setForm(emptyForm());
    setError(null);
    setModalOpen(true);
  }

  function openEditModal(supplier: Supplier): void {
    setEditingSupplier(supplier);
    setForm(toFormState(supplier));
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      businessName: form.businessName,
      contactPerson: form.contactPerson,
      phone1: form.phone1,
      phone2: form.phone2,
      email: form.email,
      website: form.website,
      country: form.country,
      county: form.county,
      town: form.town,
      physicalAddress: form.physicalAddress,
      paymentOption: form.paymentOption,
      mpesaName: form.mpesaName,
      mpesaNumber: form.mpesaNumber,
      mpesaAlternativeNumber: form.mpesaAlternativeNumber,
      bankName: form.bankName,
      bankAccountName: form.bankAccountName,
      bankAccountNumber: form.bankAccountNumber,
      creditLimitCents: form.creditLimit.trim() === "" ? null : toCents(form.creditLimit),
      notes: form.notes
    };

    try {
      if (editingSupplier) {
        await window.blueLedger.supplier.update(editingSupplier.id, payload);
      } else {
        await window.blueLedger.supplier.create(payload);
      }
      await loadSuppliers();
      setModalOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save supplier"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(supplier: Supplier): Promise<void> {
    setActionError(null);
    try {
      await window.blueLedger.supplier.setStatus(
        supplier.id,
        supplier.status === "active" ? "inactive" : "active"
      );
      await loadSuppliers();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to update status"));
    }
  }

  const showMpesaFields = form.paymentOption === "mpesa";
  const showBankFields = form.paymentOption === "bank_transfer";

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile icon={Truck} label="Total Suppliers" value={String(stats.total)} tone="primary" />
        <StatTile icon={CheckCircle2} label="Active Suppliers" value={String(stats.active)} tone="success" />
        <StatTile icon={XCircle} label="Inactive Suppliers" value={String(stats.inactive)} tone="warning" />
      </div>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Suppliers</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <Truck className="size-5 text-primary" aria-hidden="true" />
              Supplier Directory
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              The master list of businesses you purchase from — used throughout Purchases and inventory.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && exportRequest && <ExportMenu request={exportRequest} />}
            {canCreate && (
              <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Supplier
              </Button>
            )}
          </div>
        </div>

        {actionError && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {actionError}
          </div>
        )}

        {suppliers !== null && suppliers.length > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block flex-1 sm:max-w-xs">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Search</span>
              <div className="relative mt-1.5">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by code, name, contact, phone, or email"
                  className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </div>
            </label>

            <div className="flex gap-1.5 rounded-lg border border-line bg-soft px-1 py-0.5">
              {(["all", "active", "inactive"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={cn(
                    "rounded-md px-3 py-1 text-[8px] font-extrabold uppercase tracking-wide transition cursor-pointer",
                    statusFilter === value ? "bg-primary text-white" : "text-muted hover:bg-white"
                  )}
                >
                  {value}
                </button>
              ))}
            </div>

            <SelectField
              label="Payment Option"
              value={paymentOptionFilter}
              onChange={setPaymentOptionFilter}
              options={[{ value: "", label: "All Payment Options" }, ...SUPPLIER_PAYMENT_OPTION_OPTIONS]}
              className="w-full sm:w-48"
            />
          </div>
        )}

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <p className="text-sm font-bold text-danger">{loadError}</p>
              <Button type="button" onClick={() => void loadSuppliers()} className="mt-4 h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : suppliers === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : suppliers.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Truck className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No suppliers yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Add your first supplier to start building your procurement directory.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Supplier
                </Button>
              )}
            </div>
          ) : filteredSuppliers && filteredSuppliers.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No suppliers match your filters</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Try a different search term or filter combination.
              </p>
              <Button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                  setPaymentOptionFilter("");
                }}
                className="mt-5 h-9 text-xs"
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[1000px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[11%]" />
                  <col className="w-[19%]" />
                  <col className="w-[15%]" />
                  <col className="w-[12%]" />
                  <col className="w-[13%]" />
                  <col className="w-[11%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Code</Th>
                    <Th>Business Name</Th>
                    <Th>Contact Person</Th>
                    <Th>Phone</Th>
                    <Th>Payment Option</Th>
                    <Th>Credit Limit</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredSuppliers ?? []).map((supplier) => (
                    <tr key={supplier.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="truncate px-4 py-3 text-xs font-bold tabular-nums text-muted">
                        {supplier.supplierCode}
                      </td>
                      <td className="truncate px-4 py-3 font-extrabold">{supplier.businessName}</td>
                      <td className="truncate px-4 py-3 text-xs font-semibold text-muted">
                        {supplier.contactPerson ?? "—"}
                      </td>
                      <td className="truncate px-4 py-3 text-xs font-semibold text-muted">{supplier.phone1}</td>
                      <td className="px-4 py-3">
                        <DashedPill tone="accent">{paymentOptionLabel(supplier.paymentOption)}</DashedPill>
                      </td>
                      <td className="truncate px-4 py-3 text-xs font-bold tabular-nums text-muted">
                        {formatCents(supplier.creditLimitCents)}
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone={supplier.status === "active" ? "success" : "neutral"}>
                          {supplier.status === "active" ? "Active" : "Inactive"}
                        </DashedPill>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setViewingSupplier(supplier)}
                            aria-label={`View ${supplier.businessName}`}
                            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                          >
                            <Eye className="size-3.5" aria-hidden="true" />
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(supplier)}
                              aria-label={`Edit ${supplier.businessName}`}
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => void handleToggleStatus(supplier)}
                              aria-label={
                                supplier.status === "active"
                                  ? `Deactivate ${supplier.businessName}`
                                  : `Activate ${supplier.businessName}`
                              }
                              className={cn(
                                "grid size-8 place-items-center rounded-lg border transition cursor-pointer",
                                supplier.status === "active"
                                  ? "border-line text-muted hover:bg-danger-soft hover:text-danger"
                                  : "border-line text-muted hover:bg-success/15 hover:text-success"
                              )}
                            >
                              {supplier.status === "active" ? (
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
        title={editingSupplier ? "Edit supplier" : "New supplier"}
        description="Business name and Phone 1 are required — everything else can be filled in later."
        widthClassName="max-w-2xl"
      >
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}

          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
              Business Information
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Supplier Code"
                value={editingSupplier ? editingSupplier.supplierCode : "Auto-generated"}
                onChange={() => undefined}
                disabled
              />
              <Field
                label="Business Name"
                value={form.businessName}
                onChange={(value) => updateField("businessName", value)}
                placeholder="e.g. Nairobi Wholesalers Ltd"
                required
              />
              <Field
                label="Contact Person"
                value={form.contactPerson}
                onChange={(value) => updateField("contactPerson", value)}
                placeholder="e.g. John Kamau"
              />
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
              Contact Information
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Phone 1"
                value={form.phone1}
                onChange={(value) => updateField("phone1", value)}
                placeholder="e.g. 0712 345 678"
                required
              />
              <Field
                label="Phone 2"
                value={form.phone2}
                onChange={(value) => updateField("phone2", value)}
                placeholder="Optional secondary phone"
              />
              <Field
                label="Email"
                type="email"
                value={form.email}
                onChange={(value) => updateField("email", value)}
                placeholder="e.g. sales@supplier.com"
              />
              <Field
                label="Website"
                value={form.website}
                onChange={(value) => updateField("website", value)}
                placeholder="e.g. https://supplier.com"
              />
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Address</p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Country"
                value={form.country}
                onChange={(value) => updateField("country", value)}
                placeholder="e.g. Kenya"
              />
              <Field
                label="County"
                value={form.county}
                onChange={(value) => updateField("county", value)}
                placeholder="e.g. Nairobi"
              />
              <Field
                label="Town"
                value={form.town}
                onChange={(value) => updateField("town", value)}
                placeholder="e.g. Industrial Area"
              />
            </div>
            <TextAreaField
              label="Physical Address"
              value={form.physicalAddress}
              onChange={(value) => updateField("physicalAddress", value)}
              placeholder="e.g. Enterprise Road, Industrial Area"
              className="mt-4"
              rows={2}
            />
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Payment Details</p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Payment Option"
                value={form.paymentOption}
                onChange={(value) => updateField("paymentOption", value as SupplierPaymentOption)}
                options={SUPPLIER_PAYMENT_OPTION_OPTIONS}
              />
            </div>

            {showMpesaFields && (
              <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-dashed border-line bg-soft/50 p-3 sm:grid-cols-3">
                <Field
                  label="M-Pesa Name"
                  value={form.mpesaName}
                  onChange={(value) => updateField("mpesaName", value)}
                  placeholder="Registered M-Pesa name"
                />
                <Field
                  label="M-Pesa Number"
                  value={form.mpesaNumber}
                  onChange={(value) => updateField("mpesaNumber", value)}
                  placeholder="e.g. 0712 345 678"
                />
                <Field
                  label="M-Pesa Alternative Number"
                  value={form.mpesaAlternativeNumber}
                  onChange={(value) => updateField("mpesaAlternativeNumber", value)}
                  placeholder="Optional backup number"
                />
              </div>
            )}

            {showBankFields && (
              <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-dashed border-line bg-soft/50 p-3 sm:grid-cols-3">
                <Field
                  label="Bank Name"
                  value={form.bankName}
                  onChange={(value) => updateField("bankName", value)}
                  placeholder="e.g. Equity Bank"
                />
                <Field
                  label="Bank Account Name"
                  value={form.bankAccountName}
                  onChange={(value) => updateField("bankAccountName", value)}
                  placeholder="Registered account name"
                />
                <Field
                  label="Bank Account Number"
                  value={form.bankAccountNumber}
                  onChange={(value) => updateField("bankAccountNumber", value)}
                  placeholder="e.g. 0123456789"
                />
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
              Credit Information
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Credit Limit"
                type="number"
                value={form.creditLimit}
                onChange={(value) => updateField("creditLimit", value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <TextAreaField
              label="Notes"
              value={form.notes}
              onChange={(value) => updateField("notes", value)}
              placeholder="Any other remarks about this supplier"
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
              {saving ? "Saving..." : editingSupplier ? "Save changes" : "Create supplier"}
            </Button>
          </div>
        </form>
      </Modal>

      {viewingSupplier && (
        <SupplierDetailModal supplier={viewingSupplier} onClose={() => setViewingSupplier(null)} />
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
