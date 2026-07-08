import { getDatabase } from "@main/database/connection";
import type { EmployeeCreateInput, EmployeeUpdateInput } from "@shared/schemas/employee";
import type { Employee, EmployeeListItem, EmployeeStatus, EmployeeSyncStatus, Gender } from "@shared/types/employee";

export type EmployeeRow = {
  id: string;
  tenant_id: string;
  employee_code: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: string | null;
  date_of_birth: string | null;
  phone: string | null;
  alternative_phone: string | null;
  email: string | null;
  branch_id: string | null;
  department: string | null;
  job_title: string | null;
  hire_date: string | null;
  role_id: string | null;
  pin_hash: string | null;
  username: string | null;
  password_hash: string | null;
  status: string;
  last_login: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  sync_status: string;
  last_synced_at: string | null;
  photo_path: string | null;
};

export type EmployeeListRow = EmployeeRow & {
  role_name: string | null;
  branch_name: string | null;
};

/** Pass null for locationId to see every branch's employees (e.g. a super-admin with no assigned branch). */
export function findAllEmployeeRows(tenantId: string, locationId: string | null): EmployeeListRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT e.*, r.role_name AS role_name, l.location_name AS branch_name
      FROM employees e
      LEFT JOIN roles r ON r.id = e.role_id
      LEFT JOIN locations l ON l.id = e.branch_id
      WHERE e.tenant_id = ?
        AND (? IS NULL OR e.branch_id = ?)
      ORDER BY e.first_name ASC, e.last_name ASC
    `
    )
    .all(tenantId, locationId, locationId) as EmployeeListRow[];
}

export function findEmployeeRowById(id: string): EmployeeRow | undefined {
  return getDatabase().prepare("SELECT * FROM employees WHERE id = ?").get(id) as
    | EmployeeRow
    | undefined;
}

export function findEmployeeByCodeRow(
  tenantId: string,
  employeeCode: string,
  excludeId?: string
): EmployeeRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId ? [tenantId, employeeCode, excludeId] : [tenantId, employeeCode];
  return getDatabase()
    .prepare(
      `SELECT * FROM employees WHERE tenant_id = ? AND lower(employee_code) = lower(?) ${excludeClause}`
    )
    .get(...params) as EmployeeRow | undefined;
}

export function findEmployeeByUsernameRow(
  tenantId: string,
  username: string,
  excludeId?: string
): EmployeeRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId ? [tenantId, username, excludeId] : [tenantId, username];
  return getDatabase()
    .prepare(`SELECT * FROM employees WHERE tenant_id = ? AND lower(username) = lower(?) ${excludeClause}`)
    .get(...params) as EmployeeRow | undefined;
}

export function countEmployeesByRoleRow(roleId: string): number {
  const row = getDatabase()
    .prepare("SELECT COUNT(*) as count FROM employees WHERE role_id = ?")
    .get(roleId) as { count: number };
  return row.count;
}

export function insertEmployeeRow(
  input: EmployeeCreateInput & {
    id: string;
    tenantId: string;
    pinHash: string;
    passwordHash: string | null;
    createdBy: string | null;
  }
): EmployeeRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO employees (
        id, tenant_id, employee_code, first_name, middle_name, last_name, gender, date_of_birth,
        phone, alternative_phone, email, branch_id, department, job_title, hire_date, role_id,
        pin_hash, username, password_hash, status, photo_path, created_at, updated_at, created_by, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.employeeCode,
      input.firstName,
      input.middleName,
      input.lastName,
      input.gender,
      input.dateOfBirth,
      input.phone,
      input.alternativePhone,
      input.email,
      input.branchId,
      input.department,
      input.jobTitle,
      input.hireDate,
      input.roleId,
      input.pinHash,
      input.username,
      input.passwordHash,
      input.status,
      input.photoPath,
      now,
      now,
      input.createdBy
    );

  const row = findEmployeeRowById(input.id);
  if (!row) {
    throw new Error("Failed to create employee record");
  }
  return row;
}

export function updateEmployeeRow(
  id: string,
  input: EmployeeUpdateInput & { pinHash: string | null; passwordHash: string | null }
): EmployeeRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE employees SET
        employee_code = ?,
        first_name = ?,
        middle_name = ?,
        last_name = ?,
        gender = ?,
        date_of_birth = ?,
        phone = ?,
        alternative_phone = ?,
        email = ?,
        branch_id = ?,
        department = ?,
        job_title = ?,
        hire_date = ?,
        role_id = ?,
        pin_hash = ?,
        username = ?,
        password_hash = ?,
        status = ?,
        photo_path = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.employeeCode,
      input.firstName,
      input.middleName,
      input.lastName,
      input.gender,
      input.dateOfBirth,
      input.phone,
      input.alternativePhone,
      input.email,
      input.branchId,
      input.department,
      input.jobTitle,
      input.hireDate,
      input.roleId,
      input.pinHash,
      input.username,
      input.passwordHash,
      input.status,
      input.photoPath,
      now,
      id
    );

  const row = findEmployeeRowById(id);
  if (!row) {
    throw new Error("Employee not found after update");
  }
  return row;
}

export function setEmployeeStatusRow(id: string, status: EmployeeStatus): EmployeeRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE employees SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(status, now, id);

  const row = findEmployeeRowById(id);
  if (!row) {
    throw new Error("Employee not found after status update");
  }
  return row;
}

export function deleteEmployeeRow(id: string): void {
  getDatabase().prepare("DELETE FROM employees WHERE id = ?").run(id);
}

/** Records a failed login: bumps the attempt counter and optionally sets a lockout expiry. */
export function recordFailedLoginRow(
  id: string,
  failedAttempts: number,
  lockedUntil: string | null
): void {
  getDatabase()
    .prepare("UPDATE employees SET failed_login_attempts = ?, locked_until = ? WHERE id = ?")
    .run(failedAttempts, lockedUntil, id);
}

/** Records a successful login: clears the failure counter/lockout and stamps last_login. */
export function recordSuccessfulLoginRow(id: string, loginAt: string): void {
  getDatabase()
    .prepare(
      "UPDATE employees SET last_login = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?"
    )
    .run(loginAt, id);
}

export function mapEmployeeRow(row: EmployeeRow): Employee {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    employeeCode: row.employee_code,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    gender: row.gender as Gender | null,
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    alternativePhone: row.alternative_phone,
    email: row.email,
    branchId: row.branch_id,
    department: row.department,
    jobTitle: row.job_title,
    hireDate: row.hire_date,
    roleId: row.role_id,
    username: row.username,
    status: row.status as EmployeeStatus,
    hasPin: Boolean(row.pin_hash),
    hasPassword: Boolean(row.password_hash),
    lastLogin: row.last_login,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    syncStatus: row.sync_status as EmployeeSyncStatus,
    lastSyncedAt: row.last_synced_at,
    photoPath: row.photo_path
  };
}

export function mapEmployeeListRow(row: EmployeeListRow): EmployeeListItem {
  return {
    ...mapEmployeeRow(row),
    roleName: row.role_name,
    branchName: row.branch_name
  };
}
