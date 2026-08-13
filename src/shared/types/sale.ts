import type { DeliveryInput } from "@shared/schemas/charges";
import type { ProductTaxType } from "@shared/types/product";

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
  /** What tax category actually applied at sale time — a snapshot, since a product's own category
   * can change later but a historical sale must keep reporting whatever was true when it happened. */
  taxType: ProductTaxType;
  taxAmountCents: number;
  lineTotalCents: number;
  /** This line's product was bought from another shop on the spot rather than pulled from this
   * shop's own stock (a customer wanted something this shop doesn't carry) — see checkout-pricing's
   * own doc comment on why this skips the usual stock movement regardless of the product's own
   * track_stock setting. */
  isLocallySourced: boolean;
  /** What THIS shop paid the local supplier for it — null unless isLocallySourced. Never contributes
   * to the sale's own totals (the customer is charged unitPriceCents like any other line); purely a
   * cost figure for Reports' locally-sourced margin breakdown. */
  localCostCents: number | null;
  localSupplierId: string | null;
  localSupplierName: string | null;
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
  /** The customer's own KRA PIN, if they have one on file — shown as "Your VAT No." on the invoice
   * PDF only (see printer-service.ts's buildInvoiceHtml); receipts/quotations don't show it. */
  customerKraPin: string | null;
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
  /** Whether the "Tax Breakdown" section prints/downloads/shares on this specific document — set at
   * creation (Checkout/Invoice/Quotation form), editable afterward from the document's own detail
   * view. Defaults to true. See printer-service.ts's buildTaxBreakdownHtml callers. */
  includeTaxBreakdown: boolean;
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
  /** A REAL, numbered delivery note — only ever set once a sale has actually completed. */
  delivery: SaleDelivery | null;
  /** Delivery info entered while this sale was only HELD, before any number was allocated — see
   * suspendSale in sale-service.ts. Only ever set while saleStatus is "pending"; a completed sale
   * has this null and its real delivery (if any) in `delivery` instead. Exists purely so the
   * Checkout screen can restore the rider/recipient/address fields when resuming a held cart. */
  deliveryDraft: DeliveryInput | null;
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
  /** null when there's no delivery attached at all; otherwise whether it's been marked delivered. */
  deliveryIsDelivered: boolean | null;
  locationId: string;
};
