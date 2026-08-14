import * as localSourcingReportRepository from "@main/database/repositories/local-sourcing-report-repository";
import { requirePermission, resolveReportLocationScope } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { dateRangeInputSchema } from "@shared/schemas/report";
import type {
  LocalSourcingReport,
  LocalSourcingSupplierTotal,
  LocalSourcingTopProductRow
} from "@shared/types/local-sourcing-report";

const TOP_LIMIT = 10;

// Same "UTC instant of LOCAL midnight" reasoning as every other report service in this app — kept
// as its own copy, not imported, matching the established one-copy-per-report-service convention
// (see product-report-service.ts's own identical pair).
function startOfDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toISOString();
}

function addDaysIso(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type NettedLine = {
  productId: string;
  productName: string;
  sku: string;
  supplierId: string | null;
  supplierName: string;
  quantity: number;
  revenueCents: number;
  costCents: number;
};

/** Nets a partially/fully-returned line's revenue AND cost proportionally to what's actually kept
 * — same reasoning as tax-report-service.ts's netLine (sale_return_items only tracks gross
 * line_total_cents, not its own cost split, so cost is scaled by the same kept fraction). A line
 * with nothing returned (the overwhelming majority) just passes its stored figures through.
 *
 * Then, same as report-service.ts's own getNetRevenueCents, scales what's left by how much of the
 * invoice has actually been PAID — a cash sale (invoice_number null) is always 100%, an invoice is
 * amountPaidCents/grandTotalCents. A locally-sourced line on a 40%-paid invoice only counts 40% of
 * its revenue and cost here; an unpaid invoice contributes nothing. */
function netLine(row: localSourcingReportRepository.LocalSourcingSaleItemRow): NettedLine {
  const returnedGross = row.returned_line_total_cents ?? 0;
  const keptGross = row.line_total_cents - returnedGross;
  const originalCostCents = row.local_cost_cents ?? 0;
  const keptCostCents =
    returnedGross > 0 && row.line_total_cents > 0
      ? Math.round(originalCostCents * (keptGross / row.line_total_cents))
      : originalCostCents;

  const fractionPaid =
    row.invoice_number === null ? 1 : row.grand_total_cents > 0 ? Math.min(1, row.amount_paid_cents / row.grand_total_cents) : 0;

  return {
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    supplierId: row.local_supplier_id,
    supplierName: row.local_supplier_name ?? "No supplier recorded",
    quantity: row.quantity - (row.returned_quantity ?? 0),
    revenueCents: Math.round(keptGross * fractionPaid),
    costCents: Math.round(keptCostCents * fractionPaid)
  };
}

function topByProduct(lines: NettedLine[]): LocalSourcingTopProductRow[] {
  const byProduct = new Map<string, LocalSourcingTopProductRow>();
  for (const line of lines) {
    const existing = byProduct.get(line.productId);
    if (existing) {
      existing.quantitySold += line.quantity;
      existing.revenueCents += line.revenueCents;
      existing.costCents += line.costCents;
      existing.netMarginCents += line.revenueCents - line.costCents;
    } else {
      byProduct.set(line.productId, {
        productId: line.productId,
        productName: line.productName,
        sku: line.sku,
        quantitySold: line.quantity,
        revenueCents: line.revenueCents,
        costCents: line.costCents,
        netMarginCents: line.revenueCents - line.costCents
      });
    }
  }
  return Array.from(byProduct.values())
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, TOP_LIMIT);
}

function bySupplier(lines: NettedLine[]): LocalSourcingSupplierTotal[] {
  const byId = new Map<string, LocalSourcingSupplierTotal>();
  for (const line of lines) {
    const key = line.supplierId ?? "__none__";
    const existing = byId.get(key);
    if (existing) {
      existing.revenueCents += line.revenueCents;
      existing.costCents += line.costCents;
      existing.netMarginCents += line.revenueCents - line.costCents;
      existing.lineCount += 1;
    } else {
      byId.set(key, {
        supplierId: line.supplierId,
        supplierName: line.supplierName,
        revenueCents: line.revenueCents,
        costCents: line.costCents,
        netMarginCents: line.revenueCents - line.costCents,
        lineCount: 1
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.revenueCents - a.revenueCents);
}

/** Revenue, cost, and net margin from sales sourced from another shop rather than this shop's own
 * stock (see sale_items.is_locally_sourced) — the report the user asked for after adding the
 * feature: "total cost, net revenue from local purchase sales, local purchases by supplier." */
export function getLocalSourcingReport(input: unknown): LocalSourcingReport {
  requirePermission("reports", "view");
  const { startDate, endDate, locationId: explicitLocationId } = dateRangeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = resolveReportLocationScope(explicitLocationId);

  const startIso = startOfDayIso(startDate);
  const endIsoExclusive = startOfDayIso(addDaysIso(endDate, 1));

  const rows = localSourcingReportRepository.findLocallySourcedSaleItemsInRange(
    tenantId,
    locationId,
    startIso,
    endIsoExclusive
  );
  const lines = rows.map(netLine);

  return {
    totalRevenueCents: lines.reduce((sum, l) => sum + l.revenueCents, 0),
    totalCostCents: lines.reduce((sum, l) => sum + l.costCents, 0),
    totalNetMarginCents: lines.reduce((sum, l) => sum + (l.revenueCents - l.costCents), 0),
    lineCount: lines.length,
    bySupplier: bySupplier(lines),
    topProducts: topByProduct(lines)
  };
}
