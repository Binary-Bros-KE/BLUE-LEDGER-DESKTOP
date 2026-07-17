import { BusinessDashboard } from "@renderer/app/routes/dashboard/BusinessDashboard";

/** The shop manager's view: identical widgets to the Super Admin dashboard —
 * every call is already branch-scoped server-side (getCurrentBranchScope
 * reads their session's assigned branch), so this naturally gets back a
 * single storefront's numbers for free. The only difference is the
 * storefront-breakdown widget, which doesn't apply to a single branch. */
export function ManagerDashboard(): React.JSX.Element {
  return <BusinessDashboard isBusinessWide={false} />;
}
