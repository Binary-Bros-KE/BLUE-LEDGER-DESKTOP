import { format } from "date-fns";
import { CheckCircle2, XCircle } from "lucide-react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Modal } from "@renderer/shared/components/Modal";
import { GENDER_OPTIONS, type EmployeeListItem, type EmployeeStatus } from "@shared/types/employee";

function formatDate(value: string | null, pattern = "MMM d, yyyy"): string {
  if (!value) return "—";
  try {
    return format(new Date(value), pattern);
  } catch {
    return value;
  }
}

function genderLabel(value: string | null): string {
  return GENDER_OPTIONS.find((option) => option.value === value)?.label ?? "—";
}

function statusTone(status: EmployeeStatus): "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "suspended") return "warning";
  return "danger";
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-soft px-3 py-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-ink">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">{title}</p>
      <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">{children}</div>
    </div>
  );
}

export function EmployeeDetailModal({
  employee,
  onClose
}: {
  employee: EmployeeListItem;
  onClose: () => void;
}): React.JSX.Element {
  const fullName = [employee.firstName, employee.middleName, employee.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <Modal
      open
      onClose={onClose}
      title={fullName}
      description={`Employee Code ${employee.employeeCode}`}
      widthClassName="max-w-2xl"
    >
      <div className="flex flex-wrap items-center gap-2">
        <DashedPill tone={statusTone(employee.status)}>{employee.status}</DashedPill>
        <DashedPill tone="accent">{employee.roleName ?? "No role assigned"}</DashedPill>
      </div>

      <div className="mt-5 space-y-5">
        <Section title="Personal Information">
          <InfoRow label="Gender" value={genderLabel(employee.gender)} />
          <InfoRow label="Date of Birth" value={formatDate(employee.dateOfBirth)} />
          <InfoRow label="Phone" value={employee.phone ?? "—"} />
          <InfoRow label="Alternative Phone" value={employee.alternativePhone ?? "—"} />
          <InfoRow label="Email" value={employee.email ?? "—"} />
        </Section>

        <Section title="Employment">
          <InfoRow label="Assigned Branch" value={employee.branchName ?? "Unassigned"} />
          <InfoRow label="Department" value={employee.department ?? "—"} />
          <InfoRow label="Job Title" value={employee.jobTitle ?? "—"} />
          <InfoRow label="Hire Date" value={formatDate(employee.hireDate)} />
          <InfoRow label="Role" value={employee.roleName ?? "Unassigned"} />
        </Section>

        <Section title="Security & Access">
          <InfoRow label="Username" value={employee.username ?? "Not set"} />
          <InfoRow
            label="PIN"
            value={
              <span className="flex items-center gap-1.5">
                {employee.hasPin ? (
                  <CheckCircle2 className="size-3.5 flex-none text-success" aria-hidden="true" />
                ) : (
                  <XCircle className="size-3.5 flex-none text-danger" aria-hidden="true" />
                )}
                {employee.hasPin ? "Configured" : "Not set"}
              </span>
            }
          />
          <InfoRow
            label="Password"
            value={
              <span className="flex items-center gap-1.5">
                {employee.hasPassword ? (
                  <CheckCircle2 className="size-3.5 flex-none text-success" aria-hidden="true" />
                ) : (
                  <XCircle className="size-3.5 flex-none text-danger" aria-hidden="true" />
                )}
                {employee.hasPassword ? "Configured" : "Not set"}
              </span>
            }
          />
          <InfoRow label="Last Login" value={formatDate(employee.lastLogin, "MMM d, yyyy · HH:mm")} />
          <InfoRow label="Failed Login Attempts" value={employee.failedLoginAttempts} />
          <InfoRow label="Locked Until" value={formatDate(employee.lockedUntil, "MMM d, yyyy · HH:mm")} />
        </Section>

        <Section title="Record Info">
          <InfoRow label="Created" value={formatDate(employee.createdAt, "MMM d, yyyy · HH:mm")} />
          <InfoRow label="Last Updated" value={formatDate(employee.updatedAt, "MMM d, yyyy · HH:mm")} />
          <InfoRow label="Sync Status" value={employee.syncStatus} />
        </Section>
      </div>
    </Modal>
  );
}
