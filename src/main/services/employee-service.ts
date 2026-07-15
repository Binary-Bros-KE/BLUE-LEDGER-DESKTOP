import { randomUUID } from "node:crypto";
import * as employeeRepository from "@main/database/repositories/employee-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as roleRepository from "@main/database/repositories/role-repository";
import { hashSecret } from "@main/lib/password-hash";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { deleteManagedEmployeePhoto } from "@main/services/image-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { employeeCreateSchema, employeeUpdateSchema, type EmployeeCreateInput } from "@shared/schemas/employee";
import type { Employee, EmployeeListItem, EmployeeStatus } from "@shared/types/employee";

const DEFAULT_SYSTEM_EMPLOYEE_CODE = "SYSTEM";
/** Bootstrap-only PIN for the seeded "System" account — change it as soon as real login is set up. */
const DEFAULT_SYSTEM_PIN = "000000";

function assertRoleBelongsToTenant(roleId: string | null, tenantId: string): void {
  if (!roleId) return;
  const row = roleRepository.findRoleRowById(roleId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Selected role was not found");
  }
}

function assertBranchBelongsToTenant(branchId: string | null, tenantId: string): void {
  if (!branchId) return;
  const row = locationRepository.findLocationRowById(branchId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Selected branch was not found");
  }
}

function assertUniqueFields(
  tenantId: string,
  fields: { employeeCode: string; username: string | null },
  excludeId?: string
): void {
  if (employeeRepository.findEmployeeByCodeRow(tenantId, fields.employeeCode, excludeId)) {
    throw new Error(`Employee code "${fields.employeeCode}" is already in use`);
  }
  if (
    fields.username &&
    employeeRepository.findEmployeeByUsernameRow(tenantId, fields.username, excludeId)
  ) {
    throw new Error(`Username "${fields.username}" is already in use`);
  }
}

/** Shared by the public (permission-gated) createEmployee and the unguarded bootstrap seed path. */
function createEmployeeInternal(
  parsed: EmployeeCreateInput,
  tenantId: string,
  createdBy: string | null
): Employee {
  assertRoleBelongsToTenant(parsed.roleId, tenantId);
  assertBranchBelongsToTenant(parsed.branchId, tenantId);
  assertUniqueFields(tenantId, parsed);

  const pinHash = hashSecret(parsed.pin);
  const passwordHash = parsed.password ? hashSecret(parsed.password) : null;

  const row = employeeRepository.insertEmployeeRow({
    ...parsed,
    id: `employee_${randomUUID()}`,
    tenantId,
    pinHash,
    passwordHash,
    createdBy
  });
  return employeeRepository.mapEmployeeRow(row);
}

/**
 * Seeds a single "System" employee (Owner role, PIN 000000) the first time this tenant has no
 * employees at all, so there's always a known way to sign in once the login flow exists. Called
 * once from app bootstrap, before anyone is signed in — it must not go through the permission-gated
 * createEmployee(), since nobody can hold a permission before an employee (and a session) exists.
 */
export function ensureDefaultSystemEmployee(tenantId: string): void {
  const hasAnyEmployee = employeeRepository.findAllEmployeeRows(tenantId, null).length > 0;
  if (hasAnyEmployee) return;

  const ownerRoleRow = roleRepository
    .findAllRoleRows(tenantId)
    .find((role) => role.role_name === "Owner");

  const parsed = employeeCreateSchema.parse({
    employeeCode: DEFAULT_SYSTEM_EMPLOYEE_CODE,
    firstName: "System",
    middleName: null,
    lastName: "Administrator",
    gender: null,
    dateOfBirth: null,
    phone: null,
    alternativePhone: null,
    email: null,
    branchId: null,
    department: null,
    jobTitle: "System Administrator",
    hireDate: null,
    roleId: ownerRoleRow?.id ?? null,
    username: "system",
    status: "active",
    pin: DEFAULT_SYSTEM_PIN,
    confirmPin: DEFAULT_SYSTEM_PIN,
    password: null
  });

  createEmployeeInternal(parsed, tenantId, null);

  console.log(
    `[Blue Ledger] Seeded default "System" employee (code ${DEFAULT_SYSTEM_EMPLOYEE_CODE}, PIN ${DEFAULT_SYSTEM_PIN}). Change this once real login is in place.`
  );
}

export function listEmployees(): EmployeeListItem[] {
  requirePermission("employees", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return employeeRepository
    .findAllEmployeeRows(tenantId, locationId)
    .map(employeeRepository.mapEmployeeListRow);
}

/** A narrower read path for the Salaries "Process Salary" employee picker — gated by the ability to
 * process payroll rather than full employee management, so a Manager who can run payroll but isn't
 * granted HR administration can still pick who to pay. */
export function listEmployeesForSalaryPicker(): EmployeeListItem[] {
  requirePermission("salaries", "create");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return employeeRepository
    .findAllEmployeeRows(tenantId, locationId)
    .map(employeeRepository.mapEmployeeListRow);
}

export function getEmployee(id: string): Employee {
  requirePermission("employees", "view");
  const row = employeeRepository.findEmployeeRowById(id);
  if (!row) {
    throw new Error("Employee not found");
  }
  return employeeRepository.mapEmployeeRow(row);
}

export function createEmployee(input: unknown): Employee {
  requirePermission("employees", "create");
  const parsed = employeeCreateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  return createEmployeeInternal(parsed, tenantId, getCurrentEmployeeId());
}

export function updateEmployee(id: string, input: unknown): Employee {
  requirePermission("employees", "edit");
  const parsed = employeeUpdateSchema.parse(input);
  const existing = employeeRepository.findEmployeeRowById(id);
  if (!existing) {
    throw new Error("Employee not found");
  }

  const { tenantId } = getCurrentTenant();
  assertRoleBelongsToTenant(parsed.roleId, tenantId);
  assertBranchBelongsToTenant(parsed.branchId, tenantId);
  assertUniqueFields(tenantId, parsed, id);

  const pinHash = parsed.pin ? hashSecret(parsed.pin) : existing.pin_hash;
  const passwordHash = parsed.password ? hashSecret(parsed.password) : existing.password_hash;

  const row = employeeRepository.updateEmployeeRow(id, {
    ...parsed,
    pinHash,
    passwordHash
  });

  if (existing.photo_path && existing.photo_path !== parsed.photoPath) {
    deleteManagedEmployeePhoto(existing.photo_path);
  }

  return employeeRepository.mapEmployeeRow(row);
}

export function setEmployeeStatus(id: string, status: EmployeeStatus): Employee {
  requirePermission("employees", "edit");
  const row = employeeRepository.setEmployeeStatusRow(id, status);
  return employeeRepository.mapEmployeeRow(row);
}

export function deleteEmployee(id: string): { id: string } {
  requirePermission("employees", "delete");
  const existing = employeeRepository.findEmployeeRowById(id);
  if (!existing) {
    throw new Error("Employee not found");
  }
  employeeRepository.deleteEmployeeRow(id);
  deleteManagedEmployeePhoto(existing.photo_path);
  return { id };
}
