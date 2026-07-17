import type { PaymentStatus, TransactionType } from "./sale";

/** Lightweight row for the Invoices list — no line items, just enough to identify and act on the invoice. */
export type InvoiceListItem = {
  id: string;
  invoiceNumber: string | null;
  receiptNumber: string | null;
  customerName: string | null;
  transactionType: TransactionType;
  locationName: string;
  invoiceDate: string | null;
  dueDate: string | null;
  grandTotalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  paymentStatus: PaymentStatus;
  createdAt: string;
  hasDeliveryNote: boolean;
};

/** Aggregate figures for the Invoices dashboard's summary cards. */
export type InvoiceSummary = {
  totalOutstandingCents: number;
  totalOverdueCents: number;
  totalPaidCents: number;
  totalInvoices: number;
  totalInvoiceValueCents: number;
};
