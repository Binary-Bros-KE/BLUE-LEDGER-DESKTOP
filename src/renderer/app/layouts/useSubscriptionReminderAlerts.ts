import { useEffect } from "react";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { showInfoToast } from "@renderer/shared/lib/toast";
import { useSubscriptionAlertsStore } from "@renderer/shared/stores/subscription-alerts-store";
import { localTodayIso } from "@shared/lib/subscription-schedule";

// Reminders change at most once a day (or when one syncs in): a minute is plenty for the badge.
const POLL_INTERVAL_MS = 60 * 1000;
const LAST_TOAST_KEY = "blueLedger.subscriptionRemindersToastDate";

/** Keeps the sidebar badge for subscription reminders fresh, and once a day per employee — the first
 * time any are waiting — says how many. Manual reminders by client spec, so this only ever points at
 * the work; nothing is sent from here. */
export function useSubscriptionReminderAlerts(): void {
  const { can, session } = usePermissions();
  const canView = can("subscriptions", "view");
  const employeeId = session?.employee.id ?? null;
  const setPendingCount = useSubscriptionAlertsStore((state) => state.setPendingCount);

  useEffect(() => {
    if (!canView || !employeeId) {
      setPendingCount(0);
      return undefined;
    }
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const count = await window.blueLedger.subscription.pendingCount();
        if (cancelled) return;
        setPendingCount(count);
        if (count === 0) return;
        const stamp = `${employeeId}:${localTodayIso()}`;
        let lastShown: string | null = null;
        try {
          lastShown = localStorage.getItem(LAST_TOAST_KEY);
        } catch {
          // Storage blocked: just show it.
        }
        if (lastShown === stamp) return;
        showInfoToast(`${count} subscriber${count === 1 ? " needs" : "s need"} a renewal reminder — see Subscriptions.`);
        try {
          localStorage.setItem(LAST_TOAST_KEY, stamp);
        } catch {
          // Shown again next poll at worst.
        }
      } catch {
        // Mid-sync or permission just changed: try again next tick.
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [canView, employeeId, setPendingCount]);
}
