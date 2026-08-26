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
      suppliers: ["view"],
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
      stock_requests: ["view", "approve"]
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

/**
 * Retroactively flags the existing "Super Admin" role row for tenants that seeded it before
 * Role.isSuperAdmin existed — new installs get it for free via DEFAULT_SYSTEM_ROLES/
 * ensureSuperAdminRole above. Without this, every already-installed tenant's Super Admin role is a
 * persisted DB row a new column alone can never reach, and the Working Hours lockout bypass this
 * flag drives would silently lock out the very person meant to always have access. Safe every boot:
 * a no-op once already set.
 */
export function ensureSuperAdminFlag(tenantId: string): void {
  const row = roleRepository.findRoleByNameRow(tenantId, "Super Admin");
  if (!row || !row.is_system_role || row.is_super_admin) return;
  roleRepository.setRoleSuperAdminFlagRow(row.id, true);
}

/**
 * "Owner", "Administrator", and "Accountant" were dropped from the default role set to keep the
 * system down to 4 sharp, distinct roles (Super Admin, Manager, Cashier, Storekeeper) — Owner and
 * Administrator were exact permission duplicates of Super Admin anyway. For tenants that already
 * seeded the old 7-role set, this reassigns any employee still on one of the 3 removed roles to
 * Super Admin (their permissions were identical or a subset), then deletes the now-empty role rows.
 * Only ever touches rows still named exactly "Owner"/"Administrator"/"Accountant" AND still flagged
 * `is_system_role` — a tenant that renamed one of them into a genuinely custom role is left alone.
 * Safe every boot: a no-op once those 3 role rows are gone.
 */
export function consolidateToFourCoreRoles(tenantId: string): void {
  const REMOVED_ROLE_NAMES = ["Owner", "Administrator", "Accountant"];
  const superAdmin = roleRepository.findRoleByNameRow(tenantId, "Super Admin");
  if (!superAdmin) return;

  for (const roleName of REMOVED_ROLE_NAMES) {
    const row = roleRepository.findRoleByNameRow(tenantId, roleName);
    if (!row || !row.is_system_role) continue;

    employeeRepository.reassignEmployeeRoleRow(tenantId, row.id, superAdmin.id);
    roleRepository.deleteRoleRow(row.id);
  }
}

/**
 * Retroactively grants "quotations" permissions to system roles seeded before this module existed —
 * new installs get it for free via DEFAULT_SYSTEM_ROLES, but a tenant's existing role rows are frozen
 * JSON snapshots that a change to that constant never reaches on its own. Safe every boot: a no-op
 * once a role's stored permissions already include quotations.
 */
export function ensureQuotationsPermission(tenantId: string): void {
  const defaultsByName = new Map(DEFAULT_SYSTEM_ROLES.map((role) => [role.roleName, role.permissions.quotations]));

  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role) continue;
    const grant = defaultsByName.get(row.role_name);
    if (!grant || grant.length === 0) continue;

    const role = roleRepository.mapRoleRow(row);
    if (role.permissions.quotations) continue;

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: { ...role.permissions, quotations: grant },
      updatedBy: null
    });
  }
}

/**
 * Retroactively grants Storekeeper "create" and "edit" on products for tenants seeded before product
 * management moved into the Main Store (creating products, and now activating/deactivating them) — new
 * installs get it for free via DEFAULT_SYSTEM_ROLES. Safe every boot: a no-op once the role's stored
 * permissions already include both.
 */
export function ensureStorekeeperProductPermissions(tenantId: string): void {
  const storekeeperDefault = DEFAULT_SYSTEM_ROLES.find((role) => role.roleName === "Storekeeper");
  const productsGrant = storekeeperDefault?.permissions.products;
  if (!productsGrant) return;

  const row = roleRepository.findRoleByNameRow(tenantId, "Storekeeper");
  if (!row || !row.is_system_role) return;

  const role = roleRepository.mapRoleRow(row);
  const hasAll = productsGrant.every((action) => role.permissions.products?.includes(action));
  if (hasAll) return;

  roleRepository.updateRoleRow(row.id, {
    roleName: role.roleName,
    description: role.description,
    permissions: { ...role.permissions, products: productsGrant },
    updatedBy: null
  });
}

