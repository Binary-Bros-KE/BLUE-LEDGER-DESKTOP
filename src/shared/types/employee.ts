export type EmployeeId = string;

export const EMPLOYEE_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "terminated", label: "Terminated" }
] as const;

export type EmployeeStatus = (typeof EMPLOYEE_STATUS_OPTIONS)[number]["value"];

export const GENDER_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" }
] as const;

export type Gender = (typeof GENDER_OPTIONS)[number]["value"];

export type EmployeeSyncStatus = "pending" | "synced" | "syncing" | "error";

/** Fields exposed in the create/edit form (never the hashes themselves). */
export type EmployeeInputFields = {
  employeeCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: Gender | null;
  dateOfBirth: string | null;
  phone: string | null;
  alternativePhone: string | null;
  email: string | null;
  branchId: string | null;
  department: string | null;
  jobTitle: string | null;
  hireDate: string | null;
  roleId: string | null;
  username: string | null;
  status: EmployeeStatus;
};

/**
 * Full employee record as read by the renderer. pin_hash/password_hash never leave the main
 * process — only whether each is set, so the UI can show "PIN configured" style hints.
 */
export type Employee = EmployeeInputFields & {
  id: EmployeeId;
  tenantId: string;
  hasPin: boolean;
  hasPassword: boolean;
  lastLogin: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  syncStatus: EmployeeSyncStatus;
  lastSyncedAt: string | null;
};

/** Employee row enriched with joined display names for the list view. */
export type EmployeeListItem = Employee & {
  roleName: string | null;
  branchName: string | null;
};
