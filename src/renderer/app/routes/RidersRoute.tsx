import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bike, CheckCircle2, Loader2, Pencil, Plus, Power, PowerOff, Search, XCircle } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Field } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import type { Rider } from "@shared/types/rider";

type StatusFilter = "all" | "active" | "inactive";

type FormState = {
  name: string;
  phone: string;
  altPhone: string;
  company: string;
  vehicleDescription: string;
};

function emptyForm(): FormState {
  return { name: "", phone: "", altPhone: "", company: "", vehicleDescription: "" };
}

function toFormState(rider: Rider): FormState {
  return {
    name: rider.name,
    phone: rider.phone,
    altPhone: rider.altPhone ?? "",
    company: rider.company ?? "",
    vehicleDescription: rider.vehicleDescription ?? ""
  };
}

export function RidersRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("riders", "create");
  const canEdit = can("riders", "edit");

  const [riders, setRiders] = useState<Rider[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRider, setEditingRider] = useState<Rider | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const loadRiders = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await window.blueLedger.rider.list();
      setRiders(list);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load riders"));
    }
  }, []);

  useEffect(() => {
    void loadRiders();
  }, [loadRiders]);

  useEffect(() => {
    if (!actionError) return undefined;
    const timer = setTimeout(() => setActionError(null), 4000);
    return () => clearTimeout(timer);
  }, [actionError]);

  const stats = useMemo(() => {
    const total = riders?.length ?? 0;
    const active = riders?.filter((rider) => rider.status === "active").length ?? 0;
    const inactive = total - active;
    return { total, active, inactive };
  }, [riders]);

  const filteredRiders = useMemo(() => {
    if (!riders) return null;
    let list = riders;

    if (statusFilter !== "all") {
      list = list.filter((rider) => rider.status === statusFilter);
    }
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((rider) => {
        const haystack = `${rider.name} ${rider.phone} ${rider.altPhone ?? ""} ${rider.company ?? ""}`.toLowerCase();
        return haystack.includes(term);
      });
    }
    return list;
  }, [riders, statusFilter, searchTerm]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreateModal(): void {
    setEditingRider(null);
    setForm(emptyForm());
    setError(null);
    setModalOpen(true);
  }

  function openEditModal(rider: Rider): void {
    setEditingRider(rider);
    setForm(toFormState(rider));
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
      altPhone: form.altPhone,
      company: form.company,
      vehicleDescription: form.vehicleDescription
    };

    try {
      if (editingRider) {
        await window.blueLedger.rider.update(editingRider.id, payload);
      } else {
        await window.blueLedger.rider.create(payload);
      }
      await loadRiders();
      setModalOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save rider"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(rider: Rider): Promise<void> {
    setActionError(null);
    try {
      await window.blueLedger.rider.setStatus(rider.id, rider.status === "active" ? "inactive" : "active");
      await loadRiders();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to update status"));
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile icon={Bike} label="Total Riders" value={String(stats.total)} tone="primary" />
        <StatTile icon={CheckCircle2} label="Active Riders" value={String(stats.active)} tone="success" />
        <StatTile icon={XCircle} label="Inactive Riders" value={String(stats.inactive)} tone="warning" />
      </div>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Riders</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <Bike className="size-5 text-primary" aria-hidden="true" />
              Delivery Riders
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Couriers who can be assigned to a sale, invoice, or quotation's delivery.
            </p>
          </div>
          {canCreate && (
            <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              New Rider
            </Button>
          )}
        </div>

        {actionError && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {actionError}
          </div>
        )}

        {riders !== null && riders.length > 0 && (
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
                  placeholder="Search by name, phone, or company"
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
          </div>
        )}

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <p className="text-sm font-bold text-danger">{loadError}</p>
              <Button type="button" onClick={() => void loadRiders()} className="mt-4 h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : riders === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : riders.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Bike className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No riders yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Add your first rider so you can assign deliveries to them from Checkout.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Rider
                </Button>
              )}
            </div>
          ) : filteredRiders && filteredRiders.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No riders match your filters</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Try a different search term or filter combination.
              </p>
              <Button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                }}
                className="mt-5 h-9 text-xs"
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[860px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[20%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[17%]" />
                  <col className="w-[18%]" />
                  <col className="w-[7%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Name</Th>
                    <Th>Phone</Th>
                    <Th>Alt Phone</Th>
                    <Th>Company</Th>
                    <Th>Vehicle</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredRiders ?? []).map((rider) => (
                    <tr key={rider.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="truncate px-4 py-3 font-extrabold">{rider.name}</td>
                      <td className="truncate px-4 py-3 text-xs font-semibold text-muted">{rider.phone}</td>
                      <td className="truncate px-4 py-3 text-xs font-semibold text-muted">
                        {rider.altPhone ?? "—"}
                      </td>
                      <td className="truncate px-4 py-3 text-xs font-semibold text-muted">
                        {rider.company ?? "—"}
                      </td>
                      <td className="truncate px-4 py-3 text-xs font-semibold text-muted">
                        {rider.vehicleDescription ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone={rider.status === "active" ? "success" : "neutral"}>
                          {rider.status === "active" ? "Active" : "Inactive"}
                        </DashedPill>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(rider)}
                              aria-label={`Edit ${rider.name}`}
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => void handleToggleStatus(rider)}
                              aria-label={rider.status === "active" ? `Deactivate ${rider.name}` : `Activate ${rider.name}`}
                              className={cn(
                                "grid size-8 place-items-center rounded-lg border transition cursor-pointer",
                                rider.status === "active"
                                  ? "border-line text-muted hover:bg-danger-soft hover:text-danger"
                                  : "border-line text-muted hover:bg-success/15 hover:text-success"
                              )}
                            >
                              {rider.status === "active" ? (
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
        title={editingRider ? "Edit rider" : "New rider"}
        description="Name and phone are required — everything else can be filled in later."
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
              placeholder="e.g. James Otieno"
              required
            />
            <Field
              label="Phone"
              value={form.phone}
              onChange={(value) => updateField("phone", value)}
              placeholder="e.g. 0712 345 678"
              required
            />
            <Field
              label="Alt Phone"
              value={form.altPhone}
              onChange={(value) => updateField("altPhone", value)}
              placeholder="Optional secondary phone"
            />
            <Field
              label="Company"
              value={form.company}
              onChange={(value) => updateField("company", value)}
              placeholder="e.g. Independent, or a courier company"
            />
            <Field
              label="Vehicle"
              value={form.vehicleDescription}
              onChange={(value) => updateField("vehicleDescription", value)}
              placeholder="e.g. Motorbike - KMEA 123B"
              className="sm:col-span-2"
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
              {saving ? "Saving..." : editingRider ? "Save changes" : "Create rider"}
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
