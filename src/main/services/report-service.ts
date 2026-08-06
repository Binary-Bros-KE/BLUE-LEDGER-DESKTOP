import * as purchaseRepository from "@main/database/repositories/purchase-repository";
import * as reportRepository from "@main/database/repositories/report-repository";
import type { CompletedSaleRow, InvoicePaymentCandidateRow, PurchasePaymentCandidateRow, SaleItemProfitRow } from "@main/database/repositories/report-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, hasPermission, requirePermission, requirePermissionAnyOf } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { dateRangeInputSchema, salesTrendWindowInputSchema } from "@shared/schemas/report";
import type {
  CancelledPurchasesReport,
  MySaleEntry,
  PaymentTransactionRow,
  SalesByEmployeeRow,
  SalesByPaymentMethodRow,
  SalesByStorefrontRow,
  SalesCategoryBreakdownEntry,
  SalesFinancialOverview,
  SalesLedgerParty,
  SalesPaymentSplitEntry,
  SalesProcessedReturn,
  SalesReportMode,
  SalesTopProduct,
  SalesTransactionKind,
  SalesTransactionRow,
  SalesTrendPoint,
  SalesTrendWindowResult,
  SalesVoidStats,
} from "@shared/types/report";
import type { SalePayment } from "@shared/types/sale";
import type { PurchasePayment } from "@shared/types/purchase";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_RADIUS = 5;
const TOP_LIMIT = 10;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The device's real local calendar date, right now — deliberately NOT toIsoDate(new Date()), which
 * reads UTC date parts off a real "now" moment and is wrong by a day for part of the day in any
 * timezone ahead of UTC (e.g. at 1am in Nairobi, UTC is still on yesterday's date). Every OTHER
 * call to toIsoDate in this file converts an already-UTC-constructed abstract calendar Date back to
 * a string (correct — that Date was never a real "now" moment), so only this one entry point needed
 * to change. */
function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The UTC instant corresponding to LOCAL midnight of dateStr — this is what actually bounds every
 * report query against completed_at (stored as real UTC instants, see sale-repository.ts). Building
 * `new Date(year, month, day)` (no "Z", no offset) is interpreted by JS in the CURRENT PROCESS's own
 * local timezone, which for this single-machine offline-first app is exactly the device the sale was
 * rung up on — so this is always the right boundary regardless of that device's UTC offset.
 * Previously this just appended "T00:00:00.000Z" to the date string, silently treating every
 * calendar day as if it were UTC — for a timezone ahead of UTC, a sale rung up in the first few
 * hours of a local calendar day landed in the PREVIOUS day's report instead of today's. */
function startOfDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toISOString();
}

function addDaysIso(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function daySpan(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / DAY_MS) + 1;
}

function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function mondayOf(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  date.setUTCDate(date.getUTCDate() - diff);
  return toIsoDate(date);
}

type ParsedSalePayment = { paymentMethodId: string | null; paymentMethodName: string; amountCents: number; receivedAt: string };

function parseSalePayments(raw: string): ParsedSalePayment[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ParsedSalePayment[]) : [];
  } catch {
    return [];
  }
}

type ParsedPurchasePayment = { amountCents: number; paidAt: string };

function parsePurchasePayments(raw: string): ParsedPurchasePayment[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ParsedPurchasePayment[]) : [];
  } catch {
    return [];
  }
}

/** Same JSON column as parsePurchasePayments, but keeps every field — needed by
 * getPaymentTransactions (payment method, reference, who paid it), unlike the cash-flow summary
 * functions above which only ever need the amount and date. */
function parsePurchasePaymentEntries(raw: string): PurchasePayment[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PurchasePayment[]) : [];
  } catch {
    return [];
  }
}

function paymentMethodSummaryForInvoice(row: CompletedSaleRow): string | null {
  const payments = parseSalePayments(row.payments);
  if (payments.length === 0) return null;
  const distinctMethods = [...new Set(payments.map((p) => p.paymentMethodName))];
  return distinctMethods.length === 1 ? (distinctMethods[0] ?? null) : "Multiple";
}