/**
 * Retroactively grants "expenses"/"expense_categories" permissions to system roles seeded before
 * this module existed — new installs get it for free via DEFAULT_SYSTEM_ROLES, but a tenant's
 * existing role rows are frozen JSON snapshots that a change to that constant never reaches on its
 * own. Safe every boot: a no-op once a role's stored permissions already include both.
 */
export function ensureExpensesPermissions(tenantId: string): void {
  const defaultsByName = new Map(
    DEFAULT_SYSTEM_ROLES.map((role) => [
      role.roleName,
      { expenses: role.permissions.expenses, expense_categories: role.permissions.expense_categories }
    ])
  );

  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role) continue;
    const grants = defaultsByName.get(row.role_name);
    if (!grants) continue;

    const role = roleRepository.mapRoleRow(row);
    const nextPermissions = { ...role.permissions };
    let changed = false;

    if (grants.expenses && grants.expenses.length > 0 && !role.permissions.expenses) {
      nextPermissions.expenses = grants.expenses;
      changed = true;
    }
    if (grants.expense_categories && grants.expense_categories.length > 0 && !role.permissions.expense_categories) {
      nextPermissions.expense_categories = grants.expense_categories;
      changed = true;
    }
    if (!changed) continue;

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: nextPermissions,
      updatedBy: null
    });
  }
}

/**
 * Retroactively grants "salaries" permissions to system roles seeded before this module existed —
 * new installs get it for free via DEFAULT_SYSTEM_ROLES, but a tenant's existing role rows are
 * frozen JSON snapshots that a change to that constant never reaches on its own. Every default role
 * gets at least "view" (self-only payslip access) so the tab is never hidden from anyone. Safe every
 * boot: a no-op once a role's stored permissions already include salaries.
 */
export function ensureSalariesPermission(tenantId: string): void {
  const defaultsByName = new Map(DEFAULT_SYSTEM_ROLES.map((role) => [role.roleName, role.permissions.salaries]));

  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role) continue;
    const grant = defaultsByName.get(row.role_name);
    if (!grant || grant.length === 0) continue;

    const role = roleRepository.mapRoleRow(row);
    if (role.permissions.salaries) continue;

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: { ...role.permissions, salaries: grant },
      updatedBy: null
    });
  }
}

/**
 * Reports tabs must stay Super Admin/Manager only — Cashier and Storekeeper briefly had "reports"
 * granted (so their dashboard widgets could read sales/inventory report data), but that also put
 * the full "Insights" nav section (all 5 Report tabs) in front of them, which was never the intent.
 * The dashboard widgets themselves were switched to `requirePermissionAnyOf` so they still work off
 * "sales"/"inventory"/"purchases" permission instead — this retroactively strips "reports" back out
 * of any existing Cashier/Storekeeper role row for tenants that picked it up in the meantime. Safe
 * every boot: a no-op once neither role has it.
 */
export function restrictReportsToAdminRoles(tenantId: string): void {
  const RESTRICTED_ROLE_NAMES = new Set(["Cashier", "Storekeeper"]);

  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role || !RESTRICTED_ROLE_NAMES.has(row.role_name)) continue;

    const role = roleRepository.mapRoleRow(row);
    if (!role.permissions.reports) continue;

    const { reports: _removed, ...rest } = role.permissions;
    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: rest,
      updatedBy: null
    });
  }
}

/**
 * Cashier's permission set drifted from DEFAULT_SYSTEM_ROLES via manual edits in the Roles screen
 * (losing "sales:edit"/"sales:delete" along the way, which silently broke invoice payment
 * processing and held-sale deletion — both squarely a cashier's job) and picked up "inventory" and
 * "locations" (which put the Main Store/Stock Ledger/Storefronts tabs in front of them, never the
 * intent — those are Super Admin/Manager/Storekeeper only). This corrects exactly those three
 * things and nothing else, leaving any other manual customization (e.g. "categories",
 * "stock_transfers") untouched. Safe every boot: a no-op once already correct.
 */
