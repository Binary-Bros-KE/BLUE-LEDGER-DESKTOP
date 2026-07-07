import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  ShoppingCart,
  Store,
  TruckIcon
} from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { CheckboxField, Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { LOCATION_TYPE_OPTIONS, type Location, type LocationType } from "@shared/types/location";

type FormState = {
  locationName: string;
  locationCode: string;
  locationType: LocationType;
  phone: string;
  alternativePhone: string;
  email: string;
  country: string;
  county: string;
  city: string;
  physicalAddress: string;
  managerName: string;
  managerPhone: string;
  managerEmail: string;
  openingTime: string;
  closingTime: string;
  description: string;
  canReceiveStock: boolean;
  canSellStock: boolean;
  canTransferStock: boolean;
};

const emptyForm: FormState = {
  locationName: "",
  locationCode: "",
  locationType: "retail_store",
  phone: "",
  alternativePhone: "",
  email: "",
  country: "",
  county: "",
  city: "",
  physicalAddress: "",
  managerName: "",
  managerPhone: "",
  managerEmail: "",
  openingTime: "",
  closingTime: "",
  description: "",
  canReceiveStock: true,
  canSellStock: true,
  canTransferStock: true
};

function toFormState(location: Location): FormState {
  return {
    locationName: location.locationName,
    locationCode: location.locationCode,
    locationType: location.locationType,
    phone: location.phone ?? "",
    alternativePhone: location.alternativePhone ?? "",
    email: location.email ?? "",
    country: location.country ?? "",
    county: location.county ?? "",
    city: location.city ?? "",
    physicalAddress: location.physicalAddress ?? "",
    managerName: location.managerName ?? "",
    managerPhone: location.managerPhone ?? "",
    managerEmail: location.managerEmail ?? "",
    openingTime: location.openingTime ?? "",
    closingTime: location.closingTime ?? "",
    description: location.description ?? "",
    canReceiveStock: location.canReceiveStock,
    canSellStock: location.canSellStock,
    canTransferStock: location.canTransferStock
  };
}

function locationTypeLabel(type: LocationType): string {
  return LOCATION_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export function StorefrontsRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("locations", "create");
  const canEdit = can("locations", "edit");

  const [locations, setLocations] = useState<Location[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadLocations = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await window.blueLedger.location.list();
      setLocations(list);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load storefronts");
    }
  }, []);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreateModal(): void {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  }

  function openEditModal(location: Location): void {
    setEditingId(location.id);
    setForm(toFormState(location));
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (editingId) {
        await window.blueLedger.location.update(editingId, form);
      } else {
        await window.blueLedger.location.create(form);
      }
      await loadLocations();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save location");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(location: Location): Promise<void> {
    const nextStatus = location.status === "active" ? "inactive" : "active";
    await window.blueLedger.location.setStatus(location.id, nextStatus);
    await loadLocations();
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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Storefronts</p>
            <h2 className="mt-1 text-xl font-extrabold">Branches &amp; warehouses</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Every retail store, wholesale outlet, warehouse, and distribution center this installation
              manages.
            </p>
          </div>
          {canCreate && (
            <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              New Location
            </Button>
          )}
        </div>

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <p className="text-sm font-bold text-danger">{loadError}</p>
              <Button type="button" onClick={() => void loadLocations()} className="mt-4 h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : locations === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : locations.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Store className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No storefronts yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Add your first branch, warehouse, or store to start tracking it separately.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Location
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Location</Th>
                    <Th>Type</Th>
                    <Th>Manager</Th>
                    <Th>Phone</Th>
                    <Th>Permissions</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((location) => (
                    <tr key={location.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="px-4 py-3">
                        <p className="font-extrabold">{location.locationName}</p>
                        <p className="text-xs tabular-nums text-muted">{location.locationCode}</p>
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone="accent">{locationTypeLabel(location.locationType)}</DashedPill>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold">{location.managerName ?? "—"}</td>
                      <td className="px-4 py-3 text-sm tabular-nums">{location.phone ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <PermissionIcon active={location.canReceiveStock} label="Receive stock">
                            <TruckIcon className="size-3.5" aria-hidden="true" />
                          </PermissionIcon>
                          <PermissionIcon active={location.canSellStock} label="Sell stock">
                            <ShoppingCart className="size-3.5" aria-hidden="true" />
                          </PermissionIcon>
                          <PermissionIcon active={location.canTransferStock} label="Transfer stock">
                            <ArrowLeftRight className="size-3.5" aria-hidden="true" />
                          </PermissionIcon>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone={location.status === "active" ? "success" : "warning"}>
                          {location.status}
                        </DashedPill>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(location)}
                              aria-label={`Edit ${location.locationName}`}
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => void handleToggleStatus(location)}
                              aria-label={
                                location.status === "active"
                                  ? `Deactivate ${location.locationName}`
                                  : `Activate ${location.locationName}`
                              }
                              className={cn(
                                "grid size-8 place-items-center rounded-lg border transition cursor-pointer",
                                location.status === "active"
                                  ? "border-line text-muted hover:bg-danger-soft hover:text-danger"
                                  : "border-line text-muted hover:bg-success/15 hover:text-success"
                              )}
                            >
                              {location.status === "active" ? (
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
        title={editingId ? "Edit location" : "New location"}
        description="Locations feed future inventory transfers, stock movements, and branch reporting."
        widthClassName="max-w-2xl"
      >
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Location Name"
              value={form.locationName}
              onChange={(value) => updateField("locationName", value)}
              placeholder="e.g. Nairobi CBD Branch"
              required
            />
            <Field
              label="Location Code"
              value={form.locationCode}
              onChange={(value) => updateField("locationCode", value)}
              placeholder="e.g. NRB-001"
              required
            />
            <SelectField
              label="Location Type"
              value={form.locationType}
              onChange={(value) => updateField("locationType", value as LocationType)}
              options={LOCATION_TYPE_OPTIONS}
            />
            <Field
              label="Phone"
              value={form.phone}
              onChange={(value) => updateField("phone", value)}
              placeholder="e.g. 0712 345 678"
            />
            <Field
              label="Alternative Phone"
              value={form.alternativePhone}
              onChange={(value) => updateField("alternativePhone", value)}
              placeholder="e.g. 0722 345 678"
            />
            <Field
              label="Email"
              type="email"
              value={form.email}
              onChange={(value) => updateField("email", value)}
              placeholder="e.g. branch@yourbusiness.co.ke"
            />
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
              label="City"
              value={form.city}
              onChange={(value) => updateField("city", value)}
              placeholder="e.g. Nairobi CBD"
            />
            <Field
              label="Physical Address"
              value={form.physicalAddress}
              onChange={(value) => updateField("physicalAddress", value)}
              placeholder="e.g. Moi Avenue, Reliable House"
              className="sm:col-span-2"
            />
            <Field
              label="Manager Name"
              value={form.managerName}
              onChange={(value) => updateField("managerName", value)}
              placeholder="e.g. John Mwangi"
            />
            <Field
              label="Manager Phone"
              value={form.managerPhone}
              onChange={(value) => updateField("managerPhone", value)}
              placeholder="e.g. 0712 345 678"
            />
            <Field
              label="Manager Email"
              type="email"
              value={form.managerEmail}
              onChange={(value) => updateField("managerEmail", value)}
              placeholder="e.g. manager@yourbusiness.co.ke"
            />
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Opening Time"
                type="time"
                value={form.openingTime}
                onChange={(value) => updateField("openingTime", value)}
              />
              <Field
                label="Closing Time"
                type="time"
                value={form.closingTime}
                onChange={(value) => updateField("closingTime", value)}
              />
            </div>
            <TextAreaField
              label="Description"
              value={form.description}
              onChange={(value) => updateField("description", value)}
              placeholder="e.g. Main branch serving Nairobi CBD walk-in customers"
              className="sm:col-span-2"
            />
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
              Inventory Permissions
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <CheckboxField
                label="Can Receive Stock"
                description="Accept incoming transfers"
                checked={form.canReceiveStock}
                onChange={(checked) => updateField("canReceiveStock", checked)}
              />
              <CheckboxField
                label="Can Sell Stock"
                description="Appears in checkout"
                checked={form.canSellStock}
                onChange={(checked) => updateField("canSellStock", checked)}
              />
              <CheckboxField
                label="Can Transfer Stock"
                description="Send to other locations"
                checked={form.canTransferStock}
                onChange={(checked) => updateField("canTransferStock", checked)}
              />
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
            <Button type="submit" disabled={saving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {saving ? "Saving..." : editingId ? "Save changes" : "Create location"}
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

function PermissionIcon({
  active,
  label,
  children
}: {
  active: boolean;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      title={label}
      className={cn(
        "grid size-6 place-items-center rounded-md border",
        active ? "border-success/30 bg-success/15 text-success" : "border-line bg-soft text-muted/50"
      )}
    >
      {children}
    </span>
  );
}
