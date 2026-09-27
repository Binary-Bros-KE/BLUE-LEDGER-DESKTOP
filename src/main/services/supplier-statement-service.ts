import * as purchaseRepository from "@main/database/repositories/purchase-repository";
import * as supplierRepository from "@main/database/repositories/supplier-repository";
import { requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { computePurchasePayableCents } from "@shared/lib/purchase";
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

  const dateFilters = {
    dateFromIso: filters.dateFrom ? startOfDayIso(filters.dateFrom) : null,
    dateToExclusiveIso: filters.dateTo ? addDaysIso(filters.dateTo, 1) : null
  };

  const rawPurchaseRows = purchaseRepository.findPurchaseRowsForSupplier(tenant.tenantId, supplierId, {
    status: filters.status,
    ...dateFilters
  });
  const purchases = rawPurchaseRows.map(purchaseRepository.mapPurchaseListRow);
  const paymentsByPurchaseId = new Map(rawPurchaseRows.map((row) => [row.id, toStatementPayments(row.payments)]));

  // The header totals must stay a stable, filter-independent fact ("what is genuinely still owed"),
  // not a sum over whatever the "Show" dropdown happens to be displaying. Under "all"/"paid", the
  // listed rows can include paid/overpaid purchases whose balanceDueCents is negative (amount_paid
  // exceeds received_value on that one purchase) — summing those into the total lets them cancel out
  // real debt owed on OTHER purchases, producing a wrong, filter-dependent figure (confirmed live:
  // "all" showed a total smaller than a single genuinely-outstanding purchase's own balance). So the
  // totals are always computed from the same "pending" set findPurchaseRowsForSupplier already uses
  // (received_value_cents > amount_paid_cents), independent of filters.status — mirrors the client-
  // side outstandingPurchases filter SupplierStatementModal.tsx already applies for its bulk-pay flow.
  const outstandingRows =
    filters.status === "pending"
      ? rawPurchaseRows
      : purchaseRepository.findPurchaseRowsForSupplier(tenant.tenantId, supplierId, {
          status: "pending",
          ...dateFilters
        });
  const outstandingPurchases = outstandingRows.map(purchaseRepository.mapPurchaseListRow);
  const totalOrderedCents = outstandingPurchases.reduce((sum, purchase) => sum + purchase.grandTotalCents, 0);
  const totalPaidCents = outstandingPurchases.reduce((sum, purchase) => sum + purchase.amountPaidCents, 0);
  const totalOutstandingCents = outstandingPurchases.reduce(
    (sum, purchase) =>
      sum +
      (computePurchasePayableCents({ receivedValueCents: purchase.receivedValueCents, shippingFeeCents: purchase.shippingCostCents }) -
        purchase.amountPaidCents),
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
      // Client request: only ever the received-goods balance (plus the shipping fee once anything's
      // arrived — see computePurchasePayableCents), never the full order total.
      balanceDueCents:
        computePurchasePayableCents({ receivedValueCents: purchase.receivedValueCents, shippingFeeCents: purchase.shippingCostCents }) -
        purchase.amountPaidCents,
      paymentStatus: purchase.paymentStatus,
      payments: paymentsByPurchaseId.get(purchase.id) ?? []
    })),
    totalOrderedCents,
    totalPaidCents,
    totalOutstandingCents
  };
}
