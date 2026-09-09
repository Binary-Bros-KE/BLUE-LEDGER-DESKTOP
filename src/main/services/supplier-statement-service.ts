import * as purchaseRepository from "@main/database/repositories/purchase-repository";
import * as supplierRepository from "@main/database/repositories/supplier-repository";
import { requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import type { SupplierStatementViewModel } from "@shared/types/supplier-statement";

/** Statement of Account — every purchase order this supplier hasn't been fully paid for yet, across
 * every storefront, with running totals. Mirrors statement-service.ts's getCustomerStatement exactly,
 * just for the accounts-PAYABLE side instead of accounts-receivable: nothing new to persist, a pure
 * read/aggregate over the existing purchases+suppliers rows. */
export function getSupplierStatement(supplierId: string): SupplierStatementViewModel {
  requirePermission("purchases", "view");
  const tenant = getCurrentTenant();

  const supplier = supplierRepository.findSupplierRowById(supplierId);
  if (!supplier || supplier.tenant_id !== tenant.tenantId) {
    throw new Error("Supplier not found");
  }

  const purchases = purchaseRepository
    .findOutstandingPurchaseRowsForSupplier(tenant.tenantId, supplierId)
    .map(purchaseRepository.mapPurchaseListRow);

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
    purchases: purchases.map((purchase) => ({
      id: purchase.id,
      purchaseNumber: purchase.purchaseNumber,
      orderedAt: purchase.orderedAt,
      grandTotalCents: purchase.grandTotalCents,
      amountPaidCents: purchase.amountPaidCents,
      // Client request: only ever the received-goods balance, never the full order total.
      balanceDueCents: purchase.receivedValueCents - purchase.amountPaidCents,
      paymentStatus: purchase.paymentStatus
    })),
    totalOrderedCents,
    totalPaidCents,
    totalOutstandingCents
  };
}
