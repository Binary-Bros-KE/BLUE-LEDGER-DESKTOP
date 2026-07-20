/** `customerId`/`phone` are null for the synthetic "Walk-in Customer" row, which aggregates every
 * qualifying sale with no customer attached — included so it can be ranked and compared like anyone
 * else, since it's real revenue and usually the single largest bucket. */
export type TopCustomerRow = {
  customerId: string | null;
  customerName: string;
  phone: string | null;
  transactionCount: number;
  revenueCents: number;
  averageSaleCents: number;
  percentOfTotal: number;
};

export type CustomerPurchaseHistoryEntry = {
  saleId: string;
  occurredAt: string;
  documentNumber: string | null;
  kind: "retail_sale" | "wholesale_sale" | "invoice";
  locationName: string;
  employeeName: string;
  itemCount: number;
  grandTotalCents: number;
  amountPaidCents: number;
  paymentStatus: string;
};

/** One outstanding (unpaid or partially-paid) invoice — a live, point-in-time
 * balance-sheet fact, not scoped to any selected period. `isOverdue` reflects
 * whether it's past its due date and still has money owed on it. */
export type OutstandingInvoiceRow = {
  saleId: string;
  customerId: string;
  customerName: string;
  phone: string;
  documentNumber: string | null;
  completedAt: string;
  dueDate: string | null;
  grandTotalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  isOverdue: boolean;
};

export type OutstandingInvoicesSummary = {
  totalOutstandingCents: number;
  debtorCount: number;
  overdueCount: number;
  invoices: OutstandingInvoiceRow[];
};
