import * as inventoryReportRepository from "@main/database/repositories/inventory-report-repository";
import type { CurrentStockRow, StockMovementReportRowRaw } from "@main/database/repositories/inventory-report-repository";
import { requirePermissionAnyOf, resolveReportLocationScope } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { locationScopeInputSchema, stockAsOfDateInputSchema } from "@shared/schemas/report";
import type {
  InventoryOverviewStats,
  InventoryReportData,
  LocationInventorySection,
  LocationProductRow,
  MainStoreAllocationInfo,
  StockAsOfDateData,
  StockMovementReportRow,
  StockValueBreakdownEntry,
} from "@shared/types/inventory-report";

const MOVEMENT_LIMIT_PER_SECTION = 50;

function isMainStoreType(locationType: string): boolean {
  return locationType === "warehouse" || locationType === "distribution_center";
}

function toBreakdownEntries(
  rows: { id: string; name: string; quantity: number; valueCents: number }[],
  totalCents: number
): StockValueBreakdownEntry[] {
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      quantity: row.quantity,
      valueCents: row.valueCents,
      percentOfTotal: totalCents > 0 ? Math.round((row.valueCents / totalCents) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.valueCents - a.valueCents);
}

function toMovementRow(row: StockMovementReportRowRaw): StockMovementReportRow {
  return {
    id: row.id,
    productName: row.product_name,
    sku: row.sku,
    locationName: row.location_name,
    movementType: row.movement_type,
    quantityChange: row.quantity_change,
    valueCents: Math.abs(row.quantity_change) * row.buying_price_cents,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    performedByName: row.performed_by_name,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

/**
 * The whole Inventory report in one call: a cross-location overview, a
 * cross-location stock-value-by-category breakdown, and one self-contained
 * section per location (Main Store first if the tenant uses one, then each
 * storefront). Every number here already respects branch scope — a
 * branch-scoped manager's `rows` only ever contains their own location, so
 * they naturally get exactly one section back with no extra filtering logic.
 */
export function getInventoryReportData(input: unknown): InventoryReportData {
  requirePermissionAnyOf([
    ["reports", "view"],
    ["inventory", "view"]
  ]);
  const { locationId: explicitLocationId } = locationScopeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = resolveReportLocationScope(explicitLocationId);

  const rows = inventoryReportRepository.findCurrentStockRows(tenantId, locationId);

  // Per product, total quantity across every NON-Main-Store location — the "qty in the
  // field" reference point shown only on the Main Store section's rows.
  const storefrontTotalsByProduct = new Map<string, number>();
  // Per product, Main Store's own physical quantity — the reference point shown on
  // every storefront section's rows (only meaningful if the tenant has a Main Store).
  const mainStoreQtyByProduct = new Map<string, number>();
  for (const row of rows) {
    if (isMainStoreType(row.location_type)) {
      mainStoreQtyByProduct.set(row.product_id, (mainStoreQtyByProduct.get(row.product_id) ?? 0) + row.quantity);
    } else {
      storefrontTotalsByProduct.set(row.product_id, (storefrontTotalsByProduct.get(row.product_id) ?? 0) + row.quantity);
    }
  }

  // Seed a bucket for every active location in scope first — a storefront that's been
  // allocated stock at Main Store but never actually had anything distributed to it has
  // zero rows in `rows`, and would otherwise silently vanish instead of showing as empty.
  const activeLocations = inventoryReportRepository.findActiveLocations(tenantId, locationId);
  const locationBuckets = new Map<string, { name: string; isMainStore: boolean; rows: CurrentStockRow[] }>();
  for (const loc of activeLocations) {
    locationBuckets.set(loc.id, { name: loc.location_name, isMainStore: isMainStoreType(loc.location_type), rows: [] });
  }
  for (const row of rows) {
    const bucket = locationBuckets.get(row.location_id);
    if (bucket) bucket.rows.push(row);
  }

  const mainStoreLocationId = activeLocations.find((loc) => isMainStoreType(loc.location_type))?.id ?? null;
  const hasMainStore = mainStoreLocationId !== null;
  const allocationByStorefront = hasMainStore ? inventoryReportRepository.findMainStoreAllocationsByStorefront(tenantId) : [];
  const unallocatedQuantity = hasMainStore
    ? inventoryReportRepository.findMainStoreUnallocatedQuantity(tenantId, mainStoreLocationId as string)
    : 0;

  // Per (product, storefront), how much Main Store has earmarked specifically for that
  // storefront — not yet physically distributed, so it lives alongside (not inside) `rows`.
  const allocationByProductRows = hasMainStore ? inventoryReportRepository.findMainStoreAllocationsByProduct(tenantId) : [];
  const allocationByProductAndStorefront = new Map<string, number>();
  for (const row of allocationByProductRows) {
    allocationByProductAndStorefront.set(`${row.product_id}:${row.storefront_id}`, row.quantity);
  }

  const sections: LocationInventorySection[] = [...locationBuckets.entries()]
    .map(([locId, bucket]) => {
      let ownStockValueCents = 0;

      const products: LocationProductRow[] = bucket.rows.map((row) => {
        const isLow = row.reorder_level > 0 && row.quantity < row.reorder_level;
        const isOutOfStock = row.quantity <= 0;
        const ownValueCents = row.quantity * row.buying_price_cents;
        ownStockValueCents += ownValueCents;

        let storefrontTotalQuantity: number | null = null;
        let storefrontIsLow: boolean | null = null;
        let storefrontIsOutOfStock: boolean | null = null;
        let mainStoreQuantity: number | null = null;
        let allocatedToThisStorefront: number | null = null;
        let displayValueCents = ownValueCents;

        if (bucket.isMainStore) {
          const total = storefrontTotalsByProduct.get(row.product_id) ?? 0;
          storefrontTotalQuantity = total;
          storefrontIsLow = row.reorder_level > 0 && total < row.reorder_level;
          storefrontIsOutOfStock = total <= 0;
        } else if (hasMainStore) {
          mainStoreQuantity = mainStoreQtyByProduct.get(row.product_id) ?? 0;
          allocatedToThisStorefront = allocationByProductAndStorefront.get(`${row.product_id}:${locId}`) ?? 0;
          // "Value" here deliberately combines this storefront's own stock with Main
          // Store's own stock of the same product — the two locations relevant to this
          // storefront's view — not just this storefront's isolated stock value.
          displayValueCents = (row.quantity + mainStoreQuantity) * row.buying_price_cents;
        }

        return {
          productId: row.product_id,
          productName: row.product_name,
          sku: row.sku,
          categoryName: row.category_name,
          quantity: row.quantity,
          isLow,
          isOutOfStock,
          storefrontTotalQuantity,
          storefrontIsLow,
          storefrontIsOutOfStock,
          mainStoreQuantity,
          allocatedToThisStorefront,
          buyingPriceCents: row.buying_price_cents,
          valueCents: displayValueCents,
          percentOfLocationValue: 0,
        };
      });

      // Percentages are relative to this section's own displayed-value total (so they sum
      // to 100% within the table) — not the headline "Stock Value" tile below, which stays
      // this location's own physical stock only, even for a storefront section.
      const displayedValueTotal = products.reduce((sum, product) => sum + product.valueCents, 0);
      for (const product of products) {
        product.percentOfLocationValue = displayedValueTotal > 0 ? Math.round((product.valueCents / displayedValueTotal) * 1000) / 10 : 0;
      }
      products.sort((a, b) => a.productName.localeCompare(b.productName));

      const stockValueCents = ownStockValueCents;

      const movementRows = inventoryReportRepository.findStockMovementReportRows(tenantId, locId, MOVEMENT_LIMIT_PER_SECTION);

      const allocation: MainStoreAllocationInfo | null = bucket.isMainStore
        ? {
            totalAllocated: allocationByStorefront.reduce((sum, row) => sum + row.allocated_quantity, 0),
            totalUnallocated: unallocatedQuantity,
            byStorefront: allocationByStorefront.map((row) => ({
              storefrontId: row.storefront_id,
              storefrontName: row.storefront_name,
              allocatedQuantity: row.allocated_quantity,
            })),
          }
        : null;

      return {
        locationId: locId,
        locationName: bucket.name,
        isMainStore: bucket.isMainStore,
        productCount: products.length,
        totalUnits: products.reduce((sum, product) => sum + product.quantity, 0),
        lowStockCount: products.filter((product) => product.isLow).length,
        outOfStockCount: products.filter((product) => product.isOutOfStock).length,
        stockValueCents,
        products,
        movements: movementRows.map(toMovementRow),
        allocation,
      };
    })
    .sort((a, b) => {
      if (a.isMainStore !== b.isMainStore) return a.isMainStore ? -1 : 1;
      return a.locationName.localeCompare(b.locationName);
    });

  const lowProductIds = new Set<string>();
  const outProductIds = new Set<string>();
  for (const row of rows) {
    if (row.reorder_level > 0 && row.quantity < row.reorder_level) lowProductIds.add(row.product_id);
    if (row.quantity <= 0) outProductIds.add(row.product_id);
  }
  const totalStockValueCents = rows.reduce((sum, row) => sum + row.quantity * row.buying_price_cents, 0);

  const overview: InventoryOverviewStats = {
    distinctProductCount: new Set(rows.map((row) => row.product_id)).size,
    totalUnits: rows.reduce((sum, row) => sum + row.quantity, 0),
    lowStockProductCount: lowProductIds.size,
    outOfStockProductCount: outProductIds.size,
    totalStockValueCents,
  };

  const categoryMap = new Map<string, { id: string; name: string; quantity: number; valueCents: number }>();
  for (const row of rows) {
    const key = row.category_name ?? "Uncategorized";
    const bucket = categoryMap.get(key) ?? { id: key, name: key, quantity: 0, valueCents: 0 };
    bucket.quantity += row.quantity;
    bucket.valueCents += row.quantity * row.buying_price_cents;
    categoryMap.set(key, bucket);
  }

  return {
    overview,
    categoryValueBreakdown: toBreakdownEntries([...categoryMap.values()], totalStockValueCents),
    sections,
  };
}

// Same device-local-timezone-correct date math as inventory-service.ts's own startOfDayIso/
// addDaysIso (that pair is itself ported from report-service.ts) — small enough, and used
// differently enough here (one exclusive boundary, not a start/end pair), that a shared export
// isn't worth the coupling; every date-range report in this app keeps its own private copy.
function startOfDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toISOString();
}

function addDaysIso(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Every product's ending balance as of a chosen date (today or any day in the past) — "what was on
 * hand at close of business that day." Computed backward from the CURRENT `inventory` total (see
 * findStockAsOfDateRows) rather than replaying forward from zero: stock_movements is append-only
 * and the current total is always correct, so subtracting only the movements between the requested
 * date and now is both simpler and far cheaper than summing a product's entire history every time —
 * usually a small slice of the ledger even for a "last month" query. No new tracking of any kind;
 * this works retroactively for dates from before this report existed.
 */
export function getStockAsOfDateReport(input: unknown): StockAsOfDateData {
  requirePermissionAnyOf([
    ["reports", "view"],
    ["inventory", "view"]
  ]);
  const parsed = stockAsOfDateInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = resolveReportLocationScope(parsed.locationId);

  // Everything from the START of the day AFTER the requested date gets subtracted back out of the
  // current total — that's precisely "undo every movement since the end of the requested day."
  const sinceIsoExclusive = startOfDayIso(addDaysIso(parsed.date, 1));

  const flatRows = inventoryReportRepository.findStockAsOfDateRows(tenantId, locationId, sinceIsoExclusive);

  // Every active location in scope becomes a column — seeded up front (same "show every location
  // even at zero" convention as the live report's own sections) so a product that never moved at a
  // given location still shows 0 there instead of the column silently being absent for that row.
  const activeLocations = inventoryReportRepository.findActiveLocations(tenantId, locationId);
  const locationOrder = activeLocations.map((loc) => ({ id: loc.id, name: loc.location_name }));

  const productMap = new Map<
    string,
    { productId: string; productName: string; sku: string; categoryName: string | null; quantityByLocation: Record<string, number> }
  >();
  for (const row of flatRows) {
    let product = productMap.get(row.product_id);
    if (!product) {
      product = {
        productId: row.product_id,
        productName: row.product_name,
        sku: row.sku,
        categoryName: row.category_name,
        quantityByLocation: Object.fromEntries(locationOrder.map((loc) => [loc.id, 0])),
      };
      productMap.set(row.product_id, product);
    }
    product.quantityByLocation[row.location_id] = row.quantity;
  }

  const rows = [...productMap.values()]
    .map((product) => ({
      ...product,
      totalQuantity: Object.values(product.quantityByLocation).reduce((sum, qty) => sum + qty, 0),
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  return {
    asOfDate: parsed.date,
    locations: locationOrder,
    rows,
  };
}
