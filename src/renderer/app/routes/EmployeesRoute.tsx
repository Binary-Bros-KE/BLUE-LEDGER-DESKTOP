import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { Eye, ImagePlus, KeyRound, Loader2, Pencil, Plus, Search, Trash2, UserCog, X } from "lucide-react";
import { EmployeeDetailModal } from "@renderer/app/routes/employees/EmployeeDetailModal";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { Field, SelectField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import {
  EMPLOYEE_STATUS_OPTIONS,
  GENDER_OPTIONS,
  type EmployeeListItem,
  type EmployeeStatus
} from "@shared/types/employee";
import type { ExportListRequest } from "@shared/types/export";
import type { Location } from "@shared/types/location";
import type { RoleListItem } from "@shared/types/role";

type FormState = {
  employeeCode: string;
  firstName: string;
  middleName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  phone: string;
  alternativePhone: string;
  email: string;
  branchId: string;
  department: string;
  jobTitle: string;
  hireDate: string;
  roleId: string;
  username: string;
  status: EmployeeStatus;
  pin: string;
  confirmPin: string;
  password: string;
  photoPath: string | null;
};

const emptyForm: FormState = {
  employeeCode: "",
  firstName: "",
  middleName: "",
  lastName: "",
  gender: "",
  dateOfBirth: "",
  phone: "",
  alternativePhone: "",
  email: "",
  branchId: "",
  department: "",
  jobTitle: "",
  hireDate: "",
  roleId: "",
  username: "",
  status: "active",
  pin: "",
  confirmPin: "",
  password: "",
  photoPath: null
};

function toFormState(employee: EmployeeListItem): FormState {
  return {
    employeeCode: employee.employeeCode,
    firstName: employee.firstName,
    middleName: employee.middleName ?? "",
    lastName: employee.lastName,
    gender: employee.gender ?? "",
    dateOfBirth: employee.dateOfBirth ?? "",
    phone: employee.phone ?? "",
    alternativePhone: employee.alternativePhone ?? "",
    email: employee.email ?? "",
    branchId: employee.branchId ?? "",
    department: employee.department ?? "",
    jobTitle: employee.jobTitle ?? "",
    hireDate: employee.hireDate ?? "",
    roleId: employee.roleId ?? "",
    username: employee.username ?? "",
    status: employee.status,
    pin: "",
    confirmPin: "",
    password: "",
    photoPath: employee.photoPath
  };
}

function statusTone(status: EmployeeStatus): "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "suspended") return "warning";
  return "danger";
}

