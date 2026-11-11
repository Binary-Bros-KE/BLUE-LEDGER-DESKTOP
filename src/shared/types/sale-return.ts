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
  /** Set when the return is against an invoice: it's then a credit note on that invoice. */
  invoiceNumber: string | null;
  /** CN-... once a credit note has been issued for this return. */
  creditNoteNumber: string | null;
  /** Money paid back. Null = the whole returned value (every receipt return). */
  refundCents: number | null;
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

/** A credit note as a document: what was credited, against which receipt or invoice, and how the money
 * was settled. Built from an approved return — see sale-return-service.ts getCreditNote. */
export type CreditNoteDocument = {
  returnId: string;
  creditNoteNumber: string;
  issuedAt: string;
  businessName: string;
  locationName: string;
  locationPhone: string | null;
  locationAddress: string | null;
  /** "invoice" or "receipt", and its number. */
  againstKind: "invoice" | "receipt";
  againstNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  reason: string;
  notes: string | null;
  approvedByName: string | null;
  items: Array<{ productName: string; quantity: number; unitPriceCents: number; lineTotalCents: number }>;
  totalCents: number;
  /** Taken off what the customer still owed (invoice credit notes only). */
  balanceReductionCents: number;
  /** Paid back to the customer. */
  refundCents: number;
  /** For an invoice: what's still owed after this and every other credit note. */
  invoiceBalanceCents: number | null;
};
