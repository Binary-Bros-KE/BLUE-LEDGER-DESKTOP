import { create } from "zustand";

type SubscriptionAlertsStore = {
  /** Subscription reminders waiting to be sent: the sidebar badge. Kept fresh by
   * useSubscriptionReminderAlerts (mounted once in AppShell) and by the Subscriptions screen itself.
   * Zero for anyone without "subscriptions:view". */
  pendingCount: number;
  setPendingCount: (pendingCount: number) => void;
};

export const useSubscriptionAlertsStore = create<SubscriptionAlertsStore>((set) => ({
  pendingCount: 0,
  setPendingCount: (pendingCount) => set({ pendingCount })
}));
