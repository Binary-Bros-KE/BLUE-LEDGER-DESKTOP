import * as supplierReportRepository from "@main/database/repositories/supplier-report-repository";
import { getCurrentBranchScope, requirePermission, requirePermissionAnyOf } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { supplierPurchaseHistoryInputSchema } from "@shared/schemas/supplier-report";
import type { OutstandingPurchaseRow, OutstandingPurchasesSummary, SupplierPurchaseHistoryEntry } from "@shared/types/supplier-report";

const PURCHASE_HISTORY_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every currently-outstanding purchase — a live balance-sheet snapshot,
 * deliberately not scoped to any selected period (same reasoning as Sales
 * Report's Creditors section). */
export function getOutstandingPurchases(): OutstandingPurchasesSummary {
  requirePermissionAnyOf([
    ["reports", "view"],
    ["purchases", "view"]
  ]);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const now = Date.now();
  const rows = supplierReportRepository.findOutstandingPurchases(tenantId, locationId);

  const purchases: OutstandingPurchaseRow[] = rows
    .map((row) => {
      const balanceCents = Math.max(0, row.grand_total_cents - row.amount_paid_cents);
      const referenceDate = row.ordered_at ?? row.created_at;
      return {
        purchaseId: row.purchase_id,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        phone: row.phone,
        purchaseNumber: row.purchase_number,
        status: row.status,
        orderedAt: row.ordered_at,
        grandTotalCents: row.grand_total_cents,
        amountPaidCents: row.amount_paid_cents,
        balanceCents,
        daysOutstanding: Math.floor((now - new Date(referenceDate).getTime()) / DAY_MS),
      };
    })
    .filter((purchase) => purchase.balanceCents > 0);

  return {
    totalOutstandingCents: purchases.reduce((sum, purchase) => sum + purchase.balanceCents, 0),
    creditorCount: new Set(purchases.map((purchase) => purchase.supplierId)).size,
    purchases,
  };
}

/** Every purchase for one supplier, newest first — not period-scoped, since
 * a "purchase history" is the whole story, not a slice of it. */
export function getSupplierPurchaseHistory(input: unknown): SupplierPurchaseHistoryEntry[] {
  requirePermission("reports", "view");
  const { supplierId } = supplierPurchaseHistoryInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const rows = supplierReportRepository.findSupplierPurchaseHistory(tenantId, locationId, supplierId, PURCHASE_HISTORY_LIMIT);

  return rows.map((row) => ({
    purchaseId: row.purchase_id,
    purchaseNumber: row.purchase_number,
    status: row.status,
    orderedAt: row.ordered_at,
    receivedAt: row.received_at,
    createdAt: row.created_at,
    itemCount: row.item_count,
    grandTotalCents: row.grand_total_cents,
    amountPaidCents: row.amount_paid_cents,
    paymentStatus: row.payment_status,
  }));
}
