export type SaleReturnId = string;

export const SALE_RETURN_STATUS_OPTIONS = [
  { value: "pending_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" }
] as const;

export type SaleReturnStatus = (typeof SALE_RETURN_STATUS_OPTIONS)[number]["value"];

export type SaleReturnSyncStatus = "pending" | "synced" | "syncing" | "error";

export type SaleReturnItem = {
  id: string;
  saleReturnId: string;
  saleItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  createdAt: string;
};

/**
 * A request to return some or all of the items on a completed sale. The original sale is never
 * modified or voided — inventory is only restocked once a manager approves the request.
 */
export type SaleReturn = {
  id: SaleReturnId;
  tenantId: string;
  saleId: string;
  receiptNumber: string | null;
  locationId: string;
  locationName: string;
  status: SaleReturnStatus;
  reason: string;
  notes: string | null;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: SaleReturnSyncStatus;
  lastSyncedAt: string | null;
  items: SaleReturnItem[];
};
