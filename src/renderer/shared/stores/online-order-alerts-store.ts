import { create } from "zustand";

type OnlineOrderAlertsStore = {
  /** Web orders still waiting for the shop (status NEW) — kept fresh by useOnlineOrderAlerts
   * (mounted once in AppShell). 0 when the online store is off, offline, or no permission. */
  newCount: number;
  setNewCount: (n: number) => void;
};

export const useOnlineOrderAlertsStore = create<OnlineOrderAlertsStore>((set) => ({
  newCount: 0,
  setNewCount: (newCount) => set({ newCount })
}));
