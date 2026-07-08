export type QuotationId = string;
export type QuotationItemId = string;

export const QUOTATION_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "converted", label: "Converted" }
] as const;

export type QuotationStatus = (typeof QUOTATION_STATUS_OPTIONS)[number]["value"];

export type QuotationSyncStatus = "pending" | "synced" | "syncing" | "error";

export type QuotationItem = {
  id: QuotationItemId;
  quotationId: string;
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

/** A price offer to a customer — never affects inventory, payments, or financial reports on its own. */
export type Quotation = {
  id: QuotationId;
  tenantId: string;
  quotationNumber: string;
  customerId: string;
  customerName: string;
  locationId: string;
  locationName: string;
  employeeId: string;
  employeeName: string;
  /** Always the live, date-aware status (see computeQuotationStatus) — never a stale stored value. */
  status: QuotationStatus;
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  grandTotalCents: number;
  validUntil: string;
  notes: string | null;
  convertedSaleId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: QuotationSyncStatus;
  lastSyncedAt: string | null;
  items: QuotationItem[];
};

/** Lightweight row for the Quotations list — no line items, just enough to identify and act on it. */
export type QuotationListItem = {
  id: QuotationId;
  quotationNumber: string;
  customerName: string;
  locationName: string;
  employeeName: string;
  status: QuotationStatus;
  grandTotalCents: number;
  validUntil: string;
  createdAt: string;
};

/** Aggregate counts for the Quotations dashboard's summary cards. */
export type QuotationSummary = {
  totalQuotations: number;
  draftCount: number;
  sentCount: number;
  acceptedCount: number;
  expiredCount: number;
  rejectedCount: number;
  convertedCount: number;
};

/** One line's live-stock check result, used to warn before completing a conversion. */
export type QuotationStockCheckItem = {
  productId: string;
  productName: string;
  requestedQuantity: number;
  availableQuantity: number;
  sufficient: boolean;
};
