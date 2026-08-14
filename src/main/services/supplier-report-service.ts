import * as supplierReportRepository from "@main/database/repositories/supplier-report-repository";
import { getCurrentBranchScope, requirePermission, requirePermissionAnyOf, resolveReportLocationScope } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { dateRangeInputSchema, locationScopeInputSchema } from "@shared/schemas/report";
import { supplierPurchaseHistoryInputSchema } from "@shared/schemas/supplier-report";
import type {
  OutstandingPurchaseRow,
  OutstandingPurchasesSummary,
  SupplierPurchaseHistoryEntry,
  SupplierSpendRow,
} from "@shared/types/supplier-report";

const PURCHASE_HISTORY_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

// The UTC instant for LOCAL midnight of dateStr — NOT literal "dateStr + Z" (which silently treats
// the calendar day as UTC, mis-bucketing anything in the first few hours of a local day for any
// timezone ahead of UTC). new Date(year, month, day) with no "Z"/offset is interpreted in this
// process's own local timezone, which for this offline-first single-machine app is the exact device
// the sale was rung up on.
function startOfDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toISOString();
}

function addDaysIso(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Every supplier with a qualifying purchase in the period, ranked by total purchase value — "who we
 * bought from the most," not just who's been paid so far (see getOutstandingPurchases for that). */
export function getSupplierSpendBreakdown(input: unknown): SupplierSpendRow[] {
  requirePermission("reports", "view");
  const { startDate, endDate, locationId: explicitLocationId } = dateRangeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = resolveReportLocationScope(explicitLocationId);

  const startIso = startOfDayIso(startDate);
  const endIsoExclusive = startOfDayIso(addDaysIso(endDate, 1));

  const rows = supplierReportRepository.findSupplierSpendInRange(tenantId, locationId, startIso, endIsoExclusive);
  const totalCents = rows.reduce((sum, row) => sum + row.total_spent_cents, 0);

  return rows.map((row) => ({
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    phone: row.phone,
    purchaseCount: row.purchase_count,
    totalSpentCents: row.total_spent_cents,
    percentOfTotal: totalCents > 0 ? Math.round((row.total_spent_cents / totalCents) * 1000) / 10 : 0,
  }));
}

/** Every currently-outstanding purchase — a live balance-sheet snapshot,
 * deliberately not scoped to any selected period (same reasoning as Sales
 * Report's Creditors section). */
export function getOutstandingPurchases(input: unknown): OutstandingPurchasesSummary {
  requirePermissionAnyOf([
    ["reports", "view"],
    ["purchases", "view"]
  ]);
  const { locationId: explicitLocationId } = locationScopeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = resolveReportLocationScope(explicitLocationId);

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