export function fixCashierPermissionDrift(tenantId: string): void {
  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role || row.role_name !== "Cashier") continue;

    const role = roleRepository.mapRoleRow(row);
    const currentSales = role.permissions.sales ?? [];
    const needsSalesFix = !currentSales.includes("edit") || !currentSales.includes("delete");
    const needsInventoryRemoval = Boolean(role.permissions.inventory);
    const needsLocationsRemoval = Boolean(role.permissions.locations);
    if (!needsSalesFix && !needsInventoryRemoval && !needsLocationsRemoval) continue;

    const { inventory: _inv, locations: _loc, ...rest } = role.permissions;
    const nextSales = Array.from(new Set([...currentSales, "edit", "delete"])) as PermissionAction[];

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: { ...rest, sales: nextSales },
      updatedBy: null
    });
  }
}

/**
 * Storekeeper's default permissions never included "categories" — an oversight from the start, not
 * a drift — which throws "doesn't have permission to view categories" the moment ProductsRoute's
 * loadAll() Promise.all touches category.list(), blocking the Products screen entirely for a role
 * that explicitly needs to manage products. Grants "categories: ['view']" retroactively. Safe every
 * boot: a no-op once already present.
 */
export function ensureStorekeeperCategoriesPermission(tenantId: string): void {
  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role || row.role_name !== "Storekeeper") continue;

    const role = roleRepository.mapRoleRow(row);
    if (role.permissions.categories) continue;

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: { ...role.permissions, categories: ["view"] },
      updatedBy: null
    });
  }
}

/**
 * Retroactively grants "riders" permissions (Manager: full CRUD, Cashier: view+create) to system
 * roles seeded before delivery riders existed — new installs get it for free via
 * DEFAULT_SYSTEM_ROLES. Safe every boot: a no-op once a role's stored permissions already include
 * riders.
 */
export function ensureRidersPermission(tenantId: string): void {
  const defaultsByName = new Map(DEFAULT_SYSTEM_ROLES.map((role) => [role.roleName, role.permissions.riders]));

  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role) continue;
    const grant = defaultsByName.get(row.role_name);
    if (!grant || grant.length === 0) continue;

    const role = roleRepository.mapRoleRow(row);
    if (role.permissions.riders) continue;

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: { ...role.permissions, riders: grant },
      updatedBy: null
    });
  }
}

/**
 * Retroactively grants "local_purchases" permissions (Manager: full CRUD+export, Cashier: CRUD) to
 * system roles seeded before this module existed — new installs get it for free via
 * DEFAULT_SYSTEM_ROLES. Deliberately does NOT touch "expenses"/"expense_categories" — the whole
 * point is a cashier gets this without ever getting those. Safe every boot: a no-op once a role's
 * stored permissions already include local_purchases.
 */
export function ensureLocalPurchasesPermission(tenantId: string): void {
  const defaultsByName = new Map(
    DEFAULT_SYSTEM_ROLES.map((role) => [role.roleName, role.permissions.local_purchases])
  );

  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role) continue;
    const grant = defaultsByName.get(row.role_name);
    if (!grant || grant.length === 0) continue;

    const role = roleRepository.mapRoleRow(row);
    if (role.permissions.local_purchases) continue;

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: { ...role.permissions, local_purchases: grant },
      updatedBy: null
    });
  }
}

/**
 * Retroactively grants "stock_requests" permissions (Cashier/Manager: view+create, Storekeeper:
 * view+approve) to system roles seeded before the Stock Requests feature existed — new installs get
 * it for free via DEFAULT_SYSTEM_ROLES. Safe every boot: a no-op once a role's stored permissions
 * already include stock_requests.
 */
export function ensureStockRequestsPermission(tenantId: string): void {
  const defaultsByName = new Map(
    DEFAULT_SYSTEM_ROLES.map((role) => [role.roleName, role.permissions.stock_requests])
  );

  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role) continue;
    const grant = defaultsByName.get(row.role_name);
    if (!grant || grant.length === 0) continue;

    const role = roleRepository.mapRoleRow(row);
    if (role.permissions.stock_requests) continue;

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: { ...role.permissions, stock_requests: grant },
      updatedBy: null
    });
  }
}

