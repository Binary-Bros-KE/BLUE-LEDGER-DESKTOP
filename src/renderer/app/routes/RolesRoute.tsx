import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Lock, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import {
  PERMISSION_ACTIONS,
  PERMISSION_ACTION_LABELS,
  PERMISSION_MODULES,
  type PermissionAction,
  type PermissionModuleKey,
  type PermissionsMap,
  type RoleListItem
} from "@shared/types/role";

type FormState = {
  roleName: string;
  description: string;
  permissions: PermissionsMap;
};

const emptyForm: FormState = {
  roleName: "",
  description: "",
  permissions: {}
};

function toFormState(role: RoleListItem): FormState {
  return {
    roleName: role.roleName,
    description: role.description ?? "",
    permissions: role.permissions
  };
}

const TOTAL_POSSIBLE_PERMISSIONS = PERMISSION_MODULES.reduce(
  (sum, module) => sum + module.actions.length,
  0
);

export function RolesRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("roles", "create");
  const canEdit = can("roles", "edit");
  const canDelete = can("roles", "delete");

  const [roles, setRoles] = useState<RoleListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleListItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRoles = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await window.blueLedger.role.list();
      setRoles(list);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load roles");
      setLoadError(message);
      showErrorToast(message);
    }
  }, []);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  function openCreateModal(): void {
    setEditingRole(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  }

  function openEditModal(role: RoleListItem): void {
    setEditingRole(role);
    setForm(toFormState(role));
    setError(null);
    setModalOpen(true);
  }

  function isActionChecked(moduleKey: PermissionModuleKey, action: PermissionAction): boolean {
    return (form.permissions[moduleKey] ?? []).includes(action);
  }

  function toggleAction(moduleKey: PermissionModuleKey, action: PermissionAction): void {
    setForm((prev) => {
      const current = new Set(prev.permissions[moduleKey] ?? []);
      if (current.has(action)) {
        current.delete(action);
      } else {
        current.add(action);
      }
      return { ...prev, permissions: { ...prev.permissions, [moduleKey]: Array.from(current) } };
    });
  }

  function toggleRow(moduleKey: PermissionModuleKey, actions: readonly PermissionAction[]): void {
    setForm((prev) => {
      const current = prev.permissions[moduleKey] ?? [];
      const allGranted = actions.every((action) => current.includes(action));
      return {
        ...prev,
        permissions: { ...prev.permissions, [moduleKey]: allGranted ? [] : [...actions] }
      };
    });
  }

  function toggleColumn(action: PermissionAction): void {
    setForm((prev) => {
      const applicableModules = PERMISSION_MODULES.filter((module) =>
        (module.actions as readonly PermissionAction[]).includes(action)
      );
      const allGranted = applicableModules.every((module) =>
        (prev.permissions[module.key] ?? []).includes(action)
      );

      const nextPermissions: PermissionsMap = { ...prev.permissions };
      for (const module of applicableModules) {
        const current = new Set(nextPermissions[module.key] ?? []);
        if (allGranted) {
          current.delete(action);
        } else {
          current.add(action);
        }
        nextPermissions[module.key] = Array.from(current);
      }
      return { ...prev, permissions: nextPermissions };
    });
  }

  const grantedSummary = useMemo(() => {
    return PERMISSION_MODULES.map((module) => ({
      module,
      actions: form.permissions[module.key] ?? []
    })).filter((entry) => entry.actions.length > 0);
  }, [form.permissions]);

  const totalGranted = grantedSummary.reduce((sum, entry) => sum + entry.actions.length, 0);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      roleName: form.roleName,
      description: form.description,
      permissions: form.permissions
    };

    try {
      if (editingRole) {
        await window.blueLedger.role.update(editingRole.id, payload);
        showSuccessToast(`Role "${form.roleName}" updated`);
      } else {
        await window.blueLedger.role.create(payload);
        showSuccessToast(`Role "${form.roleName}" created`);
      }
      await loadRoles();
      setModalOpen(false);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to save role");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(role: RoleListItem): Promise<void> {
    setActionError(null);
    if (!window.confirm(`Delete role "${role.roleName}"? This can't be undone.`)) return;

    try {
      await window.blueLedger.role.delete(role.id);
      showSuccessToast(`Role "${role.roleName}" deleted`);
      await loadRoles();
    } catch (err) {
      const message = getErrorMessage(err, "Failed to delete role");
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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Roles</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
              Permission groups
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Assign employees to a role instead of managing permissions one person at a time.
            </p>
          </div>
          {canCreate && (
            <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              New Role
            </Button>
          )}
        </div>

        {actionError && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {actionError}
          </div>
        )}

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <p className="text-sm font-bold text-danger">{loadError}</p>
              <Button type="button" onClick={() => void loadRoles()} className="mt-4 h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : roles === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[820px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[20%]" />
                  <col className="w-[30%]" />
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                  <col className="w-[24%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Role</Th>
                    <Th>Description</Th>
                    <Th>Type</Th>
                    <Th className="text-right">Employees</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="truncate px-4 py-3 font-extrabold">{role.roleName}</td>
                      <td className="truncate px-4 py-3 text-xs font-semibold text-muted">
                        {role.description ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <DashedPill tone={role.isSystemRole ? "accent" : "warning"} >
                          {role.isSystemRole ? "System" : "Custom"}
                        </DashedPill>
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{role.employeeCount}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(role)}
                              aria-label={`Edit ${role.roleName}`}
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => void handleDelete(role)}
                              disabled={role.isSystemRole}
                              aria-label={
                                role.isSystemRole
                                  ? `${role.roleName} is a system role and can't be deleted`
                                  : `Delete ${role.roleName}`
                              }
                              title={role.isSystemRole ? "System roles can't be deleted" : undefined}
                              className={cn(
                                "grid size-8 place-items-center rounded-lg border transition",
                                role.isSystemRole
                                  ? "cursor-not-allowed border-line text-muted/30"
                                  : "cursor-pointer border-line text-muted hover:bg-danger-soft hover:text-danger"
                              )}
                            >
                              {role.isSystemRole ? (
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
        title={editingRole ? "Edit role" : "New role"}
        description="Grant permissions by module — employees inherit whatever their assigned role allows."
        widthClassName="max-w-4xl"
      >
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Role Name"
              value={form.roleName}
              onChange={(value) => setForm((prev) => ({ ...prev, roleName: value }))}
              placeholder="e.g. Regional Supervisor"
              required
              disabled={Boolean(editingRole?.isSystemRole)}
            />
            <TextAreaField
              label="Description"
              value={form.description}
              onChange={(value) => setForm((prev) => ({ ...prev, description: value }))}
              placeholder="e.g. Oversees multiple branches within a region"
              rows={1}
            />
          </div>

          {editingRole?.isSystemRole && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-accent">
              <Lock className="size-3.5 flex-none" aria-hidden="true" />
              This is a system role — its name is locked, but you can still tune its permissions.
            </p>
          )}

          <div className="mt-5 border-t border-line pt-5">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
              Permissions
            </p>
            <div className="mt-3 overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Module</Th>
                    {PERMISSION_ACTIONS.map((action) => (
                      <th
                        key={action}
                        className="cursor-pointer px-3 py-2.5 text-center text-[10px] font-extrabold uppercase tracking-wider hover:bg-primary/80"
                        onClick={() => toggleColumn(action)}
                        title={`Toggle ${PERMISSION_ACTION_LABELS[action]} for every applicable module`}
                      >
                        {PERMISSION_ACTION_LABELS[action]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_MODULES.map((module) => (
                    <tr
                      key={module.key}
                      className="border-t border-line odd:bg-white even:bg-soft/50"
                    >
                      <td
                        className="cursor-pointer px-3 py-2 text-xs font-extrabold hover:text-accent"
                        onClick={() => toggleRow(module.key, module.actions)}
                        title={`Toggle all permissions for ${module.label}`}
                      >
                        {module.label}
                      </td>
                      {PERMISSION_ACTIONS.map((action) => {
                        const applicable = (module.actions as readonly PermissionAction[]).includes(
                          action
                        );
                        return (
                          <td key={action} className="px-3 py-2 text-center">
                            {applicable ? (
                              <input
                                type="checkbox"
                                checked={isActionChecked(module.key, action)}
                                onChange={() => toggleAction(module.key, action)}
                                className="size-4 accent-primary"
                              />
                            ) : (
                              <span className="text-muted/30">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 rounded-lg border border-line bg-soft/50 p-3">
              <p className="text-xs font-extrabold">
                {totalGranted} of {TOTAL_POSSIBLE_PERMISSIONS} permissions granted across{" "}
                {grantedSummary.length} module{grantedSummary.length === 1 ? "" : "s"}
              </p>
              {grantedSummary.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {grantedSummary.map((entry) => (
                    <DashedPill key={entry.module.key} tone="accent">
                      {entry.module.label}:{" "}
                      {entry.actions.map((action) => PERMISSION_ACTION_LABELS[action]).join(", ")}
                    </DashedPill>
                  ))}
                </div>
              )}
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
              {saving ? "Saving..." : editingRole ? "Save changes" : "Create role"}
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
