export type SaleVoidId = string;

export const SALE_VOID_STATUS_OPTIONS = [
  { value: "pending_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" }
] as const;

export type SaleVoidStatus = (typeof SALE_VOID_STATUS_OPTIONS)[number]["value"];

export type SaleVoidSyncStatus = "pending" | "synced" | "syncing" | "error";

/** A request to invalidate an entire completed sale — must be approved by a manager before it takes effect. */
export type SaleVoid = {
  id: SaleVoidId;
  tenantId: string;
  saleId: string;
  receiptNumber: string | null;
  saleGrandTotalCents: number;
  locationId: string;
  locationName: string;
  status: SaleVoidStatus;
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
  syncStatus: SaleVoidSyncStatus;
  lastSyncedAt: string | null;
};
