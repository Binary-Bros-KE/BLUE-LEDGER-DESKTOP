export type DateRangeInput = {
  startDate: string;
  endDate: string;
};

export type SalesReportMode = "daily" | "weekly" | "monthly" | "yearly" | "custom";

export type SalesTrendWindowInput =
  | { mode: "daily"; anchor: string }
  | { mode: "weekly"; anchor: string }
  | { mode: "monthly"; anchor: string }
  | { mode: "yearly"; anchor: string }
  | { mode: "custom"; startDate: string; endDate: string };

export type SalesTopProduct = {
  productId: string;
  productName: string;
  quantitySold: number;
  revenueCents: number;
};

export type SalesPaymentSplitEntry = {
  paymentMethodId: string | null;
  paymentMethodName: string;
  revenueCents: number;
  transactionCount: number;
  percentOfTotal: number;
};

/** A ranked breakdown entry — expenses grouped by category, purchases
 * grouped by supplier, salaries grouped by employee. Same shape as "Sales by
 * Employee" so all these breakdowns read as one visual family. */
export type SalesCategoryBreakdownEntry = {
  id: string;
  name: string;
  documentCount: number;
  totalCents: number;
  percentOfTotal: number;
};

/** A customer who owes the business money (a "debtor") or a supplier the
 * business owes money to (a "creditor") — a current, point-in-time balance,
 * not scoped to the report's date range. */
export type SalesLedgerParty = {
  id: string | null;
  name: string;
  balanceCents: number;
  documentCount: number;
};

export type SalesVoidStats = {
  count: number;
  totalValueCents: number;
};

/** One approved return, dated by when it was approved (not when the original
 * sale happened) — approving a return assumes the customer was refunded, so
 * this is also the cash event that reduces Total Revenue for that period. */
export type SalesProcessedReturn = {
  returnId: string;
  approvedAt: string;
  documentNumber: string | null;
  customerName: string | null;
  returnedQuantity: number;
  returnedValueCents: number;
  reason: string;
};

/** One purchase order cancelled within the reporting period, dated by when it was created (not
 * received) — matching how every other Sales Report figure windows its period. Reports assume a
 * cancelled purchase was never paid (or the money was returned), so this is informational context
 * only; it never contributes to any revenue or expense total. */
export type CancelledPurchaseEntry = {
  purchaseId: string;
  purchaseNumber: string;
  supplierName: string;
  locationName: string;
  createdAt: string;
  grandTotalCents: number;
};

export type CancelledPurchasesReport = {
  count: number;
  totalCents: number;
  purchases: CancelledPurchaseEntry[];
};

/**
 * The financial story for one resolved date range: how much cash actually
 * came in (every source — full-paid sales plus whatever's been received
 * against invoices), how much of that was profit on the goods themselves,
 * what it cost to run the business over the same period, and what's left.
 */
export type SalesFinancialOverview = {
  startDate: string;
  endDate: string;
  totalRevenueCents: number;
  totalRevenueChangePercent: number | null;
  netRevenueCents: number;
  netRevenueChangePercent: number | null;
  totalExpensesCents: number;
  totalExpensesChangePercent: number | null;
  netProfitCents: number;
  netProfitChangePercent: number | null;
  transactionCount: number;
  averageSaleCents: number;
  itemsSold: number;
  /** Average Daily Revenue only means something once the range spans more than one day. */
  spansMultipleDays: boolean;
  averageDailyRevenueCents: number;
  topProducts: SalesTopProduct[];
  paymentSplit: SalesPaymentSplitEntry[];

  // --- Revenue breakdown: what Total Revenue is actually built from ---
  retailWholesaleRevenueCents: number;
  retailWholesaleDocumentCount: number;
  invoicePaymentRevenueCents: number;
  invoicePaymentDocumentCount: number;
  /** Approved returns are dated by when they were approved (a refund is assumed at that
   * moment), so this is subtracted from Total Revenue for whichever period it lands in. */
  returnRefundCents: number;
  returnRefundDocumentCount: number;
  grossSalesCents: number;
  costOfGoodsSoldCents: number;
  taxCollectedCents: number;
  discountGivenCents: number;

  // --- Expense breakdown: what Total Expenses is actually built from ---
  generalExpensesCents: number;
  generalExpensesDocumentCount: number;
  purchasesPaidCents: number;
  purchasesPaidDocumentCount: number;
  salariesPaidCents: number;
  salariesPaidDocumentCount: number;
  /** Hidden internal cost of service charges + delivery on completed sales — never shown to the
   * customer, but tracked here so delivery/service profitability shows up in Net Profit. */
  deliveryServiceCostsCents: number;
  deliveryServiceCostsDocumentCount: number;
  expensesByCategory: SalesCategoryBreakdownEntry[];
  purchasesBySupplier: SalesCategoryBreakdownEntry[];
  salariesByEmployee: SalesCategoryBreakdownEntry[];

  // --- Debtors / Creditors / Expected Profit: current balance-sheet snapshot ---
  debtors: SalesLedgerParty[];
  totalDebtCents: number;
  creditors: SalesLedgerParty[];
  totalCreditCents: number;
  expectedProfitCents: number;

  // --- Voided sales & processed returns: what changed vs. what was originally recorded ---
  voidStats: SalesVoidStats;
  processedReturns: SalesProcessedReturn[];
};

export type SalesTransactionKind = "retail_sale" | "wholesale_sale" | "invoice";

export type SalesTransactionRow = {
  id: string;
  kind: SalesTransactionKind;
  documentNumber: string | null;
  occurredAt: string;
  locationName: string;
  employeeName: string;
  customerName: string | null;
  paymentMethodName: string | null;
  amountCents: number;
  amountPaidCents: number;
  paymentStatus: string;
};

export type PaymentTransactionStatus = "complete" | "failed";

/** One actual money-movement event — a completed retail/wholesale sale (paid in full atomically),
 * or a single recorded payment against an invoice (an invoice with 3 payments produces 3 of these,
 * not 1). Deliberately not the same shape as SalesTransactionRow, which is "one row per document"
 * and carries a multi-value payment status — this is "one row per payment," with just two possible
 * outcomes: the money was received and still stands (`complete`), or the underlying sale was later
 * voided/cancelled (`failed`). */
export type PaymentTransactionRow = {
  id: string;
  transactionCode: string;
  occurredAt: string;
  locationName: string;
  paymentMethodName: string | null;
  processedByName: string;
  amountCents: number;
  status: PaymentTransactionStatus;
};

/** One of the current employee's own completed sales — deliberately narrower than
 * SalesTransactionRow (no location/employee name needed, since it's always "me"). */
export type MySaleEntry = {
  id: string;
  documentNumber: string | null;
  occurredAt: string;
  amountCents: number;
  paymentStatus: string;
};

export type SalesTrendPoint = {
  periodLabel: string;
  periodStart: string;
  revenueCents: number;
  transactionCount: number;
  /** The day/week/month/year the report is currently focused on — highlighted in the chart. */
  isSelected: boolean;
};

export type SalesTrendWindowResult = {
  mode: SalesReportMode;
  points: SalesTrendPoint[];
};

export type SalesByStorefrontRow = {
  locationId: string;
  locationName: string;
  revenueCents: number;
  transactionCount: number;
  averageSaleCents: number;
  percentOfTotal: number;
};

export type SalesByEmployeeRow = {
  employeeId: string;
  employeeName: string;
  branchName: string | null;
  revenueCents: number;
  transactionCount: number;
  averageSaleCents: number;
  percentOfTotal: number;
};

export type SalesByPaymentMethodRow = SalesPaymentSplitEntry;
