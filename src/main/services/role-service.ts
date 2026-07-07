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
  type RoleListItem
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
}> = [
  {
    roleName: "Owner",
    description: "Full, unrestricted access to every area of the business account.",
    permissions: fullAccess(ALL_MODULE_KEYS)
  },
  {
    roleName: "Administrator",
    description: "Full operational access to day-to-day business management.",
    permissions: fullAccess(ALL_MODULE_KEYS)
  },
  {
    roleName: "Manager",
    description: "Runs daily operations across sales, inventory, and staff.",
    permissions: fullAccess([
      "dashboard",
      "products",
      "categories",
      "inventory",
      "stock_transfers",
      "sales",
      "purchases",
      "customers",
      "suppliers",
      "reports",
      "locations"
    ])
  },
  {
    roleName: "Cashier",
    description: "Handles checkout and customer-facing sales.",
    permissions: {
      dashboard: ["view"],
      products: ["view"],
      inventory: ["view"],
      sales: ["view", "create"],
      customers: ["view", "create"]
    }
  },
  {
    roleName: "Storekeeper",
    description: "Manages stock levels, receiving, and transfers between locations.",
    permissions: {
      dashboard: ["view"],
      products: ["view"],
      inventory: ["view", "create", "edit"],
      stock_transfers: ["view", "create", "approve"],
      purchases: ["view", "create"],
      suppliers: ["view", "create"]
    }
  },
  {
    roleName: "Accountant",
    description: "Reviews financial activity and generates reports.",
    permissions: {
      dashboard: ["view"],
      sales: ["view", "export"],
      purchases: ["view", "export"],
      reports: ["view", "export"],
      customers: ["view"],
      suppliers: ["view"],
      business_profile: ["view"]
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
      createdBy: null
    });
  }
}

export function listRoles(): RoleListItem[] {
  requirePermission("roles", "view");
  const { tenantId } = getCurrentTenant();
  return roleRepository.findAllRoleListRows(tenantId).map(roleRepository.mapRoleListRow);
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

  roleRepository.deleteRoleRow(id);
  return { id };
}
