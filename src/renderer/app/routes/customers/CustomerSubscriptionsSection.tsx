import { useEffect, useState } from "react";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import type { Subscription } from "@shared/types/subscription";
import { StagePill, formatSubscriptionDate } from "../subscriptions/subscription-ui";

/** The customer's subscriptions (current periods first) on their Customer page. Hidden entirely for a
 * role without Subscriptions, and when they've never had one. */
export function CustomerSubscriptionsSection({ customerId }: { customerId: string }): React.JSX.Element | null {
  const { can } = usePermissions();
  const canView = can("subscriptions", "view");
  const [periods, setPeriods] = useState<Subscription[]>([]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    void window.blueLedger.subscription
      .customerHistory(customerId)
      .then((result) => {
        if (!cancelled) setPeriods(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [customerId, canView]);

  if (!canView || periods.length === 0) return null;
  const current = periods.filter((period) => period.status !== "renewed");

  return (
    <div>
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Subscriptions</p>
      <div className="mt-2 space-y-1.5">
        {current.map((period) => (
          <div key={period.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs">
            <span className="font-bold text-ink">
              {period.serviceName}
              {period.accountNumber ? ` · ${period.accountNumber}` : ""}
            </span>
            <span className="font-semibold text-muted">Ends {formatSubscriptionDate(period.endDate)}</span>
            <StagePill subscription={period} />
          </div>
        ))}
        {periods.length > current.length && (
          <p className="text-[11px] font-semibold text-muted">
            {periods.length - current.length} earlier period{periods.length - current.length === 1 ? "" : "s"} renewed.
          </p>
        )}
      </div>
    </div>
  );
}
