import { randomUUID } from "node:crypto";
import * as employeeRepository from "@main/database/repositories/employee-repository";
import * as roleRepository from "@main/database/repositories/role-repository";
import { getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { roleInputSchema } from "@shared/schemas/role";
import {
  PERMISSION_MODULES,
  type PermissionAction,
  type PermissionModuleKey,
  type PermissionsMap,
  type Role,
  type RoleListItem,
  type RolePickerItem
} from "@shared/types/role";

const MODULE_ACTIONS = new Map<PermissionModuleKey, readonly PermissionAction[]>(
  PERMISSION_MODULES.map((module) => [module.key, module.actions])
);

const ALL_MODULE_KEYS = PERMISSION_MODULES.map((module) => module.key);

/** Drops unknown module keys and actions that don't apply to a given module. */
function sanitizePermissions(input: Record<string, PermissionAction[]>): PermissionsMap {
  const sanitized: PermissionsMap = {};

  for (const [key, actions] of Object.entries(input)) {
    const allowedActions = MODULE_ACTIONS.get(key as PermissionModuleKey);
    if (!allowedActions) continue;

    const validActions = actions.filter((action) => allowedActions.includes(action));
    if (validActions.length > 0) {
      sanitized[key as PermissionModuleKey] = validActions;
    }
  }

  return sanitized;
}

function fullAccess(moduleKeys: PermissionModuleKey[]): PermissionsMap {
  const map: PermissionsMap = {};
  for (const key of moduleKeys) {
    map[key] = [...(MODULE_ACTIONS.get(key) ?? [])];
  }
  return map;
}

const DEFAULT_SYSTEM_ROLES: Array<{
  roleName: string;
  description: string;
  permissions: PermissionsMap;
  isSuperAdmin?: boolean;
}> = [
  {
    roleName: "Super Admin",
    description:
      "Cross-branch oversight. Leave this employee's branch unassigned so they see every storefront's data instead of being limited to one.",
    permissions: fullAccess(ALL_MODULE_KEYS),
    // The only default role this is ever true for — see Role.isSuperAdmin's own doc comment for why
    // this exists as a real flag rather than matching roleName === "Super Admin" everywhere.
    isSuperAdmin: true
  },
  {
    roleName: "Manager",
    description: "Runs daily operations across sales, inventory, and staff.",
    permissions: {
      ...fullAccess([
        "dashboard",
        "products",
        "categories",
        "inventory",
        "stock_transfers",
        "sales",
        "quotations",
        "purchases",
        "customers",
        "suppliers",
        "riders",
        "expenses",
        "expense_categories",
        "local_purchases",
        "borrows",
        "salaries",
        "reports",
        "employees",
        "approvals"
      ]),
      // Manager requests stock like a Cashier does — approving a request is Storekeeper/Super Admin only.
      stock_requests: ["view", "create"]
      // Deliberately no "main_store" (the cross-storefront Main Store screen — Storekeeper/Super
      // Admin only) and no "locations" (Storefronts setup — Super Admin only). Manager still sees
      // their own storefront's stock via "inventory" and can create/edit products from Products.
    }
  },
  {
    roleName: "Cashier",
    description: "Handles checkout and customer-facing sales.",
    permissions: {
      dashboard: ["view"],
      products: ["view"],
      categories: ["view"],
      sales: ["view", "create", "edit", "delete"],
      quotations: ["view", "create", "edit"],
      customers: ["view", "create"],
      riders: ["view", "create", "edit"],
      // Deliberately NOT "suppliers" — per client request, a Cashier shouldn't see the Suppliers tab
      // or any supplier's balance. They can still pick/quick-create a supplier when sourcing a
      // product locally on Checkout/Invoices/Quotations — see supplier-service.ts's
      // listSupplierPickerOptions, widened via requirePermissionAnyOf instead of granting this module.
      payment_methods: ["view"],
      stock_transfers: ["view"],
      salaries: ["view"],
      stock_requests: ["view", "create"],
      // Small day-to-day buys (tape, delivery bags) — deliberately NOT "expenses" itself, which stays
      // Manager/Super Admin only (rent, wifi, salary-as-expense entries, etc.). See
      // local-purchase-service.ts for why this is safe: it's a hard, query-level filter, not a UI hide.
      local_purchases: ["view", "create", "edit", "delete"]
    }
  },
  {
    roleName: "Storekeeper",
    description: "Manages stock levels, receiving, and transfers between locations.",
    permissions: {
      dashboard: ["view"],
      products: ["view", "create", "edit"],
      categories: ["view"],
      inventory: ["view", "create", "edit"],
      main_store: ["view", "create", "edit", "export"],
      stock_transfers: ["view", "create", "approve"],
      purchases: ["view", "create"],
      suppliers: ["view", "create"],
      salaries: ["view"],
      stock_requests: ["view", "approve"],
      // The Storekeeper is the role most directly responsible for physical stock leaving/entering a
      // storefront — a natural fit for recording/returning borrowed or lent stock.
      borrows: ["view", "create", "edit", "export"]
    }
  }
];

/**
 * Seeds the six default system roles the first time a tenant has none at all. Called once from
 * app bootstrap (before anyone is signed in) rather than from listRoles(), since listRoles() is
 * permission-gated and gating a seed step behind a permission nobody can hold yet would be a
 * chicken-and-egg deadlock on a brand new install.
 */
export function ensureDefaultRoles(tenantId: string): void {
  const existing = roleRepository.findAllRoleRows(tenantId);
  if (existing.length > 0) return;

  for (const defaultRole of DEFAULT_SYSTEM_ROLES) {
    roleRepository.insertRoleRow({
      id: `role_${randomUUID()}`,
      tenantId,
      roleName: defaultRole.roleName,
      description: defaultRole.description,
      permissions: defaultRole.permissions,
      isSystemRole: true,
      isSuperAdmin: defaultRole.isSuperAdmin,
      createdBy: null
    });
  }
}

/**
 * Retroactively adds the "Super Admin" role for tenants that already had their default roles
 * seeded before this role existed. Safe to call every boot — it's a no-op once the role exists.
 */
export function ensureSuperAdminRole(tenantId: string): void {
  const superAdminDefault = DEFAULT_SYSTEM_ROLES.find((role) => role.roleName === "Super Admin");
  if (!superAdminDefault) return;
  if (roleRepository.findRoleByNameRow(tenantId, superAdminDefault.roleName)) return;

  roleRepository.insertRoleRow({
    id: `role_${randomUUID()}`,
    tenantId,
    roleName: superAdminDefault.roleName,
    description: superAdminDefault.description,
    permissions: superAdminDefault.permissions,
    isSystemRole: true,
    isSuperAdmin: superAdminDefault.isSuperAdmin,
    createdBy: null
  });
}




















export function listRoles(): RoleListItem[] {
  requirePermission("roles", "view");
  const { tenantId } = getCurrentTenant();
  return roleRepository.findAllRoleListRows(tenantId).map(roleRepository.mapRoleListRow);
}

/** Just id+name, for populating a role picker/label elsewhere (currently Employees) — gated on
 * "employees:view" instead of "roles:view", since a role's bare name isn't what Roles & Permissions
 * actually guards (its permission breakdown is) and shouldn't block a screen someone IS allowed into
 * just because a Promise.all alongside it touched a module they can't see. */
export function listRolesForPicker(): RolePickerItem[] {
  requirePermission("employees", "view");
  const { tenantId } = getCurrentTenant();
  return roleRepository.findAllRoleRows(tenantId).map((row) => ({ id: row.id, roleName: row.role_name }));
}

export function getRole(id: string): Role {
  requirePermission("roles", "view");
  const row = roleRepository.findRoleRowById(id);
  if (!row) {
    throw new Error("Role not found");
  }
  return roleRepository.mapRoleRow(row);
}

export function createRole(input: unknown): Role {
  requirePermission("roles", "create");
  const parsed = roleInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();

  if (roleRepository.findRoleByNameRow(tenantId, parsed.roleName)) {
    throw new Error(`A role named "${parsed.roleName}" already exists`);
  }

  const row = roleRepository.insertRoleRow({
    id: `role_${randomUUID()}`,
    tenantId,
    roleName: parsed.roleName,
    description: parsed.description,
    permissions: sanitizePermissions(parsed.permissions),
    isSystemRole: false,
    createdBy: getCurrentEmployeeId()
  });
  return roleRepository.mapRoleRow(row);
}

export function updateRole(id: string, input: unknown): Role {
  requirePermission("roles", "edit");
  const parsed = roleInputSchema.parse(input);
  const existing = roleRepository.findRoleRowById(id);
  if (!existing) {
    throw new Error("Role not found");
  }

  const duplicate = roleRepository.findRoleByNameRow(existing.tenant_id, parsed.roleName, id);
  if (duplicate) {
    throw new Error(`A role named "${parsed.roleName}" already exists`);
  }

  const row = roleRepository.updateRoleRow(id, {
    roleName: parsed.roleName,
    description: parsed.description,
    permissions: sanitizePermissions(parsed.permissions),
    updatedBy: getCurrentEmployeeId()
  });
  return roleRepository.mapRoleRow(row);
}

export function deleteRole(id: string): { id: string } {
  requirePermission("roles", "delete");
  const row = roleRepository.findRoleRowById(id);
  if (!row) {
    throw new Error("Role not found");
  }
  if (row.is_system_role) {
    throw new Error("System roles can't be deleted");
  }

  const employeeCount = employeeRepository.countEmployeesByRoleRow(id);
  if (employeeCount > 0) {
    throw new Error(`Reassign ${employeeCount} employee(s) to a different role before deleting this role`);
  }

  // Cloud sync has no delete propagation — a role already synced would leave a stale copy on the
  // cloud/other devices forever if hard-deleted here. Roles have no active/inactive flag to fall
  // back on the way categories/employees do, so this is a hard stop, not a redirect — an unused
  // role with zero employees assigned (already required above) is harmless to just leave in place.
  if (row.sync_status !== "pending") {
    throw new Error("This role has already synced to the cloud and can't be deleted — it's safe to leave an unused role in place.");
  }

  roleRepository.deleteRoleRow(id);
  return { id };
}
