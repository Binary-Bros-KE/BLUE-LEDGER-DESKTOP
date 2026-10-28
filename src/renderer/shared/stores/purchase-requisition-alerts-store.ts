import { create } from "zustand";
import type { PurchaseRequisitionListItem } from "@shared/types/purchase-requisition";

type PurchaseRequisitionAlertsStore = {
  /** Requisitions currently waiting for this approver — kept fresh by usePurchaseRequisitionAlerts
   * (mounted once in AppShell). Empty for anyone without "purchase_requisitions:approve". */
  pending: PurchaseRequisitionListItem[];
  setPending: (pending: PurchaseRequisitionListItem[]) => void;
};

export const usePurchaseRequisitionAlertsStore = create<PurchaseRequisitionAlertsStore>((set) => ({
  pending: [],
  setPending: (pending) => set({ pending })
}));
