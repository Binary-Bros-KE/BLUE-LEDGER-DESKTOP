import type { PaymentStatus } from "./sale";

export type StatementInvoiceLine = {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  grandTotalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  paymentStatus: PaymentStatus;
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
  invoices: StatementInvoiceLine[];
  totalInvoicedCents: number;
  totalPaidCents: number;
  totalOutstandingCents: number;
};
