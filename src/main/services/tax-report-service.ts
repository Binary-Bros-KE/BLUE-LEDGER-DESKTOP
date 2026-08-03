import * as taxReportRepository from "@main/database/repositories/tax-report-repository";
import { getCurrentBranchScope, requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { dateRangeInputSchema } from "@shared/schemas/report";
import type { ProductTaxType } from "@shared/types/product";
import type { TaxCategoryTotal, TaxReport, TaxTopProductRow } from "@shared/types/tax-report";

const TOP_LIMIT = 10;

// Same "UTC instant of LOCAL midnight" reasoning as every other report service in this app (see
// product-report-service.ts's own identical pair) — deliberately not shared/imported, matching the
// established one-copy-per-report-service convention.
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
  taxType: ProductTaxType;
  quantity: number;
  netCents: number;
  taxCents: number;
  grossCents: number;
};

/** Nets a partially/fully-returned line's tax proportionally — sale_return_items only tracks
 * line_total_cents (gross), not its own tax split, so a returned line's tax contribution is scaled
 * by the same fraction of gross value that's still actually kept. A line with nothing returned (the
 * overwhelming majority) just passes through its own stored tax_amount_cents/line_total_cents
 * unchanged. */
function netLine(row: taxReportRepository.TaxSaleItemRow): NettedLine {
  const returnedGross = row.returned_line_total_cents ?? 0;
  const keptGross = row.line_total_cents - returnedGross;
  const taxType = (row.tax_type === "exempted" || row.tax_type === "zero_rated" ? row.tax_type : "vat") as ProductTaxType;
  const taxCents =
    returnedGross > 0 && row.line_total_cents > 0
      ? Math.round(row.tax_amount_cents * (keptGross / row.line_total_cents))
      : row.tax_amount_cents;

  return {
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    taxType,
    quantity: row.quantity - (row.returned_quantity ?? 0),
    netCents: keptGross - taxCents,
    taxCents,
    grossCents: keptGross
  };
}

function topByProduct(lines: NettedLine[], sortKey: "taxCents" | "grossCents"): TaxTopProductRow[] {
  const byProduct = new Map<string, TaxTopProductRow>();
  for (const line of lines) {
    const key = `${line.productId}:${line.taxType}`;
    const existing = byProduct.get(key);
    if (existing) {
      existing.quantitySold += line.quantity;
      existing.netCents += line.netCents;
      existing.taxCents += line.taxCents;
      existing.grossCents += line.grossCents;
    } else {
      byProduct.set(key, {
        productId: line.productId,
        productName: line.productName,
        sku: line.sku,
        taxType: line.taxType,
        quantitySold: line.quantity,
        netCents: line.netCents,
        taxCents: line.taxCents,
        grossCents: line.grossCents
      });
    }
  }
  return Array.from(byProduct.values())
    .sort((a, b) => b[sortKey] - a[sortKey])
    .slice(0, TOP_LIMIT);
}

/** Tax collected by category (Standard/Exempted/Zero-Rated) for one period, plus the top 10
 * products in each — the report the user explicitly asked for after noticing there was no tax
 * breakdown anywhere ("damn, we don't even have a tax breakdown"). Reused both embedded in the
 * Sales Report (under Debtors/Creditors) and as its own standalone Tax Report route. */
export function getTaxReport(input: unknown): TaxReport {
  requirePermission("reports", "view");
  const { startDate, endDate } = dateRangeInputSchema.parse(input);
  const { tenantId, vatRatePercent } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const startIso = startOfDayIso(startDate);
  const endIsoExclusive = startOfDayIso(addDaysIso(endDate, 1));

  const rows = taxReportRepository.findTaxableSaleItemsInRange(tenantId, locationId, startIso, endIsoExclusive);
  const lines = rows.map(netLine);

  const byCategoryMap = new Map<ProductTaxType, TaxCategoryTotal>();
  for (const line of lines) {
    const entry = byCategoryMap.get(line.taxType) ?? {
      taxType: line.taxType,
      netCents: 0,
      taxCents: 0,
      grossCents: 0,
      lineCount: 0
    };
    entry.netCents += line.netCents;
    entry.taxCents += line.taxCents;
    entry.grossCents += line.grossCents;
    entry.lineCount += 1;
    byCategoryMap.set(line.taxType, entry);
  }

  const categoryOrder: ProductTaxType[] = ["vat", "exempted", "zero_rated"];
  const byCategory = categoryOrder.map((t) => byCategoryMap.get(t)).filter((v): v is TaxCategoryTotal => v !== undefined);

  return {
    vatRatePercent,
    byCategory,
    totalNetCents: lines.reduce((sum, l) => sum + l.netCents, 0),
    totalTaxCents: lines.reduce((sum, l) => sum + l.taxCents, 0),
    totalGrossCents: lines.reduce((sum, l) => sum + l.grossCents, 0),
    topTaxedProducts: topByProduct(
      lines.filter((l) => l.taxType === "vat"),
      "taxCents"
    ),
    topExemptedProducts: topByProduct(
      lines.filter((l) => l.taxType === "exempted"),
      "grossCents"
    ),
    topZeroRatedProducts: topByProduct(
      lines.filter((l) => l.taxType === "zero_rated"),
      "grossCents"
    )
  };
}
