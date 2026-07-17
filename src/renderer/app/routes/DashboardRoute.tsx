import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getDashboardVariant } from "@renderer/shared/lib/dashboard-role";
import { CashierDashboard } from "@renderer/app/routes/dashboard/CashierDashboard";
import { ManagerDashboard } from "@renderer/app/routes/dashboard/ManagerDashboard";
import { StorekeeperDashboard } from "@renderer/app/routes/dashboard/StorekeeperDashboard";
import { SuperAdminDashboard } from "@renderer/app/routes/dashboard/SuperAdminDashboard";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** A thin dispatcher — the actual dashboard content lives entirely in one of
 * the 4 role-specific components below, picked by branch assignment + role
 * name (see dashboard-role.ts). Every widget in every variant is composed
 * from report/service endpoints that already exist; nothing here talks to
 * the database directly. Each variant renders its own two-column
 * DashboardShell (including its own sync widget in the aside), so this
 * dispatcher only owns the greeting line above it. */
export function DashboardRoute(): React.JSX.Element {
  const { session } = usePermissions();
  const variant = getDashboardVariant(session);
  const firstName = session?.employee.firstName ?? "";

  return (
    <div className="mt-6 space-y-6">
      <h1 className="text-lg font-extrabold text-ink">
        {greeting()}
        {firstName ? `, ${firstName}` : ""}
      </h1>

      {variant === "superAdmin" ? (
        <SuperAdminDashboard />
      ) : variant === "manager" ? (
        <ManagerDashboard />
      ) : variant === "cashier" ? (
        <CashierDashboard />
      ) : (
        <StorekeeperDashboard />
      )}
    </div>
  );
}
