export type RoleId = string;

export const PERMISSION_ACTIONS = ["view", "create", "edit", "delete", "approve", "export"] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_ACTION_LABELS: Record<PermissionAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  export: "Export"
};

/** Every manageable area of the app, and which actions are meaningful for it. */
export const PERMISSION_MODULES = [
  { key: "dashboard", label: "Dashboard", actions: ["view"] },
  { key: "products", label: "Products", actions: ["view", "create", "edit", "delete", "export"] },
  { key: "categories", label: "Categories", actions: ["view", "create", "edit", "delete"] },
  { key: "inventory", label: "Inventory", actions: ["view", "create", "edit", "export"] },
  {
    key: "main_store",
    label: "Main Store",
    actions: ["view", "create", "edit", "export"]
  },
  { key: "stock_transfers", label: "Stock Transfers", actions: ["view", "create", "approve", "export"] },
  {
    key: "sales",
    label: "Sales",
    actions: ["view", "create", "edit", "delete", "approve", "export"]
  },
  {
    key: "quotations",
    label: "Quotations",
    actions: ["view", "create", "edit", "delete", "export"]
  },
  {
    key: "purchases",
    label: "Purchases",
    actions: ["view", "create", "edit", "delete", "approve", "export"]
  },
  { key: "customers", label: "Customers", actions: ["view", "create", "edit", "delete", "export"] },
  { key: "suppliers", label: "Suppliers", actions: ["view", "create", "edit", "delete", "export"] },
  { key: "riders", label: "Riders", actions: ["view", "create", "edit", "delete", "export"] },
  { key: "stock_requests", label: "Stock Requests", actions: ["view", "create", "approve", "export"] },
  { key: "expenses", label: "Expenses", actions: ["view", "create", "edit", "delete", "export"] },
  {
    key: "expense_categories",
    label: "Expense Categories",
    actions: ["view", "create", "edit", "delete"]
  },
  { key: "employees", label: "Employees", actions: ["view", "create", "edit", "delete", "export"] },
  {
    key: "salaries",
    label: "Salaries",
    actions: ["view", "create", "edit", "delete", "export"]
  },
  { key: "roles", label: "Roles", actions: ["view", "create", "edit", "delete"] },
  { key: "reports", label: "Reports", actions: ["view", "export"] },
  { key: "settings", label: "Settings", actions: ["view", "edit"] },
  { key: "business_profile", label: "Business Profile", actions: ["view", "edit"] },
  { key: "locations", label: "Locations", actions: ["view", "create", "edit", "delete"] },
  {
    key: "payment_methods",
    label: "Payment Methods",
    actions: ["view", "create", "edit", "delete"]
  },
  { key: "approvals", label: "Approvals", actions: ["view", "approve"] },
  { key: "cloud_sync", label: "Cloud Sync", actions: ["view", "edit"] },
  { key: "administration", label: "Administration", actions: ["view", "edit"] }
] as const satisfies ReadonlyArray<{ key: string; label: string; actions: readonly PermissionAction[] }>;

export type PermissionModuleKey = (typeof PERMISSION_MODULES)[number]["key"];

/** Module -> granted actions. A module with no entry (or an empty array) means no access. */
export type PermissionsMap = Partial<Record<PermissionModuleKey, PermissionAction[]>>;

export type RoleSyncStatus = "pending" | "synced" | "syncing" | "error";

export type RoleInputFields = {
  roleName: string;
  description: string | null;
  permissions: PermissionsMap;
};

export type Role = RoleInputFields & {
  id: RoleId;
  tenantId: string;
  isSystemRole: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  syncStatus: RoleSyncStatus;
  lastSyncedAt: string | null;
};

/** Role row enriched with the employee count for the role list, computed via a join. */
export type RoleListItem = Role & {
  employeeCount: number;
};

/** Just enough to populate a role picker/label elsewhere (e.g. Employees) — deliberately not the
 * full Role shape, since a role's permission breakdown is what "roles:view" actually guards; a role's
 * bare name isn't sensitive and is needed by anyone managing employees, whether or not they're also
 * allowed into Roles & Permissions. */
export type RolePickerItem = {
  id: RoleId;
  roleName: string;
};
