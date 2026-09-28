import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { useOnlineOrderAlertsStore } from "@renderer/shared/stores/online-order-alerts-store";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import { DashboardActionCard } from "@renderer/app/routes/dashboard/DashboardActionCard";

/** Web orders waiting for the shop — fed by the same store as the sidebar badge (useOnlineOrderAlerts).
 * Only shown on e-commerce tenants to someone who can view the online store. */
export function OnlineOrdersCard(): React.JSX.Element | null {
  const { can } = usePermissions();
  const ecommerceEnabled = useAppStore((state) => state.context?.tenant.ecommerceEnabled ?? false);
  const newCount = useOnlineOrderAlertsStore((state) => state.newCount);
  const setActiveNavKey = useUiStore((state) => state.setActiveNavKey);

  if (!ecommerceEnabled || !can("online_store", "view")) return null;

  return (
    <DashboardActionCard
      tone="teal"
      label="New Online Orders"
      value={String(newCount)}
      sublabel={newCount === 0 ? "No web orders waiting" : "Placed on your website — confirm them"}
      actionLabel="Open online orders"
      onAction={() => setActiveNavKey("online-orders")}
    />
  );
}