export function EmployeesRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canCreate = can("employees", "create");
  const canExport = can("employees", "export");
  const canEdit = can("employees", "edit");
  const canDelete = can("employees", "delete");

  const [employees, setEmployees] = useState<EmployeeListItem[] | null>(null);
  const [roles, setRoles] = useState<RoleListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailEmployee, setDetailEmployee] = useState<EmployeeListItem | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [employeeList, roleList, locationList] = await Promise.all([
        window.blueLedger.employee.list(),
        window.blueLedger.role.list(),
        window.blueLedger.location.list()
      ]);
      setEmployees(employeeList);
      setRoles(roleList);
      setLocations(locationList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load employees"));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!form.photoPath) {
      setPhotoPreviewUrl(null);
      return;
    }
    let cancelled = false;
    void window.blueLedger.employee.readPhotoPreview(form.photoPath).then((url) => {
      if (!cancelled) setPhotoPreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [form.photoPath]);

  const roleOptions = useMemo(
    () => roles.map((role) => ({ value: role.id, label: role.roleName })),
    [roles]
  );
  const branchOptions = useMemo(
    () => locations.map((location) => ({ value: location.id, label: location.locationName })),
    [locations]
  );

  const filteredEmployees = useMemo(() => {
    if (!employees) return null;
    const term = searchTerm.trim().toLowerCase();

    return employees.filter((employee) => {
      if (term) {
        const haystack = `${employee.firstName} ${employee.lastName} ${employee.employeeCode} ${employee.phone ?? ""} ${employee.email ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (roleFilter && employee.roleId !== roleFilter) return false;
      if (branchFilter && employee.branchId !== branchFilter) return false;
      if (statusFilter && employee.status !== statusFilter) return false;
      return true;
    });
  }, [employees, searchTerm, roleFilter, branchFilter, statusFilter]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredEmployees) return null;
    const filterParts: string[] = [];
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);
    if (roleFilter) filterParts.push(`Role: ${roleOptions.find((r) => r.value === roleFilter)?.label ?? roleFilter}`);
    if (branchFilter) {
      filterParts.push(`Branch: ${branchOptions.find((b) => b.value === branchFilter)?.label ?? branchFilter}`);
    }
    if (statusFilter) filterParts.push(`Status: ${statusFilter}`);

    return {
      module: "employees",
      title: "Employees",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "Every staff account",
      columns: [
        { key: "code", header: "Code" },
        { key: "name", header: "Name" },
        { key: "role", header: "Role" },
        { key: "branch", header: "Branch" },
        { key: "phone", header: "Phone" },
        { key: "status", header: "Status" },
        { key: "lastLogin", header: "Last Login" }
      ],
      rows: filteredEmployees.map((employee) => ({
        code: employee.employeeCode,
        name: `${employee.firstName} ${employee.lastName}`,
        role: employee.roleName ?? "Unassigned",
        branch: employee.branchName ?? "All storefronts",
        phone: employee.phone ?? "—",
        status: EMPLOYEE_STATUS_OPTIONS.find((option) => option.value === employee.status)?.label ?? employee.status,
        lastLogin: employee.lastLogin ? format(new Date(employee.lastLogin), "MMM d, yyyy") : "Never"
      })),
      fileBaseName: `Employees_${new Date().toISOString().slice(0, 10)}`
    };
  }, [filteredEmployees, searchTerm, roleFilter, branchFilter, statusFilter, roleOptions, branchOptions]);

  const hasActiveFilters = Boolean(searchTerm || roleFilter || branchFilter || statusFilter);

  function clearFilters(): void {
    setSearchTerm("");
    setRoleFilter("");
    setBranchFilter("");
    setStatusFilter("");
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handlePickPhoto(): Promise<void> {
    setPhotoBusy(true);
    try {
      const relativePath = await window.blueLedger.employee.pickPhoto();
      if (relativePath) {
        updateField("photoPath", relativePath);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to attach photo"));
    } finally {
      setPhotoBusy(false);
    }
  }

  function openCreateModal(): void {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setModalOpen(true);
  }

  function openEditModal(employee: EmployeeListItem): void {
    setEditingId(employee.id);
    setForm(toFormState(employee));
    setError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);

    if (!editingId && form.pin !== form.confirmPin) {
      setError("PIN and confirmation do not match");
      setSaving(false);
      return;
    }

    const payload = {
      employeeCode: form.employeeCode,
      firstName: form.firstName,
      middleName: form.middleName,
      lastName: form.lastName,
      gender: form.gender ? form.gender : null,
      dateOfBirth: form.dateOfBirth,
      phone: form.phone,
      alternativePhone: form.alternativePhone,
      email: form.email,
      branchId: form.branchId ? form.branchId : null,
      department: form.department,
      jobTitle: form.jobTitle,
      hireDate: form.hireDate,
      roleId: form.roleId ? form.roleId : null,
      username: form.username,
      status: form.status,
      pin: form.pin,
      confirmPin: form.confirmPin,
      password: form.password,
      photoPath: form.photoPath
    };

    try {
      if (editingId) {
        await window.blueLedger.employee.update(editingId, payload);
      } else {
        await window.blueLedger.employee.create(payload);
      }
      await loadAll();
      setModalOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save employee"));
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(employee: EmployeeListItem, status: EmployeeStatus): Promise<void> {
    setActionError(null);
    try {
      await window.blueLedger.employee.setStatus(employee.id, status);
      await loadAll();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to update status"));
    }
  }

  async function handleDelete(employee: EmployeeListItem): Promise<void> {
    setActionError(null);
    const fullName = `${employee.firstName} ${employee.lastName}`;
    if (!window.confirm(`Delete "${fullName}"? This can't be undone.`)) return;

    try {
      await window.blueLedger.employee.delete(employee.id);
      await loadAll();
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to delete employee"));
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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Employees</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <UserCog className="size-5 text-primary" aria-hidden="true" />
              Staff accounts
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Every person who can access this installation, and the role that governs their permissions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && exportRequest && <ExportMenu request={exportRequest} />}
            {canCreate && (
              <Button type="button" onClick={openCreateModal} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                New Employee
              </Button>
            )}
          </div>
        </div>

        {actionError && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {actionError}
          </div>
        )}

        {employees !== null && employees.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-5">
            <label className="block sm:col-span-2">
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
                  placeholder="Search by name, code, phone, or email"
                  className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </div>
            </label>
            <SelectField
              label="Role"
              value={roleFilter}
              onChange={setRoleFilter}
              options={[{ value: "", label: "All Roles" }, ...roleOptions]}
            />
            <SelectField
              label="Branch"
              value={branchFilter}
              onChange={setBranchFilter}
              options={[{ value: "", label: "All Branches" }, ...branchOptions]}
            />
            <SelectField
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[{ value: "", label: "All Statuses" }, ...EMPLOYEE_STATUS_OPTIONS]}
            />
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="justify-self-start text-[11px] font-extrabold uppercase tracking-wider text-accent hover:underline sm:col-span-5"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <p className="text-sm font-bold text-danger">{loadError}</p>
              <Button type="button" onClick={() => void loadAll()} className="mt-4 h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : employees === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : employees.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <UserCog className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No employees yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Add your first employee to start managing staff access and roles.
              </p>
              {canCreate && (
                <Button type="button" onClick={openCreateModal} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  New Employee
                </Button>
              )}
            </div>
          ) : filteredEmployees && filteredEmployees.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No employees match your filters</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Try a different search term or clear the filters below.
              </p>
              <Button type="button" onClick={clearFilters} className="mt-5 h-9 text-xs">
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[960px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[10%]" />
                  <col className="w-[17%]" />
                  <col className="w-[12%]" />
                  <col className="w-[13%]" />
                  <col className="w-[11%]" />
                  <col className="w-[10%]" />
                  <col className="w-[11%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Code</Th>
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Branch</Th>
                    <Th>Phone</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Last Login</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredEmployees ?? []).map((employee) => (
                    <tr key={employee.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="truncate px-4 py-3 text-xs font-extrabold tabular-nums">
                        {employee.employeeCode}
                      </td>
                      <td className="truncate px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setDetailEmployee(employee)}
                          className="flex min-w-0 items-center gap-2.5 font-extrabold hover:text-accent hover:underline"
                          title={`${employee.firstName} ${employee.lastName}`}
                        >
                          <EmployeeAvatar photoPath={employee.photoPath} />
                          <span className="truncate">
                            {employee.firstName} {employee.lastName}
                          </span>
                        </button>
                      </td>
                      <td className="truncate px-4 py-3 text-sm font-semibold text-muted">
                        {employee.roleName ?? "Unassigned"}
                      </td>
                      <td className="truncate px-4 py-3 text-sm font-semibold text-muted">
                        {employee.branchName ?? "All storefronts"}
                      </td>
                      <td className="truncate px-4 py-3 text-sm tabular-nums">{employee.phone ?? "—"}</td>
                      <td className="px-4 py-3">
                        <select
                          value={employee.status}
                          disabled={!canEdit}
                          onChange={(event) =>
                            void handleStatusChange(employee, event.target.value as EmployeeStatus)
                          }
                          className={cn(
                            "h-8 rounded-md border bg-white px-2 text-[11px] font-extrabold uppercase tracking-wide outline-none disabled:cursor-not-allowed disabled:opacity-60",
                            statusTone(employee.status) === "success"
                              ? "border-success text-success"
                              : statusTone(employee.status) === "warning"
                                ? "border-warning text-warning"
                                : "border-danger text-danger"
                          )}
                        >
                          {EMPLOYEE_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-muted">
                        {employee.lastLogin ? format(new Date(employee.lastLogin), "MMM d, yyyy") : "Never"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setDetailEmployee(employee)}
                            aria-label={`View ${employee.firstName} ${employee.lastName}`}
                            title="View full details"
                            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                          >
                            <Eye className="size-3.5" aria-hidden="true" />
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(employee)}
                              aria-label={`Edit ${employee.firstName} ${employee.lastName}`}
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                            >
                              <Pencil className="size-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => void handleDelete(employee)}
                              aria-label={`Delete ${employee.firstName} ${employee.lastName}`}
                              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition hover:bg-danger-soft hover:text-danger cursor-pointer"
                            >
                              <Trash2 className="size-3.5" aria-hidden="true" />
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
        title={editingId ? "Edit employee" : "New employee"}
        description="Personal details, role assignment, and sign-in credentials for this installation."
        widthClassName="max-w-2xl"
      >
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="grid size-16 flex-none place-items-center overflow-hidden rounded-full border border-line bg-soft">
              {photoPreviewUrl ? (
                <img src={photoPreviewUrl} alt="" className="size-full object-cover" />
              ) : (
                <UserCog className="size-6 text-muted" aria-hidden="true" />
              )}
            </div>
            <div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => void handlePickPhoto()}
                  disabled={photoBusy}
                  className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ImagePlus className="mr-1.5 size-4" aria-hidden="true" />
                  {form.photoPath ? "Replace Photo" : "Upload Photo"}
                </Button>
                {form.photoPath && (
                  <Button
                    type="button"
                    onClick={() => updateField("photoPath", null)}
                    className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
                  >
                    <X className="mr-1 size-3.5" aria-hidden="true" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-[11px] font-semibold text-muted">JPG, PNG, or WEBP · max 5MB</p>
            </div>
          </div>

          <p className="mt-5 text-[11px] font-extrabold uppercase tracking-wider text-muted">
            Personal Information
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="First Name"
              value={form.firstName}
              onChange={(value) => updateField("firstName", value)}
              placeholder="e.g. Jane"
              required
            />
            <Field
              label="Last Name"
              value={form.lastName}
              onChange={(value) => updateField("lastName", value)}
              placeholder="e.g. Doe"
              required
            />
            <Field
              label="Middle Name"
              value={form.middleName}
              onChange={(value) => updateField("middleName", value)}
              placeholder="Optional"
            />
            <SelectField
              label="Gender"
              value={form.gender}
              onChange={(value) => updateField("gender", value)}
              options={[{ value: "", label: "Prefer not to say" }, ...GENDER_OPTIONS]}
            />
            <Field
              label="Date of Birth"
              type="date"
              value={form.dateOfBirth}
              onChange={(value) => updateField("dateOfBirth", value)}
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
              placeholder="e.g. jane.doe@yourbusiness.co.ke"
            />
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Employment</p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Employee Code"
                value={form.employeeCode}
                onChange={(value) => updateField("employeeCode", value)}
                placeholder="e.g. EMP-001"
                required
              />
              <SelectField
                label="Role"
                value={form.roleId}
                onChange={(value) => updateField("roleId", value)}
                options={[{ value: "", label: "Unassigned" }, ...roleOptions]}
              />
              <SelectField
                label="Assigned Branch"
                value={form.branchId}
                onChange={(value) => updateField("branchId", value)}
                options={[{ value: "", label: "No branch — sees every storefront" }, ...branchOptions]}
              />
              <Field
                label="Job Title"
                value={form.jobTitle}
                onChange={(value) => updateField("jobTitle", value)}
                placeholder="e.g. Branch Cashier"
              />
              <Field
                label="Department"
                value={form.department}
                onChange={(value) => updateField("department", value)}
                placeholder="e.g. Retail Operations"
              />
              <Field
                label="Hire Date"
                type="date"
                value={form.hireDate}
                onChange={(value) => updateField("hireDate", value)}
              />
              <SelectField
                label="Status"
                value={form.status}
                onChange={(value) => updateField("status", value as EmployeeStatus)}
                options={EMPLOYEE_STATUS_OPTIONS}
              />
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-muted">
              <KeyRound className="size-3.5" aria-hidden="true" />
              Sign-in Credentials
            </p>
            <p className="mt-1 text-[11px] font-semibold text-muted">
              PINs and passwords are hashed before storage — Blue Ledger never stores them in plain text.
              {editingId && " Leave blank to keep the current value."}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="PIN (6 digits)"
                type="password"
                maxLength={6}
                value={form.pin}
                onChange={(value) => updateField("pin", value)}
                placeholder={editingId ? "Leave blank to keep current PIN" : "e.g. 483920"}
                required={!editingId}
              />
              <Field
                label="Confirm PIN"
                type="password"
                maxLength={6}
                value={form.confirmPin}
                onChange={(value) => updateField("confirmPin", value)}
                placeholder="Re-enter PIN"
                required={!editingId}
              />
              <Field
                label="Username"
                value={form.username}
                onChange={(value) => updateField("username", value)}
                placeholder="Optional — for future sign-in"
              />
              <Field
                label="Password"
                type="password"
                value={form.password}
                onChange={(value) => updateField("password", value)}
                placeholder={editingId ? "Leave blank to keep current password" : "Optional, min. 8 characters"}
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
            <Button
              type="submit"
              disabled={saving}
              className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
              {saving ? "Saving..." : editingId ? "Save changes" : "Create employee"}
            </Button>
          </div>
        </form>
      </Modal>

      {detailEmployee && (
        <EmployeeDetailModal employee={detailEmployee} onClose={() => setDetailEmployee(null)} />
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

function EmployeeAvatar({ photoPath }: { photoPath: string | null }): React.JSX.Element {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photoPath) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    void window.blueLedger.employee.readPhotoPreview(photoPath).then((url) => {
      if (!cancelled) setPreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [photoPath]);

  return (
    <div className="grid size-8 flex-none place-items-center overflow-hidden rounded-full border border-line bg-soft">
      {previewUrl ? (
        <img src={previewUrl} alt="" className="size-full object-cover" />
      ) : (
        <UserCog className="size-3.5 text-muted" aria-hidden="true" />
      )}
    </div>
  );
}
