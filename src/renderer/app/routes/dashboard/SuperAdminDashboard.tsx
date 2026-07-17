import { BusinessDashboard } from "@renderer/app/routes/dashboard/BusinessDashboard";

/** The Super Admin's view: everything, from every storefront, combined. */
export function SuperAdminDashboard(): React.JSX.Element {
  return <BusinessDashboard isBusinessWide />;
}