/**
 * Retroactively grants "main_store" (Storekeeper/Super Admin: full CRUD) to system roles seeded
 * before the Main Store screen was split out from the general "inventory" permission — new installs
 * get it for free via DEFAULT_SYSTEM_ROLES. Deliberately does NOT touch Manager, who keeps "inventory"
 * (Stock Ledger, per-product stock) but never gets "main_store" — that's the whole point of the split.
 * Safe every boot: a no-op once a role's stored permissions already include main_store.
 */
export function ensureMainStorePermission(tenantId: string): void {
  const defaultsByName = new Map(DEFAULT_SYSTEM_ROLES.map((role) => [role.roleName, role.permissions.main_store]));

  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role) continue;
    const grant = defaultsByName.get(row.role_name);
    if (!grant || grant.length === 0) continue;

    const role = roleRepository.mapRoleRow(row);
    if (role.permissions.main_store) continue;

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: { ...role.permissions, main_store: grant },
      updatedBy: null
    });
  }
}

/**
 * Retroactively grants "data_import" (Super Admin only, per DEFAULT_SYSTEM_ROLES) to system roles
 * seeded before the bulk Import tab existed — new installs get it for free via DEFAULT_SYSTEM_ROLES.
 * Without this, every already-installed tenant's Super Admin role is a persisted DB row a new
 * PERMISSION_MODULES entry alone can never reach. Safe every boot: a no-op once a role's stored
 * permissions already include data_import.
 */
export function ensureDataImportPermission(tenantId: string): void {
  const defaultsByName = new Map(DEFAULT_SYSTEM_ROLES.map((role) => [role.roleName, role.permissions.data_import]));

  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role) continue;
    const grant = defaultsByName.get(row.role_name);
    if (!grant || grant.length === 0) continue;

    const role = roleRepository.mapRoleRow(row);
    if (role.permissions.data_import) continue;

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: { ...role.permissions, data_import: grant },
      updatedBy: null
    });
  }
}

/**
 * Retroactively grants "owner_app" (Super Admin only, per DEFAULT_SYSTEM_ROLES) to system roles
 * seeded before the read-only Owner mobile app existed — new installs get it for free via
 * DEFAULT_SYSTEM_ROLES. Without this, every already-installed tenant's Super Admin role is a
 * persisted DB row a new PERMISSION_MODULES entry alone can never reach. Safe every boot: a no-op
 * once a role's stored permissions already include owner_app.
 */
export function ensureOwnerAppPermission(tenantId: string): void {
  const defaultsByName = new Map(DEFAULT_SYSTEM_ROLES.map((role) => [role.roleName, role.permissions.owner_app]));

  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role) continue;
    const grant = defaultsByName.get(row.role_name);
    if (!grant || grant.length === 0) continue;

    const role = roleRepository.mapRoleRow(row);
    if (role.permissions.owner_app) continue;

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: { ...role.permissions, owner_app: grant },
      updatedBy: null
    });
  }
}

/**
 * Retroactively grants full "employees" access to the Manager role, seeded before a tenant decided
 * Managers should manage staff too — new installs get it for free via DEFAULT_SYSTEM_ROLES. Safe
 * every boot: a no-op once Manager's stored permissions already include employees.
 */
export function ensureManagerEmployeesPermission(tenantId: string): void {
  const grant = DEFAULT_SYSTEM_ROLES.find((role) => role.roleName === "Manager")?.permissions.employees;
  if (!grant || grant.length === 0) return;

  for (const row of roleRepository.findAllRoleRows(tenantId)) {
    if (!row.is_system_role || row.role_name !== "Manager") continue;

    const role = roleRepository.mapRoleRow(row);
    if (role.permissions.employees) continue;

    roleRepository.updateRoleRow(row.id, {
      roleName: role.roleName,
      description: role.description,
      permissions: { ...role.permissions, employees: grant },
      updatedBy: null
    });
  }
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
