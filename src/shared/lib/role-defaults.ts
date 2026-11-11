import type { PermissionAction, PermissionsMap } from "@shared/types/role";

/**
 * Fills in permission modules that were added AFTER a role was saved, computed from what the role
 * already has — applied every time a role row is read (role-repository.ts's mapRoleRow), so the
 * session, the Roles editor and sync all see the same thing.
 *
 * Why not a migration that writes the grant into roles.permissions_json? Roles sync across devices:
 * a local-only write (no updated_at bump) never reaches a NEW device that later pulls the roles from
 * the cloud, and a synced write (updated_at bump) is pushed from every device as it upgrades — each
 * one conflicting with the last. A read-time default has neither problem and never overrides an
 * admin: the moment someone saves the role in Roles & Permissions, the key is stored explicitly (the
 * editor keeps an empty array when everything is unticked — see RolesRoute's toggleAction), and an
 * explicit value — even [] — is always left exactly as saved.
 */
export function withLaterModuleDefaults(permissions: PermissionsMap, roleName: string): PermissionsMap {
  return withInternationalSuppliersDefault(withRequisitionsDefault(permissions), roleName);
}

/** Whoever could already see suppliers keeps seeing all of them, except a Cashier: cashiers are local
 * only (client spec) even with Suppliers or Purchases ticked, unless an admin ticks this for them. */
function withInternationalSuppliersDefault(permissions: PermissionsMap, roleName: string): PermissionsMap {
  if (permissions.international_suppliers !== undefined) return permissions;
  const hadAccess = (["suppliers", "purchases", "reports"] as const).some((module) => permissions[module]?.includes("view"));
  return { ...permissions, international_suppliers: hadAccess && !/cashier/i.test(roleName) ? ["view"] : [] };
}

function withRequisitionsDefault(permissions: PermissionsMap): PermissionsMap {
  if (permissions.purchase_requisitions !== undefined) return permissions;

  // Client spec: anybody can raise a requisition; only higher roles approve. "Can already approve
  // purchases" is the closest existing signal for "higher role" (Manager by default — Super Admin
  // gets everything anyway via auth-service's allPermissions).
  const canApprovePurchases = permissions.purchases?.includes("approve") ?? false;
  const defaults: PermissionAction[] = canApprovePurchases ? ["view", "create", "approve"] : ["view", "create"];
  return { ...permissions, purchase_requisitions: defaults };
}
