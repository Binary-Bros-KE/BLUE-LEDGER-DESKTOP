/** One currently-outstanding (unpaid or partially-paid) purchase — a live,
 * point-in-time balance-sheet fact. Purchases have no due date in this
 * schema, so `daysOutstanding` (since the PO was placed) stands in for the
 * "overdue" concept used on the customer side. */
export type OutstandingPurchaseRow = {
  purchaseId: string;
  supplierId: string;
  supplierName: string;
  phone: string;
  purchaseNumber: string;
  status: string;
  orderedAt: string | null;
  grandTotalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  daysOutstanding: number;
};

export type OutstandingPurchasesSummary = {
  totalOutstandingCents: number;
  creditorCount: number;
  purchases: OutstandingPurchaseRow[];
};

/** One supplier's total purchase activity in a period, ranked by value — "who we bought from the
 * most," not just who's been paid so far (that's Outstanding Purchases). */
export type SupplierSpendRow = {
  supplierId: string;
  supplierName: string;
  phone: string;
  purchaseCount: number;
  totalSpentCents: number;
  percentOfTotal: number;
};

export type SupplierPurchaseHistoryEntry = {
  purchaseId: string;
  purchaseNumber: string;
  status: string;
  orderedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  itemCount: number;
  grandTotalCents: number;
  amountPaidCents: number;
  paymentStatus: string;
};
