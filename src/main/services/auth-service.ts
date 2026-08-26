import * as employeeRepository from "@main/database/repositories/employee-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as roleRepository from "@main/database/repositories/role-repository";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { verifySecret } from "@main/lib/password-hash";
import { loginInputSchema } from "@shared/schemas/auth";
import type { AuthSession } from "@shared/types/auth";
import type { EmployeeRow } from "@main/database/repositories/employee-repository";
import type { LogoRatio } from "@shared/types/logo";
import type { PermissionAction, PermissionModuleKey } from "@shared/types/role";

const MAX_FAILED_ATTEMPTS = 10;
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
    role: role ? { id: role.id, roleName: role.roleName, isSuperAdmin: role.isSuperAdmin } : null,
    branch: branchRow
      ? {
          id: branchRow.id,
          locationName: branchRow.location_name,
          logoPath: branchRow.logo_path,
          logoRatio: branchRow.logo_ratio as LogoRatio | null
        }
      : null,
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

/**
 * Sets the active session for a known employee id, bypassing the PIN check entirely — never wired
 * to any IPC channel, callable only from trusted in-process dev tooling (the demo-data seed script,
 * gated behind BLUE_LEDGER_SEED_DEMO). Lets the seed script attribute sales/purchases/etc. to the
 * correct real employee (and therefore the correct branch, via that employee's own assignment)
 * without needing to know anyone's PIN.
 */
export function setSessionForSeeding(employeeId: string): AuthSession {
  const row = employeeRepository.findEmployeeRowById(employeeId);
  if (!row) {
    throw new Error(`Seed: employee ${employeeId} not found`);
  }
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) {
    throw new Error("Tenant has not been initialized yet");
  }
  const session = buildSession(row, tenantRow.id);
  currentSession = session;
  return session;
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

/**
 * Throws unless AT LEAST ONE of the given (module, action) pairs passes. Used by a handful of
 * report-service reads that a dashboard widget needs even for a role that shouldn't see the full
 * Reports nav section (which is gated on "reports" alone) — e.g. a Cashier can read their own sales
 * financial data via "sales:view" without being granted "reports:view" (and the Reports tabs that
 * comes with).
 */
export function requirePermissionAnyOf(checks: Array<[PermissionModuleKey, PermissionAction]>): void {
  if (!currentSession) {
    throw new Error("You must be signed in to do that");
  }
  if (checks.some(([module, action]) => hasPermission(module, action))) {
    return;
  }
  const described = checks.map(([module, action]) => `${action} ${module.replace(/_/g, " ")}`).join(" or ");
  throw new Error(`Your role doesn't have permission to ${described}`);
}

/**
 * Throws if nobody is signed in — for data every employee needs to do their job (e.g. picking a
 * payment method during checkout) but that shouldn't require a specific module permission. Module
 * permissions like "payment_methods" still gate managing (create/edit/delete) that data, and the nav
 * item that leads there — this is only for reading it as an input to an already-permitted action.
 */
export function requireSignedIn(): void {
  if (!currentSession) {
    throw new Error("You must be signed in to do that");
  }
}

/** The signed-in employee's id, for stamping created_by/updated_by/performed_by columns. Null when signed out. */
export function getCurrentEmployeeId(): string | null {
  return currentSession?.employee.id ?? null;
}

/** The signed-in employee's display name, for auto-filling "who handled this" fields (e.g. an
 * Expense's paidBy) that are otherwise free text. Null when signed out. */
export function getCurrentEmployeeName(): string | null {
  if (!currentSession) return null;
  return `${currentSession.employee.firstName} ${currentSession.employee.lastName}`.trim();
}

/**
 * The branch this session's data visibility is restricted to. Null means no restriction — either
 * nobody is signed in, or the signed-in employee has no branch assigned, which is exactly how a
 * super-admin (able to see every storefront's records) is defined: an account with no single branch.
 */
export function getCurrentBranchScope(): string | null {
  return currentSession?.branch?.id ?? null;
}

/** Whether the signed-in employee's role carries Role.isSuperAdmin — see that field's own doc
 * comment. Deliberately NOT the same thing as "branch-less" (getCurrentBranchScope() === null); a
 * branch-less Manager-equivalent role is theoretically possible even though DEFAULT_SYSTEM_ROLES
 * never creates one. Drives the Working Hours lockout bypass and gates that feature's own config UI. */
export function getCurrentIsSuperAdmin(): boolean {
  return currentSession?.role?.isSuperAdmin ?? false;
}

/** Throws unless the signed-in employee's role is flagged Role.isSuperAdmin — deliberately NOT a
 * module/action permission check like requirePermission (see Working Hours' own design notes: this
 * feature is meant to be Super-Admin-exclusive, not delegable via the normal Roles & Permissions
 * grid). */
export function requireSuperAdmin(): void {
  if (!currentSession) {
    throw new Error("You must be signed in to do that");
  }
  if (!getCurrentIsSuperAdmin()) {
    throw new Error("Only your Super Admin can do that");
  }
}

/**
 * Report-only variant of getCurrentBranchScope: a branch-scoped session always gets its own
 * branch regardless of what's passed in (prevents a crafted IPC payload from letting a
 * branch-scoped Manager peek at another branch's reports). Only a branch-less session (Super
 * Admin) can actually narrow anything — passing a storefront id there scopes to just that one;
 * passing null/undefined keeps the existing "every location" behavior.
 */
export function resolveReportLocationScope(explicitLocationId?: string | null): string | null {
  const branchScope = getCurrentBranchScope();
  if (branchScope !== null) return branchScope;
  return explicitLocationId ?? null;
}