function toBreakdownEntries(
  rows: { id: string; name: string; totalCents: number; documentCount: number }[],
  totalCents: number
): SalesCategoryBreakdownEntry[] {
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      totalCents: row.totalCents,
      documentCount: row.documentCount,
      percentOfTotal: totalCents > 0 ? Math.round((row.totalCents / totalCents) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

type CashRevenueResult = {
  totalCents: number;
  paymentSplit: SalesPaymentSplitEntry[];
  retailWholesaleCents: number;
  retailWholesaleDocumentCount: number;
  invoicePaymentCents: number;
  invoicePaymentDocumentCount: number;
  refundCents: number;
  refundDocumentCount: number;
};

/**
 * Money that actually came into the business in [startIso, endIsoExclusive):
 * retail/wholesale sales are paid in full the instant they complete, so those
 * are scoped by completed_at; an invoice's cash is only real once a payment
 * actually lands, and a payment's own `receivedAt` — not the invoice's
 * completion date — is what decides which period it belongs to. An approved
 * return assumes the customer was refunded at the moment it was approved, so
 * it's subtracted here too, dated by `approved_at`. The payment-method split
 * stays on a gross (pre-refund) basis — a refund isn't "collected by a
 * method", so it's not folded into that breakdown.
 */
function computeCashRevenue(
  retailWholesaleRows: CompletedSaleRow[],
  invoiceCandidates: InvoicePaymentCandidateRow[],
  refundRows: reportRepository.ApprovedReturnRefundRow[],
  startIso: string,
  endIsoExclusive: string
): CashRevenueResult {
  const buckets = new Map<string, { name: string; revenueCents: number; transactionCount: number }>();

  function addToBucket(key: string, name: string, amountCents: number): void {
    const existing = buckets.get(key) ?? { name, revenueCents: 0, transactionCount: 0 };
    existing.revenueCents += amountCents;
    existing.transactionCount += 1;
    buckets.set(key, existing);
  }

  let retailWholesaleCents = 0;
  for (const row of retailWholesaleRows) {
    addToBucket(row.payment_method_id ?? "other", row.payment_method_name || "Other", row.grand_total_cents);
    retailWholesaleCents += row.grand_total_cents;
  }

  let invoicePaymentCents = 0;
  const invoiceDocumentIds = new Set<string>();
  for (const row of invoiceCandidates) {
    for (const payment of parseSalePayments(row.payments)) {
      if (payment.receivedAt >= startIso && payment.receivedAt < endIsoExclusive) {
        addToBucket(payment.paymentMethodId ?? "other", payment.paymentMethodName || "Other", payment.amountCents);
        invoicePaymentCents += payment.amountCents;
        invoiceDocumentIds.add(row.id);
      }
    }
  }

  let refundCents = 0;
  const refundDocumentIds = new Set<string>();
  for (const refund of refundRows) {
    if (refund.approved_at >= startIso && refund.approved_at < endIsoExclusive && refund.returned_value_cents > 0) {
      refundCents += refund.returned_value_cents;
      refundDocumentIds.add(refund.return_id);
    }
  }

  const grossCents = retailWholesaleCents + invoicePaymentCents;
  const totalCents = grossCents - refundCents;
  const paymentSplit: SalesPaymentSplitEntry[] = [...buckets.entries()]
    .map(([id, bucket]) => ({
      paymentMethodId: id === "other" ? null : id,
      paymentMethodName: bucket.name,
      revenueCents: bucket.revenueCents,
      transactionCount: bucket.transactionCount,
      percentOfTotal: grossCents > 0 ? Math.round((bucket.revenueCents / grossCents) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);

  return {
    totalCents,
    paymentSplit,
    retailWholesaleCents,
    retailWholesaleDocumentCount: retailWholesaleRows.length,
    invoicePaymentCents,
    invoicePaymentDocumentCount: invoiceDocumentIds.size,
    refundCents,
    refundDocumentCount: refundDocumentIds.size,
  };
}

function sumPurchasePaymentsInRange(
  rows: PurchasePaymentCandidateRow[],
  startIso: string,
  endIsoExclusive: string
): { cents: number; documentCount: number } {
  let cents = 0;
  const documentIds = new Set<string>();
  for (const row of rows) {
    for (const payment of parsePurchasePayments(row.payments)) {
      if (payment.paidAt >= startIso && payment.paidAt < endIsoExclusive) {
        cents += payment.amountCents;
        documentIds.add(row.id);
      }
    }
  }
  return { cents, documentCount: documentIds.size };
}

function sumPurchasePaymentsBySupplier(
  rows: PurchasePaymentCandidateRow[],
  startIso: string,
  endIsoExclusive: string
): { id: string; name: string; totalCents: number; documentCount: number }[] {
  const buckets = new Map<string, { name: string; totalCents: number; documentIds: Set<string> }>();
  for (const row of rows) {
    for (const payment of parsePurchasePayments(row.payments)) {
      if (payment.paidAt >= startIso && payment.paidAt < endIsoExclusive) {
        const bucket = buckets.get(row.supplier_id) ?? { name: row.supplier_name, totalCents: 0, documentIds: new Set<string>() };
        bucket.totalCents += payment.amountCents;
        bucket.documentIds.add(row.id);
        buckets.set(row.supplier_id, bucket);
      }
    }
  }
  return [...buckets.entries()].map(([id, bucket]) => ({
    id,
    name: bucket.name,
    totalCents: bucket.totalCents,
    documentCount: bucket.documentIds.size,
  }));
}

/**
 * Gross profit on goods sold in this period, recognized only to the extent
 * cash has actually been collected against each specific sale so far (a
 * point-in-time fraction, not scoped to the period) — a fully-paid retail
 * sale recognizes 100% of its margin; a half-paid invoice recognizes half.
 * This is why Net Revenue can never exceed what's realistically been earned,
 * unlike a pure accrual figure that counts profit on goods nobody's paid for.
 *
 * feeRows folds in delivery/service-charge FEE revenue (what the customer was charged, e.g. a
 * delivery fee) the same way product margin is recognized — proportional to fractionPaid. Its COST
 * side (e.g. what the rider was actually paid) is deliberately NOT subtracted again here — delivery
 * cost is booked as a real "Delivery Costs" expense (feeding generalExpensesCents), and service-charge
 * cost is deducted once via findServiceChargeCostsInRange feeding totalExpensesCents. Before this, the
 * fee showed up in Total Revenue (it's baked into grand_total_cents) but never anywhere in Net
 * Revenue/Net Profit, while its cost always was — every delivery/service charge silently ate into Net
 * Profit with no corresponding credit for the money actually collected for it.
 */
function computeNetRevenueCents(rows: CompletedSaleRow[], itemRows: SaleItemProfitRow[], feeRows: reportRepository.SaleFeeRow[]): number {
  const bySale = new Map<string, { revenueCents: number; costCents: number }>();
  for (const item of itemRows) {
    const existing = bySale.get(item.sale_id) ?? { revenueCents: 0, costCents: 0 };
    existing.revenueCents += item.line_total_cents;
    existing.costCents += item.quantity * item.buying_price_cents;
    bySale.set(item.sale_id, existing);
  }
  for (const feeRow of feeRows) {
    const existing = bySale.get(feeRow.sale_id) ?? { revenueCents: 0, costCents: 0 };
    existing.revenueCents += feeRow.fee_cents;
    bySale.set(feeRow.sale_id, existing);
  }

  let netRevenueCents = 0;
  for (const row of rows) {
    const agg = bySale.get(row.id);
    if (!agg) continue;
    const fractionPaid = row.invoice_number === null ? 1 : row.grand_total_cents > 0 ? Math.min(1, row.amount_paid_cents / row.grand_total_cents) : 0;
    netRevenueCents += (agg.revenueCents - agg.costCents) * fractionPaid;
  }
  return Math.round(netRevenueCents);
}

/** Everything the Financial Overview cards and the "how we calculate this"
 * breakdown need for one resolved date range, compared against the
 * immediately preceding period of equal length. */
export function getSalesFinancialOverview(input: unknown): SalesFinancialOverview {
  requirePermissionAnyOf([
    ["reports", "view"],
    ["sales", "view"]
  ]);
  const { startDate, endDate } = dateRangeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const startIso = startOfDayIso(startDate);
  const endIsoExclusive = startOfDayIso(addDaysIso(endDate, 1));
  const span = daySpan(startDate, endDate);

  const previousEnd = addDaysIso(startDate, -1);
  const previousStart = addDaysIso(previousEnd, -(span - 1));
  const previousStartIso = startOfDayIso(previousStart);
  const previousEndIsoExclusive = startOfDayIso(addDaysIso(previousEnd, 1));

  const rows = reportRepository.findCompletedSaleRows(tenantId, locationId, startIso, endIsoExclusive);
  const itemRows = reportRepository.findSaleItemRowsInRange(tenantId, locationId, startIso, endIsoExclusive);
  const feeRows = reportRepository.findSaleFeeRowsInRange(tenantId, locationId, startIso, endIsoExclusive);
  const previousRows = reportRepository.findCompletedSaleRows(tenantId, locationId, previousStartIso, previousEndIsoExclusive);
  const previousItemRows = reportRepository.findSaleItemRowsInRange(tenantId, locationId, previousStartIso, previousEndIsoExclusive);
  const previousFeeRows = reportRepository.findSaleFeeRowsInRange(tenantId, locationId, previousStartIso, previousEndIsoExclusive);

  // Invoice-payment and return-refund candidates fetched once and reused for both periods.
  const invoiceCandidates = reportRepository.findInvoicePaymentCandidateRows(tenantId, locationId, endIsoExclusive);
  const refundRows = reportRepository.findApprovedReturnRefundRows(tenantId, locationId);

  const currentCash = computeCashRevenue(
    rows.filter((r) => r.invoice_number === null),
    invoiceCandidates,
    refundRows,
    startIso,
    endIsoExclusive
  );
  const previousCash = computeCashRevenue(
    previousRows.filter((r) => r.invoice_number === null),
    invoiceCandidates,
    refundRows,
    previousStartIso,
    previousEndIsoExclusive
  );

  const netRevenueCents = computeNetRevenueCents(rows, itemRows, feeRows);
  const previousNetRevenueCents = computeNetRevenueCents(previousRows, previousItemRows, previousFeeRows);

  const expenseCategoryRows = reportRepository.findExpenseCategoryBreakdownInRange(tenantId, locationId, startDate, endDate);
  const expensesByCategory = toBreakdownEntries(
    expenseCategoryRows.map((row) => ({
      id: row.category_id,
      name: row.category_name,
      totalCents: row.total_cents,
      documentCount: row.document_count,
    })),
    expenseCategoryRows.reduce((sum, row) => sum + row.total_cents, 0)
  );
  const generalExpensesCents = expenseCategoryRows.reduce((sum, row) => sum + row.total_cents, 0);
  const generalExpensesDocumentCount = expenseCategoryRows.reduce((sum, row) => sum + row.document_count, 0);
  const previousGeneralExpenses = reportRepository.findExpenseTotalCentsInRange(tenantId, locationId, previousStart, previousEnd);

  const purchaseCandidates = reportRepository.findPurchasePaymentCandidateRows(tenantId, locationId);
  const purchasesBySupplierRaw = sumPurchasePaymentsBySupplier(purchaseCandidates, startIso, endIsoExclusive);
  const purchasesBySupplier = toBreakdownEntries(
    purchasesBySupplierRaw,
    purchasesBySupplierRaw.reduce((sum, row) => sum + row.totalCents, 0)
  );
  const purchasesPaidCents = purchasesBySupplierRaw.reduce((sum, row) => sum + row.totalCents, 0);
  const purchasesPaidDocumentCount = purchasesBySupplierRaw.reduce((sum, row) => sum + row.documentCount, 0);
  const previousPurchasesPaid = sumPurchasePaymentsInRange(purchaseCandidates, previousStartIso, previousEndIsoExclusive);

  const salaryRows = reportRepository.findSalariesByEmployeeInRange(tenantId, locationId, startIso, endIsoExclusive);
  const salariesByEmployee = toBreakdownEntries(
    salaryRows.map((row) => ({ id: row.employee_id, name: row.employee_name, totalCents: row.total_cents, documentCount: row.document_count })),
    salaryRows.reduce((sum, row) => sum + row.total_cents, 0)
  );
  const salariesPaidCents = salaryRows.reduce((sum, row) => sum + row.total_cents, 0);
  const salariesPaidDocumentCount = salaryRows.reduce((sum, row) => sum + row.document_count, 0);
  const previousSalaries = reportRepository.findSalaryPayoutCentsInRange(tenantId, locationId, previousStartIso, previousEndIsoExclusive);

  const serviceChargeCosts = reportRepository.findServiceChargeCostsInRange(tenantId, locationId, startIso, endIsoExclusive);
  const serviceChargeCostsCents = serviceChargeCosts.totalCents;
  const serviceChargeCostsDocumentCount = serviceChargeCosts.documentCount;
  const previousServiceChargeCosts = reportRepository.findServiceChargeCostsInRange(tenantId, locationId, previousStartIso, previousEndIsoExclusive);

  const totalExpensesCents = generalExpensesCents + purchasesPaidCents + salariesPaidCents + serviceChargeCostsCents;
  const previousTotalExpensesCents =
    previousGeneralExpenses.totalCents + previousPurchasesPaid.cents + previousSalaries.totalCents + previousServiceChargeCosts.totalCents;

  const netProfitCents = netRevenueCents - totalExpensesCents;
  const previousNetProfitCents = previousNetRevenueCents - previousTotalExpensesCents;

  const transactionCount = rows.length;
  const grossSalesCents = itemRows.reduce((sum, item) => sum + item.line_total_cents, 0);
  const costOfGoodsSoldCents = itemRows.reduce((sum, item) => sum + item.quantity * item.buying_price_cents, 0);
  const averageSaleCents = transactionCount > 0 ? Math.round(grossSalesCents / transactionCount) : 0;
  const itemsSold = itemRows.reduce((sum, item) => sum + item.quantity, 0);
  const averageDailyRevenueCents = span > 0 ? Math.round(grossSalesCents / span) : 0;

  const productMap = new Map<string, SalesTopProduct>();
  for (const item of itemRows) {
    const existing = productMap.get(item.product_id) ?? {
      productId: item.product_id,
      productName: item.product_name,
      quantitySold: 0,
      revenueCents: 0,
    };
    existing.quantitySold += item.quantity;
    existing.revenueCents += item.line_total_cents;
    productMap.set(item.product_id, existing);
  }
  const topProducts = [...productMap.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, TOP_LIMIT);

  const taxCollectedCents = rows.reduce((sum, row) => sum + row.tax_amount_cents, 0);
  const discountGivenCents = rows.reduce((sum, row) => sum + row.discount_amount_cents, 0);

  const debtorRows = reportRepository.findOutstandingDebtors(tenantId, locationId);
  const creditorRows = reportRepository.findOutstandingCreditors(tenantId, locationId);
  const debtors: SalesLedgerParty[] = debtorRows.map((row) => ({
    id: row.customer_id,
    name: row.customer_name,
    balanceCents: row.balance_cents,
    documentCount: row.document_count,
  }));
  const creditors: SalesLedgerParty[] = creditorRows.map((row) => ({
    id: row.supplier_id,
    name: row.supplier_name,
    balanceCents: row.balance_cents,
    documentCount: row.document_count,
  }));
  const totalDebtCents = debtors.reduce((sum, d) => sum + d.balanceCents, 0);
  const totalCreditCents = creditors.reduce((sum, c) => sum + c.balanceCents, 0);
  const expectedProfitCents = netProfitCents + totalDebtCents - totalCreditCents;

  const voidStatsRow = reportRepository.findVoidedSalesStatsInRange(tenantId, locationId, startIso, endIsoExclusive);
  const voidStats: SalesVoidStats = { count: voidStatsRow.void_count, totalValueCents: voidStatsRow.total_value_cents };

  const processedReturnRows = reportRepository.findProcessedReturnsInRange(tenantId, locationId, startIso, endIsoExclusive);
  const processedReturns: SalesProcessedReturn[] = processedReturnRows.map((row) => ({
    returnId: row.return_id,
    approvedAt: row.approved_at,
    documentNumber: row.document_number,
    customerName: row.customer_name,
    returnedQuantity: row.returned_quantity,
    returnedValueCents: row.returned_value_cents,
    reason: row.reason,
  }));

  return {
    startDate,
    endDate,
    totalRevenueCents: currentCash.totalCents,
    totalRevenueChangePercent: percentChange(currentCash.totalCents, previousCash.totalCents),
    netRevenueCents,
    netRevenueChangePercent: percentChange(netRevenueCents, previousNetRevenueCents),
    totalExpensesCents,
    totalExpensesChangePercent: percentChange(totalExpensesCents, previousTotalExpensesCents),
    netProfitCents,
    netProfitChangePercent: percentChange(netProfitCents, previousNetProfitCents),
    transactionCount,
    averageSaleCents,
    itemsSold,
    spansMultipleDays: span > 1,
    averageDailyRevenueCents,
    topProducts,
    paymentSplit: currentCash.paymentSplit,
    retailWholesaleRevenueCents: currentCash.retailWholesaleCents,
    retailWholesaleDocumentCount: currentCash.retailWholesaleDocumentCount,
    invoicePaymentRevenueCents: currentCash.invoicePaymentCents,
    invoicePaymentDocumentCount: currentCash.invoicePaymentDocumentCount,
    returnRefundCents: currentCash.refundCents,
    returnRefundDocumentCount: currentCash.refundDocumentCount,
    grossSalesCents,
    costOfGoodsSoldCents,
    taxCollectedCents,
    discountGivenCents,
    generalExpensesCents,
    generalExpensesDocumentCount,
    purchasesPaidCents,
    purchasesPaidDocumentCount,
    salariesPaidCents,
    salariesPaidDocumentCount,
    serviceChargeCostsCents,
    serviceChargeCostsDocumentCount,
    expensesByCategory,
    purchasesBySupplier,
    salariesByEmployee,
    debtors,
    totalDebtCents,
    creditors,
    totalCreditCents,
    expectedProfitCents,
    voidStats,
    processedReturns,
  };
}

/** Every individual transaction in the range, newest first — the detail
 * behind the summary cards. Already excludes approved voids, cancelled
 * invoices, and invoices nobody has paid anything toward yet (see
 * report-repository's findCompletedSaleRows). */
export function getSalesTransactions(input: unknown): SalesTransactionRow[] {
  requirePermissionAnyOf([
    ["reports", "view"],
    ["sales", "view"]
  ]);
  const { startDate, endDate } = dateRangeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const rows = reportRepository.findCompletedSaleRows(tenantId, locationId, startOfDayIso(startDate), startOfDayIso(addDaysIso(endDate, 1)));

  return rows.map((row) => ({
    id: row.id,
    kind: row.transaction_type as SalesTransactionKind,
    documentNumber: row.invoice_number ?? row.receipt_number,
    occurredAt: row.completed_at,
    locationName: row.location_name,
    employeeName: row.employee_name,
    customerName: row.customer_name,
    paymentMethodName: row.invoice_number !== null ? paymentMethodSummaryForInvoice(row) : row.payment_method_name,
    amountCents: row.grand_total_cents,
    amountPaidCents: row.amount_paid_cents,
    paymentStatus: row.payment_status,
  }));
}

/** Cancelled purchases in the period — shown separately from every other figure on this page since
 * reports assume a cancelled purchase was never paid (or the money was returned): it doesn't count
 * toward supplier spend, expenses, or anything else, but the admin still needs to see what got
 * cancelled and why the numbers might look lower than expected. */
export function getCancelledPurchasesInRange(input: unknown): CancelledPurchasesReport {
  requirePermissionAnyOf([
    ["reports", "view"],
    ["purchases", "view"]
  ]);
  const { startDate, endDate } = dateRangeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const rows = purchaseRepository.findCancelledPurchaseRowsInRange(
    tenantId,
    locationId,
    startOfDayIso(startDate),
    startOfDayIso(addDaysIso(endDate, 1))
  );

  const purchases = rows.map((row) => ({
    purchaseId: row.id,
    purchaseNumber: row.purchase_number,
    supplierName: row.supplier_name,
    locationName: row.location_name,
    createdAt: row.created_at,
    grandTotalCents: row.grand_total_cents
  }));

  return {
    count: purchases.length,
    totalCents: purchases.reduce((sum, purchase) => sum + purchase.grandTotalCents, 0),
    purchases
  };
}

function parseSalePaymentsJson(raw: string): SalePayment[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SalePayment[]) : [];
  } catch {
    return [];
  }
}

/** Every actual money-movement event in the range — a completed retail/wholesale sale is one
 * transaction (paid in full atomically); an invoice is flattened into one transaction PER payment
 * recorded against it, since that's genuinely when each chunk of money arrived. Unlike
 * getSalesTransactions, this deliberately INCLUDES voided/cancelled sales (flagged "failed") rather
 * than hiding them, since "was this specific payment ever reversed" is exactly what this tab exists
 * to answer. */
/**
 * Every actual money-movement event across the whole business, in one flat ledger — money IN
 * (sales/invoice payments) and money OUT (purchase payments, expenses, salary payouts), each
 * flagged with a `direction`. Money-IN visibility is unchanged from before (gated on "sales", same
 * as Checkout/Receipts — a Cashier sees their own storefront's sales here same as always).
 *
 * Money-OUT rows are gated on "reports:view" as a WHOLE, not on each category's own view permission
 * ("purchases"/"expenses"/"salaries") — those permissions already mean something narrower/different
 * for Cashier and Storekeeper (who hold them by default) and leaking company-wide payment data
 * through them was a real bug, not a design choice:
 *   - salary-service.ts's own `hasFullVisibility()` already establishes that plain "salaries:view"
 *     is SELF-SCOPED ("see my own payslips") — full company payroll visibility requires
 *     "salaries:edit" or "salaries:export", which only Manager/Super Admin hold. Gating this ledger
 *     on bare "salaries:view" would have shown every employee's payslip to any Cashier/Storekeeper.
 *   - Storekeeper's "purchases:view" is meant for seeing purchase ORDERS (to receive stock), not
 *     supplier PAYMENT amounts/references — a different kind of sensitivity.
 * "reports:view" is this app's own established boundary for exactly this kind of company-wide
 * financial visibility (see the doc comment on ensureCashierStorekeeperReportsRemoved-style fixes
 * elsewhere in role-service.ts: "Reports tabs must stay Super Admin/Manager only") — by default only
 * Manager and Super Admin hold it, and using it here doesn't touch Cashier's own-payslip viewing or
 * Storekeeper's purchase-order visibility anywhere else in the app.
 */
export function getPaymentTransactions(input: unknown): PaymentTransactionRow[] {
  requirePermissionAnyOf([
    ["reports", "view"],
    ["sales", "view"]
  ]);
  const { startDate, endDate } = dateRangeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  const startIso = startOfDayIso(startDate);
  const endIsoExclusive = startOfDayIso(addDaysIso(endDate, 1));

  const results: PaymentTransactionRow[] = [];

  const saleRows = reportRepository.findPaymentTransactionRows(tenantId, locationId, startIso, endIsoExclusive);
  for (const row of saleRows) {
    const status = row.is_voided ? "failed" : "complete";
    const partyName = row.customer_name ?? "Walk-in customer";

    if (row.invoice_number !== null) {
      for (const payment of parseSalePaymentsJson(row.payments)) {
        results.push({
          id: `${row.id}:${payment.id}`,
          transactionCode: payment.reference ?? row.invoice_number ?? row.id,
          occurredAt: payment.receivedAt,
          locationName: row.location_name,
          paymentMethodName: payment.paymentMethodName,
          processedByName: payment.receivedByName,
          partyName,
          partyLabel: "Customer",
          sourceType: "sale",
          direction: "in",
          amountCents: payment.amountCents,
          status
        });
      }
    } else {
      results.push({
        id: row.id,
        transactionCode: row.payment_reference ?? row.receipt_number ?? row.id,
        occurredAt: row.completed_at,
        locationName: row.location_name,
        paymentMethodName: row.payment_method_name,
        processedByName: row.employee_name,
        partyName,
        partyLabel: "Customer",
        sourceType: "sale",
        direction: "in",
        amountCents: row.grand_total_cents,
        status
      });
    }
  }

  // See the doc comment above — every money-OUT category shares this one gate rather than each
  // riding on its own (differently-scoped) view permission.
  if (hasPermission("reports", "view")) {
    const purchaseRows = reportRepository.findPurchasePaymentCandidateRows(tenantId, locationId);
    for (const row of purchaseRows) {
      for (const payment of parsePurchasePaymentEntries(row.payments)) {
        if (payment.paidAt < startIso || payment.paidAt >= endIsoExclusive) continue;
        results.push({
          id: `${row.id}:${payment.id}`,
          transactionCode: payment.reference ?? row.id,
          occurredAt: payment.paidAt,
          locationName: row.location_name,
          paymentMethodName: payment.paymentMethodName,
          processedByName: payment.paidByName,
          partyName: row.supplier_name,
          partyLabel: "Supplier",
          sourceType: "purchase",
          direction: "out",
          amountCents: payment.amountCents,
          status: "complete"
        });
      }
    }

    const expenseRows = reportRepository.findExpenseTransactionRows(tenantId, locationId, startDate, endDate);
    for (const row of expenseRows) {
      results.push({
        id: row.id,
        transactionCode: row.reference ?? row.expense_number,
        occurredAt: row.expense_date,
        locationName: row.location_name,
        paymentMethodName: row.payment_method_name,
        processedByName: row.created_by_name ?? "—",
        partyName: row.description?.trim() || row.category_name,
        partyLabel: "For",
        sourceType: "expense",
        direction: "out",
        amountCents: row.amount_cents,
        status: "complete"
      });
    }

    const salaryRows = reportRepository.findSalaryTransactionRows(tenantId, locationId, startIso, endIsoExclusive);
    for (const row of salaryRows) {
      results.push({
        id: row.id,
        transactionCode: row.payment_reference ?? row.payslip_number,
        occurredAt: row.created_at,
        locationName: row.location_name,
        paymentMethodName: row.payment_method_name,
        processedByName: row.created_by_name ?? "Payroll",
        partyName: row.employee_name,
        partyLabel: "Employee",
        sourceType: "salary",
        direction: "out",
        amountCents: row.net_pay_cents,
        status: row.status === "voided" ? "failed" : "complete"
      });
    }
  }

  return results.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

/** The current employee's own completed sales in the range, newest first —
 * powers the Cashier dashboard's personal sales list. Employee-filtered by
 * session identity (not name matching), so it's reliable even across
 * employees who share a name. */
export function getMySales(input: unknown): MySaleEntry[] {
  requirePermissionAnyOf([
    ["reports", "view"],
    ["sales", "view"]
  ]);
  const { startDate, endDate } = dateRangeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  const employeeId = getCurrentEmployeeId();

  const rows = reportRepository.findCompletedSaleRows(tenantId, locationId, startOfDayIso(startDate), startOfDayIso(addDaysIso(endDate, 1)));

  return rows
    .filter((row) => row.employee_id === employeeId)
    .map((row) => ({
      id: row.id,
      documentNumber: row.invoice_number ?? row.receipt_number,
      occurredAt: row.completed_at,
      amountCents: row.grand_total_cents,
      paymentStatus: row.payment_status,
    }));
}

export function getSalesByStorefront(input: unknown): SalesByStorefrontRow[] {
  requirePermission("reports", "view");
  const { startDate, endDate } = dateRangeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const rows = reportRepository.findCompletedSaleRows(tenantId, locationId, startOfDayIso(startDate), startOfDayIso(addDaysIso(endDate, 1)));
  const totalRevenueCents = rows.reduce((sum, row) => sum + row.grand_total_cents, 0);

  const buckets = new Map<string, { name: string; revenueCents: number; transactionCount: number }>();
  for (const row of rows) {
    const bucket = buckets.get(row.location_id) ?? { name: row.location_name, revenueCents: 0, transactionCount: 0 };
    bucket.revenueCents += row.grand_total_cents;
    bucket.transactionCount += 1;
    buckets.set(row.location_id, bucket);
  }

  return [...buckets.entries()]
    .map(([locId, bucket]) => ({
      locationId: locId,
      locationName: bucket.name,
      revenueCents: bucket.revenueCents,
      transactionCount: bucket.transactionCount,
      averageSaleCents: bucket.transactionCount > 0 ? Math.round(bucket.revenueCents / bucket.transactionCount) : 0,
      percentOfTotal: totalRevenueCents > 0 ? Math.round((bucket.revenueCents / totalRevenueCents) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

export function getSalesByEmployee(input: unknown): SalesByEmployeeRow[] {
  requirePermissionAnyOf([
    ["reports", "view"],
    ["sales", "view"]
  ]);
  const { startDate, endDate } = dateRangeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const rows = reportRepository.findCompletedSaleRows(tenantId, locationId, startOfDayIso(startDate), startOfDayIso(addDaysIso(endDate, 1)));
  const totalRevenueCents = rows.reduce((sum, row) => sum + row.grand_total_cents, 0);

  const buckets = new Map<string, { name: string; revenueCents: number; transactionCount: number; branches: Set<string> }>();
  for (const row of rows) {
    const bucket = buckets.get(row.employee_id) ?? { name: row.employee_name, revenueCents: 0, transactionCount: 0, branches: new Set<string>() };
    bucket.revenueCents += row.grand_total_cents;
    bucket.transactionCount += 1;
    bucket.branches.add(row.location_name);
    buckets.set(row.employee_id, bucket);
  }

  return [...buckets.entries()]
    .map(([employeeId, bucket]) => ({
      employeeId,
      employeeName: bucket.name,
      branchName: bucket.branches.size > 1 ? "Multiple Branches" : ([...bucket.branches][0] ?? null),
      revenueCents: bucket.revenueCents,
      transactionCount: bucket.transactionCount,
      averageSaleCents: bucket.transactionCount > 0 ? Math.round(bucket.revenueCents / bucket.transactionCount) : 0,
      percentOfTotal: totalRevenueCents > 0 ? Math.round((bucket.revenueCents / totalRevenueCents) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

export function getSalesByPaymentMethod(input: unknown): SalesByPaymentMethodRow[] {
  requirePermission("reports", "view");
  const { startDate, endDate } = dateRangeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const startIso = startOfDayIso(startDate);
  const endIsoExclusive = startOfDayIso(addDaysIso(endDate, 1));
  const rows = reportRepository.findCompletedSaleRows(tenantId, locationId, startIso, endIsoExclusive);
  const invoiceCandidates = reportRepository.findInvoicePaymentCandidateRows(tenantId, locationId, endIsoExclusive);

  // Gross collections by method — a refund isn't "collected by a method", so it's never netted in here.
  return computeCashRevenue(
    rows.filter((r) => r.invoice_number === null),
    invoiceCandidates,
    [],
    startIso,
    endIsoExclusive
  ).paymentSplit;
}

// ---------------------------------------------------------------------------
// Trend window — Daily/Weekly/Monthly/Yearly show nearby context around
// whatever's selected (never just a single dot); Custom keeps day/week/month
// auto-bucketing across the exact range. Every bucket uses the exact same
// cash-revenue calculation as the Financial Overview, so the trend line
// always reconciles with the Total Revenue card for the selected period.
// ---------------------------------------------------------------------------

function resolveGroupBy(startDate: string, endDate: string): "day" | "week" | "month" {
  const span = daySpan(startDate, endDate);
  if (span <= 31) return "day";
  if (span <= 180) return "week";
  return "month";
}

function bucketLabel(dateStr: string, groupBy: "day" | "week" | "month"): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  if (groupBy === "day") {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }
  if (groupBy === "week") {
    const start = new Date(`${dateStr}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}`;
  }
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

function generateBuckets(
  startDate: string,
  endDate: string,
  groupBy: "day" | "week" | "month"
): { key: string; label: string; startDate: string; endDate: string }[] {
  const buckets: { key: string; label: string; startDate: string; endDate: string }[] = [];

  if (groupBy === "day") {
    let cursor = startDate;
    while (cursor <= endDate) {
      buckets.push({ key: cursor, label: bucketLabel(cursor, "day"), startDate: cursor, endDate: cursor });
      cursor = addDaysIso(cursor, 1);
    }
  } else if (groupBy === "week") {
    let cursor = mondayOf(startDate);
    while (cursor <= endDate) {
      const weekEnd = addDaysIso(cursor, 6);
      buckets.push({ key: cursor, label: bucketLabel(cursor, "week"), startDate: cursor, endDate: weekEnd });
      cursor = addDaysIso(cursor, 7);
    }
  } else {
    let cursor = `${startDate.slice(0, 7)}-01`;
    while (cursor <= endDate) {
      const [year, month] = cursor.split("-").map(Number);
      const end = new Date(Date.UTC(year ?? 0, month ?? 1, 0));
      buckets.push({ key: cursor, label: bucketLabel(cursor, "month"), startDate: cursor, endDate: toIsoDate(end) });
      const next = new Date(Date.UTC(year ?? 0, month ?? 1, 1));
      cursor = toIsoDate(next);
    }
  }

  return buckets;
}

function shiftAnchor(mode: Exclude<SalesReportMode, "custom">, anchor: string, steps: number): string {
  if (mode === "daily") return addDaysIso(anchor, steps);
  if (mode === "weekly") return addDaysIso(anchor, steps * 7);
  if (mode === "monthly") {
    const [year, month] = anchor.split("-").map(Number);
    const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1 + steps, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return String(Number(anchor) + steps);
}

function currentAnchorForMode(mode: Exclude<SalesReportMode, "custom">): string {
  const today = localTodayIso();
  if (mode === "daily") return today;
  if (mode === "weekly") return mondayOf(today);
  if (mode === "monthly") return today.slice(0, 7);
  return today.slice(0, 4);
}

function rangeForAnchor(mode: Exclude<SalesReportMode, "custom">, anchor: string): { startDate: string; endDate: string } {
  if (mode === "daily") return { startDate: anchor, endDate: anchor };
  if (mode === "weekly") return { startDate: anchor, endDate: addDaysIso(anchor, 6) };
  if (mode === "monthly") {
    const [year, month] = anchor.split("-").map(Number);
    const end = new Date(Date.UTC(year ?? 0, month ?? 1, 0));
    return { startDate: `${anchor}-01`, endDate: toIsoDate(end) };
  }
  return { startDate: `${anchor}-01-01`, endDate: `${anchor}-12-31` };
}

function periodLabelForAnchor(mode: Exclude<SalesReportMode, "custom">, anchor: string): string {
  if (mode === "daily") {
    return new Date(`${anchor}T00:00:00.000Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }
  if (mode === "weekly") {
    const start = new Date(`${anchor}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}`;
  }
  if (mode === "monthly") {
    return new Date(`${anchor}-01T00:00:00.000Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
  }
  return anchor;
}

/** Daily/Weekly/Monthly/Yearly: a window of nearby periods (5 before, 5 after,
 * clamped so nothing beyond "now" ever renders) with the selected one flagged.
 * Custom: day/week/month auto-bucketing across the exact range. Every point's
 * revenue is the same cash-basis figure the Financial Overview cards use, so
 * the selected point always matches the Total Revenue card exactly. */
export function getSalesTrendWindow(input: unknown): SalesTrendWindowResult {
  requirePermission("reports", "view");
  const parsed = salesTrendWindowInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  if (parsed.mode === "custom") {
    const { startDate, endDate } = parsed;
    const endIsoExclusive = startOfDayIso(addDaysIso(endDate, 1));
    const rows = reportRepository.findCompletedSaleRows(tenantId, locationId, startOfDayIso(startDate), endIsoExclusive);
    const invoiceCandidates = reportRepository.findInvoicePaymentCandidateRows(tenantId, locationId, endIsoExclusive);
    const refundRows = reportRepository.findApprovedReturnRefundRows(tenantId, locationId);
    const groupBy = resolveGroupBy(startDate, endDate);
    const buckets = generateBuckets(startDate, endDate, groupBy);

    const points: SalesTrendPoint[] = buckets.map((bucket) => {
      const bucketStartIso = startOfDayIso(bucket.startDate);
      const bucketEndIsoExclusive = startOfDayIso(addDaysIso(bucket.endDate, 1));
      const rowsInBucket = rows.filter((r) => r.completed_at >= bucketStartIso && r.completed_at < bucketEndIsoExclusive);
      const cash = computeCashRevenue(
        rowsInBucket.filter((r) => r.invoice_number === null),
        invoiceCandidates,
        refundRows,
        bucketStartIso,
        bucketEndIsoExclusive
      );
      return {
        periodStart: bucket.key,
        periodLabel: bucket.label,
        revenueCents: cash.totalCents,
        transactionCount: rowsInBucket.length,
        isSelected: false,
      };
    });

    return { mode: "custom", points };
  }

  const mode = parsed.mode;
  const maxAnchor = currentAnchorForMode(mode);
  const anchors: string[] = [];
  for (let step = -WINDOW_RADIUS; step <= WINDOW_RADIUS; step++) {
    const anchor = shiftAnchor(mode, parsed.anchor, step);
    if (anchor <= maxAnchor) anchors.push(anchor);
  }

  const lastAnchor = anchors[anchors.length - 1] ?? parsed.anchor;
  const lastRange = rangeForAnchor(mode, lastAnchor);
  const windowEndIsoExclusive = startOfDayIso(addDaysIso(lastRange.endDate, 1));
  const invoiceCandidates = reportRepository.findInvoicePaymentCandidateRows(tenantId, locationId, windowEndIsoExclusive);
  const refundRows = reportRepository.findApprovedReturnRefundRows(tenantId, locationId);

  const points: SalesTrendPoint[] = anchors.map((anchor) => {
    const { startDate, endDate } = rangeForAnchor(mode, anchor);
    const pointStartIso = startOfDayIso(startDate);
    const pointEndIsoExclusive = startOfDayIso(addDaysIso(endDate, 1));
    const rows = reportRepository.findCompletedSaleRows(tenantId, locationId, pointStartIso, pointEndIsoExclusive);
    const cash = computeCashRevenue(
      rows.filter((r) => r.invoice_number === null),
      invoiceCandidates,
      refundRows,
      pointStartIso,
      pointEndIsoExclusive
    );
    return {
      periodLabel: periodLabelForAnchor(mode, anchor),
      periodStart: startDate,
      revenueCents: cash.totalCents,
      transactionCount: rows.length,
      isSelected: anchor === parsed.anchor,
    };
  });

  return { mode, points };
}
