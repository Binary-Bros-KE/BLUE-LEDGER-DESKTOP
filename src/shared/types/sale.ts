export type SaleId = string;
export type SaleItemId = string;

export const SALE_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" }
] as const;

export type SaleStatus = (typeof SALE_STATUS_OPTIONS)[number]["value"];

export type SaleSyncStatus = "pending" | "synced" | "syncing" | "error";

export type SaleItem = {
  id: SaleItemId;
  saleId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  lineTotalCents: number;
  createdAt: string;
};

/** A completed or pending sale, with its line items and the display names of everything it references. */
export type Sale = {
  id: SaleId;
  tenantId: string;
  receiptNumber: string | null;
  locationId: string;
  locationName: string;
  employeeId: string;
  employeeName: string;
  customerId: string | null;
  customerName: string | null;
  saleStatus: SaleStatus;
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  grandTotalCents: number;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  paymentReference: string | null;
  amountReceivedCents: number | null;
  changeGivenCents: number | null;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: SaleSyncStatus;
  lastSyncedAt: string | null;
  items: SaleItem[];
};

/** Lightweight row for the "Resume Sale" picker — no line items, just enough to identify the held sale. */
export type PendingSaleListItem = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  itemCount: number;
  grandTotalCents: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
