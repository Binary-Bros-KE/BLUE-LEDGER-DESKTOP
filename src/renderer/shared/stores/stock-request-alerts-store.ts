import { create } from "zustand";
import type { StockRequestListItem } from "@shared/types/stock-request";

type StockRequestAlertsStore = {
  /** Requests currently waiting for this approver — kept fresh by useStockRequestAlerts (mounted
   * once in AppShell). Empty for anyone without "stock_requests:approve". */
  pending: StockRequestListItem[];
  setPending: (pending: StockRequestListItem[]) => void;
};

export const useStockRequestAlertsStore = create<StockRequestAlertsStore>((set) => ({
  pending: [],
  setPending: (pending) => set({ pending })
}));
