import * as productReportRepository from "@main/database/repositories/product-report-repository";
import { getCurrentBranchScope, requirePermission, resolveReportLocationScope } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { productSalesHistoryInputSchema, productsPerformanceInputSchema } from "@shared/schemas/product-report";
import type {
  ProductPerformanceRow,
  ProductSalesHistoryEntry,
  ProductsPerformanceReport,
  SlowMovingProductRow,
} from "@shared/types/product-report";
import type { SalesTransactionKind } from "@shared/types/report";

const SLOW_MOVING_LIMIT = 20;
const SALES_HISTORY_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

// The UTC instant for LOCAL midnight of dateStr — NOT literal "dateStr + Z" (which silently treats
// the calendar day as UTC, mis-bucketing anything sold in the first few hours of a local day for
// any timezone ahead of UTC). new Date(year, month, day) with no "Z"/offset is interpreted in this
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

/** Best Selling (top by units moved in the period) and Slow Moving (worst
 * performers — fewest units sold, longest idle, including products with
 * zero sales in the period entirely) for one resolved date range. */
export function getProductsPerformanceReport(input: unknown): ProductsPerformanceReport {
  requirePermission("reports", "view");
  const { startDate, endDate, slowMovingLimit, locationId: explicitLocationId } = productsPerformanceInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = resolveReportLocationScope(explicitLocationId);

  const startIso = startOfDayIso(startDate);
  const endIsoExclusive = startOfDayIso(addDaysIso(endDate, 1));

  const salesRows = productReportRepository.findProductSalesAggregateInRange(tenantId, locationId, startIso, endIsoExclusive);

  // Every product that sold at all in the period, sorted by units moved — not truncated here,
  // since the UI lets the reader re-sort by revenue or profit and a fixed top-20-by-quantity
  // cut would silently drop a low-volume, high-value product from those other views.
  const bestSelling: ProductPerformanceRow[] = salesRows
    .map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      sku: row.sku,
      categoryName: row.category_name,
      quantitySold: row.quantity_sold,
      revenueCents: row.revenue_cents,
      costCents: row.cost_cents,
      profitCents: row.revenue_cents - row.cost_cents,
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold);

  const salesByProduct = new Map<string, { quantitySold: number; revenueCents: number }>();
  for (const row of salesRows) {
    salesByProduct.set(row.product_id, { quantitySold: row.quantity_sold, revenueCents: row.revenue_cents });
  }

  const allProducts = productReportRepository.findAllActiveProductsForReport(tenantId);
  const lastSoldRows = productReportRepository.findLastSoldAtByProduct(tenantId, locationId);
  const lastSoldByProduct = new Map(lastSoldRows.map((row) => [row.product_id, row.last_sold_at]));
  const now = Date.now();

  const slowMoving: SlowMovingProductRow[] = allProducts
    .map((product) => {
      const sales = salesByProduct.get(product.product_id);
      const lastSoldAt = lastSoldByProduct.get(product.product_id) ?? null;
      const daysSinceLastSale = lastSoldAt !== null ? Math.floor((now - new Date(lastSoldAt).getTime()) / DAY_MS) : null;
      return {
        productId: product.product_id,
        productName: product.product_name,
        sku: product.sku,
        categoryName: product.category_name,
        quantitySoldInPeriod: sales?.quantitySold ?? 0,
        revenueCentsInPeriod: sales?.revenueCents ?? 0,
        lastSoldAt,
        daysSinceLastSale,
      };
    })
    .sort((a, b) => {
      if (a.quantitySoldInPeriod !== b.quantitySoldInPeriod) return a.quantitySoldInPeriod - b.quantitySoldInPeriod;
      return (b.daysSinceLastSale ?? Number.MAX_SAFE_INTEGER) - (a.daysSinceLastSale ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, slowMovingLimit ?? SLOW_MOVING_LIMIT);

  return { bestSelling, slowMoving };
}

/** Every individual sale of one product, newest first — not scoped to any
 * period, since a "history" is inherently the whole story, not a slice of it. */
export function getProductSalesHistory(input: unknown): ProductSalesHistoryEntry[] {
  requirePermission("reports", "view");
  const { productId } = productSalesHistoryInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const rows = productReportRepository.findProductSalesHistory(tenantId, locationId, productId, SALES_HISTORY_LIMIT);

  return rows.map((row) => ({
    saleItemId: row.sale_item_id,
    occurredAt: row.completed_at,
    documentNumber: row.document_number,
    kind: row.transaction_type as SalesTransactionKind,
    locationName: row.location_name,
    customerName: row.customer_name,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    lineTotalCents: row.line_total_cents,
  }));
}
