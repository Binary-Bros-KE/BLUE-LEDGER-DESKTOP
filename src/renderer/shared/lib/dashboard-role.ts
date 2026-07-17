import type { AuthSession } from "@shared/types/auth";

export type DashboardVariant = "superAdmin" | "manager" | "cashier" | "storekeeper";

/**
 * Roles are freeform, tenant-editable records (see role-service.ts's 4
 * seeded defaults: Super Admin, Manager, Cashier, Storekeeper), so role NAME
 * is checked first — a Cashier or Storekeeper always gets their own narrow
 * layout no matter how their branch is assigned. This matters because a
 * Storekeeper (or Cashier) can legitimately have no branch assigned at all —
 * e.g. a Storekeeper left unassigned specifically so they can see stock
 * across every storefront, not just one — and that must NOT bump them up
 * into the Super Admin layout, which assumes full sales/financial
 * permissions they don't have. Only once neither of those two specific names
 * match does branch assignment decide: no branch means unrestricted,
 * cross-business visibility (Super Admin, or any other role a tenant
 * renames/creates), otherwise it falls back to the Manager layout — the most
 * common single-branch role and a safe default either way.
 */
export function getDashboardVariant(session: AuthSession | null): DashboardVariant {
  if (!session) return "superAdmin";
  const roleName = session.role?.roleName.trim().toLowerCase();
  if (roleName === "cashier") return "cashier";
  if (roleName === "storekeeper") return "storekeeper";
  if (session.branch === null) return "superAdmin";
  return "manager";
}
