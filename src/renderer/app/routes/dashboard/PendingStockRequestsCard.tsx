import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { useStockRequestAlertsStore } from "@renderer/shared/stores/stock-request-alerts-store";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import { DashboardActionCard } from "@renderer/app/routes/dashboard/DashboardActionCard";

/** Stock requests waiting on this user — only rendered for someone who can approve them, and fed by
 * the same store the sidebar badge uses (see useStockRequestAlerts), so it never needs its own fetch. */
export function PendingStockRequestsCard(): React.JSX.Element | null {
  const { can } = usePermissions();
  const pendingCount = useStockRequestAlertsStore((state) => state.pending.length);
  const setActiveNavKey = useUiStore((state) => state.setActiveNavKey);

  if (!can("stock_requests", "approve")) return null;

  return (
    <DashboardActionCard
      tone="warning"
      label="Pending Stock Requests"
      value={String(pendingCount)}
      sublabel={pendingCount === 0 ? "Nothing waiting" : "Waiting for your approval"}
      actionLabel="Review requests"
      onAction={() => setActiveNavKey("stock-requests")}
    />
  );
}
