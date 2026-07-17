export type SaleId = string;
export type SaleItemId = string;

export const SALE_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" }
] as const;

export type SaleStatus = (typeof SALE_STATUS_OPTIONS)[number]["value"];

export type SaleSyncStatus = "pending" | "synced" | "syncing" | "error";

export const TRANSACTION_TYPE_OPTIONS = [
  { value: "retail_sale", label: "Retail Sale" },
  { value: "wholesale_sale", label: "Wholesale Sale" },
  { value: "invoice", label: "Invoice" },
  { value: "return", label: "Return" },
  { value: "exchange", label: "Exchange" }
] as const;

export type TransactionType = (typeof TRANSACTION_TYPE_OPTIONS)[number]["value"];

export const PAYMENT_STATUS_OPTIONS = [
  { value: "unpaid", label: "Unpaid" },
  { value: "partially_paid", label: "Partially Paid" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "cancelled", label: "Cancelled" }
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUS_OPTIONS)[number]["value"];

/** One entry in a sale's payment history — invoices can accumulate several of these over time. */
export type SalePayment = {
  id: string;
  paymentMethodId: string;
  paymentMethodName: string;
  amountCents: number;
  reference: string | null;
  receivedBy: string;
  receivedByName: string;
  receivedAt: string;
  notes: string | null;
};

/** A named custom fee (e.g. "Labour", "Installation") — unlimited per document, no separate document
 * of its own, just an extra line item on the receipt/invoice/quotation. */
export type SaleServiceCharge = {
  id: string;
  name: string;
  feeCents: number;
  /** Internal-only, never printed — used to compute the actual margin the charge earned. */
  costCents: number;
};

/** The one optional delivery a sale/invoice/quotation can carry — mirrors a standalone delivery note
 * document (see DeliveryNotePreview) that excludes all money figures. */
export type SaleDelivery = {
  id: string;
  deliveryNoteNumber: string;
  riderId: string | null;
  riderName: string | null;
  riderPhone: string | null;
  riderCompany: string | null;
  riderVehicleDescription: string | null;
  recipientName: string;
  country: string | null;
  town: string | null;
  physicalAddress: string;
  notes: string | null;
  feeCents: number;
  /** Internal-only, never printed — used to tell whether delivery is actually profitable. */
  costCents: number;
  isDelivered: boolean;
  deliveredAt: string | null;
};

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
  transactionType: TransactionType;
  paymentStatus: PaymentStatus;
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
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  amountPaidCents: number;
  balanceDueCents: number;
  invoiceNotes: string | null;
  payments: SalePayment[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: SaleSyncStatus;
  lastSyncedAt: string | null;
  items: SaleItem[];
  serviceCharges: SaleServiceCharge[];
  delivery: SaleDelivery | null;
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

/** Lightweight row for the Receipts list — no line items, just enough to identify and act on the sale. */
export type SaleListItem = {
  id: string;
  receiptNumber: string | null;
  customerName: string | null;
  employeeName: string;
  locationName: string;
  paymentMethodName: string | null;
  itemCount: number;
  grandTotalCents: number;
  saleStatus: SaleStatus;
  completedAt: string | null;
  createdAt: string;
  hasDeliveryNote: boolean;
};
