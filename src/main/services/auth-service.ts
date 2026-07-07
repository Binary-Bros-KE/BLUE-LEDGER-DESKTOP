import * as employeeRepository from "@main/database/repositories/employee-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as roleRepository from "@main/database/repositories/role-repository";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { verifySecret } from "@main/lib/password-hash";
import { loginInputSchema } from "@shared/schemas/auth";
import type { AuthSession } from "@shared/types/auth";
import type { EmployeeRow } from "@main/database/repositories/employee-repository";
import type { PermissionAction, PermissionModuleKey } from "@shared/types/role";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/** Held in main-process memory only — cleared on logout or app restart. Never persisted. */
let currentSession: AuthSession | null = null;

function buildSession(row: EmployeeRow, tenantId: string): AuthSession {
  const roleRow = row.role_id ? roleRepository.findRoleRowById(row.role_id) : undefined;
  const role = roleRow ? roleRepository.mapRoleRow(roleRow) : null;
  const branchRow = row.branch_id ? locationRepository.findLocationRowById(row.branch_id) : undefined;

  return {
    tenantId,
    employee: {
      id: row.id,
      employeeCode: row.employee_code,
      firstName: row.first_name,
      lastName: row.last_name,
      jobTitle: row.job_title,
      photoPath: row.photo_path
    },
    role: role ? { id: role.id, roleName: role.roleName } : null,
    branch: branchRow ? { id: branchRow.id, locationName: branchRow.location_name } : null,
    permissions: role?.permissions ?? {}
  };
}

export function login(input: unknown): AuthSession {
  const parsed = loginInputSchema.parse(input);

  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) {
    throw new Error("Tenant has not been initialized yet");
  }
  const tenantId = tenantRow.id;

  const row = employeeRepository.findEmployeeByCodeRow(tenantId, parsed.employeeCode);
  if (!row) {
    throw new Error("Invalid employee code or PIN");
  }

  if (row.status !== "active") {
    throw new Error(`This account is ${row.status} and can't sign in. Contact an administrator.`);
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    const until = new Date(row.locked_until).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
    throw new Error(`This account is locked until ${until}. Try again later.`);
  }

  if (!row.pin_hash || !verifySecret(parsed.pin, row.pin_hash)) {
    const nextAttempts = row.failed_login_attempts + 1;

    if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
      employeeRepository.recordFailedLoginRow(row.id, nextAttempts, lockedUntil);
      throw new Error(`Too many failed attempts. This account is locked for ${LOCKOUT_MINUTES} minutes.`);
    }

    employeeRepository.recordFailedLoginRow(row.id, nextAttempts, null);
    throw new Error("Invalid employee code or PIN");
  }

  employeeRepository.recordSuccessfulLoginRow(row.id, new Date().toISOString());

  const session = buildSession(row, tenantId);
  currentSession = session;
  return session;
}

export function logout(): void {
  currentSession = null;
}

export function getSession(): AuthSession | null {
  return currentSession;
}

/** Non-throwing permission check, for UI-side gating decisions made in the main process. */
export function hasPermission(module: PermissionModuleKey, action: PermissionAction): boolean {
  return currentSession?.permissions[module]?.includes(action) ?? false;
}

/** Throws if nobody is signed in, or the signed-in employee's role lacks this permission. */
export function requirePermission(module: PermissionModuleKey, action: PermissionAction): void {
  if (!currentSession) {
    throw new Error("You must be signed in to do that");
  }
  if (!hasPermission(module, action)) {
    throw new Error(`Your role doesn't have permission to ${action} ${module.replace(/_/g, " ")}`);
  }
}

/** The signed-in employee's id, for stamping created_by/updated_by/performed_by columns. Null when signed out. */
export function getCurrentEmployeeId(): string | null {
  return currentSession?.employee.id ?? null;
}
