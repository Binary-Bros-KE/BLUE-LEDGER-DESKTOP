import * as purchaseRepository from "@main/database/repositories/purchase-repository";
import * as supplierRepository from "@main/database/repositories/supplier-repository";
import { requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { statementFiltersSchema } from "@shared/schemas/statement";
import type { StatementPaymentEntry } from "@shared/types/statement";
import type { SupplierStatementViewModel } from "@shared/types/supplier-statement";

/** PurchasePayment (purchase.ts) names its "who/when" fields paidBy/paidAt — normalized here into
 * the one StatementPaymentEntry shape shared with the customer side (see statement-service.ts's
 * identical toStatementPayments). Newest first, matching how the purchase list itself sorts in a
 * history view. */
function toStatementPayments(raw: string): StatementPaymentEntry[] {
  return purchaseRepository
    .parsePurchasePayments(raw)
    .map((payment) => ({
      id: payment.id,
      occurredAt: payment.paidAt,
      amountCents: payment.amountCents,
      paymentMethodName: payment.paymentMethodName,
      reference: payment.reference,
      performedByName: payment.paidByName
    }))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

/** Ported from statement-service.ts's own identical helper (itself ported from report-service.ts) —
 * ties a plain YYYY-MM-DD to THIS device's local midnight. */
function startOfDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toISOString();
}

function addDaysIso(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/** Statement of Account — by default, every purchase order this supplier hasn't been fully paid for
 * yet, across every storefront, with running totals. Mirrors statement-service.ts's
 * getCustomerStatement exactly, just for the accounts-PAYABLE side instead of accounts-receivable:
 * nothing new to persist, a pure read/aggregate over the existing purchases+suppliers rows. Client
 * request: also needs to show paid/historical purchases on demand (filters.status) and an optional
 * date range — see statementFiltersSchema. */
export function getSupplierStatement(supplierId: string, filtersInput: unknown = {}): SupplierStatementViewModel {
  requirePermission("purchases", "view");
  const filters = statementFiltersSchema.parse(filtersInput);
  const tenant = getCurrentTenant();

  const supplier = supplierRepository.findSupplierRowById(supplierId);
  if (!supplier || supplier.tenant_id !== tenant.tenantId) {
    throw new Error("Supplier not found");
  }

  const rawPurchaseRows = purchaseRepository.findPurchaseRowsForSupplier(tenant.tenantId, supplierId, {
    status: filters.status,
    dateFromIso: filters.dateFrom ? startOfDayIso(filters.dateFrom) : null,
    dateToExclusiveIso: filters.dateTo ? addDaysIso(filters.dateTo, 1) : null
  });
  const purchases = rawPurchaseRows.map(purchaseRepository.mapPurchaseListRow);
  const paymentsByPurchaseId = new Map(rawPurchaseRows.map((row) => [row.id, toStatementPayments(row.payments)]));

  // Client request: "outstanding" is what's owed for received goods only — totalOrderedCents/
  // totalPaidCents stay as full-order-value context (still genuinely useful figures), but
  // totalOutstandingCents is the SUM of the same per-purchase balanceDueCents below, so the
  // statement's own total always matches the sum of the rows it shows.
  const totalOrderedCents = purchases.reduce((sum, purchase) => sum + purchase.grandTotalCents, 0);
  const totalPaidCents = purchases.reduce((sum, purchase) => sum + purchase.amountPaidCents, 0);
  const totalOutstandingCents = purchases.reduce(
    (sum, purchase) => sum + (purchase.receivedValueCents - purchase.amountPaidCents),
    0
  );

  return {
    businessName: tenant.businessName,
    physicalAddress: tenant.physicalAddress,
    primaryPhone: tenant.primaryPhone,
    currency: tenant.currency,
    supplierId: supplier.id,
    supplierName: supplier.business_name,
    supplierPhone: supplier.phone_1,
    supplierEmail: supplier.email,
    creditLimitCents: supplier.credit_limit_cents,
    generatedAt: new Date().toISOString(),
    filters: { status: filters.status, dateFrom: filters.dateFrom ?? null, dateTo: filters.dateTo ?? null },
    purchases: purchases.map((purchase) => ({
      id: purchase.id,
      purchaseNumber: purchase.purchaseNumber,
      orderedAt: purchase.orderedAt,
      grandTotalCents: purchase.grandTotalCents,
      amountPaidCents: purchase.amountPaidCents,
      // Client request: only ever the received-goods balance, never the full order total.
      balanceDueCents: purchase.receivedValueCents - purchase.amountPaidCents,
      paymentStatus: purchase.paymentStatus,
      payments: paymentsByPurchaseId.get(purchase.id) ?? []
    })),
    totalOrderedCents,
    totalPaidCents,
    totalOutstandingCents
  };
}
