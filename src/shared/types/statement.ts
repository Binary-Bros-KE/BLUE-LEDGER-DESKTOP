import type { PaymentStatus } from "./sale";

/** Mirrors statementFiltersSchema (shared/schemas/statement.ts) — echoed back on the view model so
 * the renderer (and the printed/shared document itself) can show what's actually included without
 * threading the request's own filter state through separately. */
export type StatementStatusFilter = "pending" | "paid" | "all";
export type StatementFilters = {
  status: StatementStatusFilter;
  dateFrom: string | null;
  dateTo: string | null;
};

/** One payment actually recorded against a statement line — normalized from SalePayment/
 * PurchasePayment (each side names its own "who/when" fields slightly differently: receivedBy/
 * receivedAt vs paidBy/paidAt) into one shape so StatementPreview.tsx and SupplierStatementModal.tsx
 * can render an identical payment-history sub-table either side. Client request: a statement used to
 * show only the running totals, not the payments that actually produced them. */
export type StatementPaymentEntry = {
  id: string;
  occurredAt: string;
  amountCents: number;
  paymentMethodName: string;
  reference: string | null;
  performedByName: string;
};

export type StatementInvoiceLine = {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  grandTotalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  paymentStatus: PaymentStatus;
  /** Newest first — every payment actually recorded against this invoice. */
  payments: StatementPaymentEntry[];
};

/** A customer's "Statement of Account" — every invoice they haven't fully paid off yet, across every
 * storefront, with running totals. Purely computed from existing sales/customers rows, no table of
 * its own (see sale-repository.ts's findOutstandingInvoiceRowsForCustomer). Not tied to one
 * storefront (a customer's invoices can span several), so business info is the tenant-wide default,
 * not any one Location's override. */
export type CustomerStatementViewModel = {
  businessName: string;
  physicalAddress: string | null;
  primaryPhone: string | null;
  currency: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  /** Null when the customer has no credit limit set — the statement simply omits the credit block. */
  creditLimitCents: number | null;
  generatedAt: string;
  /** What was actually requested — see StatementFilters' own doc comment. */
  filters: StatementFilters;
  invoices: StatementInvoiceLine[];
  totalInvoicedCents: number;
  totalPaidCents: number;
  totalOutstandingCents: number;
};
