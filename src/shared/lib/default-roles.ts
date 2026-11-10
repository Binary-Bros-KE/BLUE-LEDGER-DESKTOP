import { PERMISSION_MODULES, type PermissionAction, type PermissionModuleKey, type PermissionsMap } from "@shared/types/role";
import { withLaterModuleDefaults } from "@shared/lib/role-defaults";

/** The built-in roles every tenant starts with — seeded by role-service.ts's ensureDefaultRoles, and
 * what the Roles editor's "Restore defaults" sets a built-in role back to. Shared (not main-only) so
 * the renderer can restore without a round trip. SERVER keeps an identical copy for cloud-created
 * tenants and the phone's own Restore defaults (tenant-defaults-service.ts). */

const MODULE_ACTIONS = new Map<PermissionModuleKey, readonly PermissionAction[]>(PERMISSION_MODULES.map((module) => [module.key, module.actions]));
const ALL_MODULE_KEYS = PERMISSION_MODULES.map((module) => module.key);

function fullAccess(moduleKeys: PermissionModuleKey[]): PermissionsMap {
  const map: PermissionsMap = {};
  for (const key of moduleKeys) {
    map[key] = [...(MODULE_ACTIONS.get(key) ?? [])];
  }
  return map;
}

export const DEFAULT_SYSTEM_ROLES: Array<{
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
      local_purchases: ["view", "create", "edit", "delete"],
      // Goods taken on credit: local suppliers only, see purchase-service.ts requirePurchaseAccess.
      local_credit_purchases: ["view", "create", "edit"]
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

/** A built-in role's out-of-the-box permissions by name, for "Restore defaults" — null for a custom
 * role. Modules added after the defaults were written (Purchase Requisitions) come out the way a role
 * reads them anyway (withLaterModuleDefaults), so a restored role matches a brand-new tenant's. */
export function defaultPermissionsForRole(roleName: string): PermissionsMap | null {
  const role = DEFAULT_SYSTEM_ROLES.find((r) => r.roleName.toLowerCase() === roleName.trim().toLowerCase());
  return role ? withLaterModuleDefaults(structuredClone(role.permissions)) : null;
}
