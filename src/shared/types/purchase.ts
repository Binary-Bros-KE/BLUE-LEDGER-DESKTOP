export type PurchaseId = string;
export type PurchaseItemId = string;

export const PURCHASE_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "ordered", label: "Ordered" },
  { value: "partially_received", label: "Partially Received" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" }
] as const;

export type PurchaseStatus = (typeof PURCHASE_STATUS_OPTIONS)[number]["value"];

export const PURCHASE_TAX_TYPE_OPTIONS = [
  { value: "vat", label: "VAT" },
  { value: "no_vat", label: "No VAT" },
  { value: "zero_rated", label: "Zero Rated" }
] as const;

export type PurchaseTaxType = (typeof PURCHASE_TAX_TYPE_OPTIONS)[number]["value"];

export const PURCHASE_PAYMENT_STATUS_OPTIONS = [
  { value: "unpaid", label: "Unpaid" },
  { value: "partially_paid", label: "Partially Paid" },
  { value: "paid", label: "Paid" }
] as const;

export type PurchasePaymentStatus = (typeof PURCHASE_PAYMENT_STATUS_OPTIONS)[number]["value"];

export type PurchaseSyncStatus = "pending" | "synced" | "syncing" | "error";

/** One entry in a purchase's payment history — a PO can be paid off across several supplier payments. */
export type PurchasePayment = {
  id: string;
  paymentMethodId: string;
  paymentMethodName: string;
  amountCents: number;
  reference: string | null;
  paidBy: string;
  paidByName: string;
  paidAt: string;
  notes: string | null;
};

export type PurchaseItem = {
  id: PurchaseItemId;
  purchaseId: string;
  productId: string;
  productName: string;
  sku: string;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  unitCostCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  lineTotalCents: number;
  createdAt: string;
  updatedAt: string;
};

/** A purchase order recording inventory entering the business. Stock only enters inventory once
 * goods are explicitly received — creating or ordering a purchase never touches stock by itself. */
export type Purchase = {
  id: PurchaseId;
  tenantId: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  supplierInvoiceNumber: string | null;
  locationId: string;
  locationName: string;
  status: PurchaseStatus;
  taxType: PurchaseTaxType;
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  grandTotalCents: number;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  paymentReference: string | null;
  paymentStatus: PurchasePaymentStatus;
  amountPaidCents: number;
  payments: PurchasePayment[];
  notes: string | null;
  attachmentPath: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: PurchaseSyncStatus;
  lastSyncedAt: string | null;
  items: PurchaseItem[];
};

/** Lightweight row for the Purchases table — no line items, just enough to list and filter. */
export type PurchaseListItem = {
  id: PurchaseId;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  supplierInvoiceNumber: string | null;
  locationId: string;
  locationName: string;
  status: PurchaseStatus;
  taxType: PurchaseTaxType;
  grandTotalCents: number;
  paymentStatus: PurchasePaymentStatus;
  amountPaidCents: number;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
};

export type PurchaseSummary = {
  totalPurchases: number;
  draftCount: number;
  orderedCount: number;
  partiallyReceivedCount: number;
  receivedCount: number;
  outstandingSupplierPaymentsCents: number;
};
