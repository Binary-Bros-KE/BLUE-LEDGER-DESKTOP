import * as locationRepository from "@main/database/repositories/location-repository";
import * as mainStoreAllocationRepository from "@main/database/repositories/main-store-allocation-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { deriveUnallocatedQuantity } from "@main/services/main-store-service";
import type { InvoiceStockSource } from "@shared/types/sale";

/**
 * Stock source is chosen PER INVOICE LINE (client request — one invoice can mix storefront and Main
 * Store lines), stored as sale_items.stock_location_id: null = the selling storefront (today's
 * behaviour), otherwise the tenant's Main Store id. "main_store" is refused unless the admin's
 * "Invoice stock from Main Store" toggle (tenant.invoice_stock_from_main_store, applied from every
 * heartbeat) is on — the UI only offers the choice in that case; this is the enforcement. Mirrors
 * SERVER's lib/invoice-stock.ts.
 */
function requireMainStoreForInvoices(tenantId: string): string {
  if (!tenantRepository.findTenantRow()?.invoice_stock_from_main_store) {
    throw new Error("Selling invoice stock from the Main Store isn't enabled for this business");
  }
  const mainStore = locationRepository.findMainStoreLocationRow(tenantId);
  if (!mainStore) {
    throw new Error("This business has no Main Store set up");
  }
  return mainStore.id;
}

/** One stock source per line -> the stock_location_id each line stores (null = storefront). The Main
 * Store (and the admin toggle) is only checked when at least one line actually asks for it. */
export function resolveLineStockLocationIds(tenantId: string, sources: InvoiceStockSource[]): Array<string | null> {
  if (!sources.includes("main_store")) return sources.map(() => null);
  const mainStoreId = requireMainStoreForInvoices(tenantId);
  return sources.map((source) => (source === "main_store" ? mainStoreId : null));
}

/** The Main Store id when the admin toggle is on (and one exists), else null — for read-only
 * availability displays that shouldn't throw when the feature is simply off. */
export function findMainStoreIdIfEnabled(tenantId: string): string | null {
  if (!tenantRepository.findTenantRow()?.invoice_stock_from_main_store) return null;
  return locationRepository.findMainStoreLocationRow(tenantId)?.id ?? null;
}

export function stockSourceOfLocation(stockLocationId: string | null): InvoiceStockSource {
  return stockLocationId ? "main_store" : "storefront";
}

/** The two Main Store buckets an invoice line at `storefrontId` may draw from: that storefront's own
 * earmark and the unallocated pool (never another storefront's earmark). */
function mainStoreBucketsForStorefront(
  productId: string,
  mainStoreId: string,
  storefrontId: string
): { earmarked: number; unallocated: number } {
  return {
    earmarked: Math.max(0, mainStoreAllocationRepository.findAllocationRow(productId, storefrontId)?.quantity ?? 0),
    unallocated: deriveUnallocatedQuantity(productId, mainStoreId)
  };
}

/** What a Main-Store-sourced invoice line at `storefrontId` could draw of one product — earmark +
 * unallocated, the same figure deductInvoiceLineStock enforces. Backs the quotation stock check. */
export function mainStoreAvailableForStorefront(productId: string, mainStoreId: string, storefrontId: string): number {
  const { earmarked, unallocated } = mainStoreBucketsForStorefront(productId, mainStoreId, storefrontId);
  return earmarked + unallocated;
}

/**
 * Deducts one invoice line from its own stock location. Storefront (stockLocationId null): one plain
 * "sale" movement at the storefront — exactly the pre-existing behaviour. Main Store: mirrors
 * distributeMainStoreStockCore's draw order — the selling storefront's own earmark FIRST, then the
 * unallocated pool, never another storefront's earmark — one movement per bucket actually drawn from,
 * so applyValidatedStockMovement keeps the allocation breakdown in lockstep with the Main Store total.
 * Must run inside the caller's transaction.
 */
export function deductInvoiceLineStock(params: {
  tenantId: string;
  employeeId: string;
  storefrontId: string;
  stockLocationId: string | null;
  productId: string;
  quantity: number;
  saleId: string;
}): void {
  const { tenantId, employeeId, storefrontId, stockLocationId, productId, quantity, saleId } = params;
  const base = {
    productId,
    movementType: "sale" as const,
    referenceType: "invoice",
    referenceId: saleId,
    performedBy: employeeId,
    notes: null
  };

  if (!stockLocationId) {
    applyValidatedStockMovement({ ...base, locationId: storefrontId, quantityChange: -quantity }, tenantId);
    return;
  }

  const { earmarked, unallocated } = mainStoreBucketsForStorefront(productId, stockLocationId, storefrontId);
  const product = productRepository.findProductRowById(productId);
  if (earmarked + unallocated < quantity && !product?.allow_negative_stock) {
    // Checked up front (same as distributeMainStoreStockCore) so the message covers BOTH buckets —
    // otherwise the unallocated movement below would fail quoting only the unallocated figure.
    throw new Error(
      `Not enough Main Store stock for "${product?.name ?? productId}". Earmarked for this storefront: ${earmarked}, unallocated: ${unallocated}, requested: ${quantity}`
    );
  }

  const fromEarmark = Math.min(earmarked, quantity);
  const fromUnallocated = quantity - fromEarmark;
  if (fromEarmark > 0) {
    applyValidatedStockMovement(
      { ...base, locationId: stockLocationId, quantityChange: -fromEarmark, allocationStorefrontId: storefrontId },
      tenantId
    );
  }
  if (fromUnallocated > 0) {
    applyValidatedStockMovement(
      { ...base, locationId: stockLocationId, quantityChange: -fromUnallocated, allocationStorefrontId: null },
      tenantId
    );
  }
}

/**
 * Puts one invoice line's stock back where it came from (its own stock_location_id) — the reverse of
 * deductInvoiceLineStock, shared by invoice edit, cancellation, sale return and sale void. Storefront:
 * a plain "return" movement at the storefront (pre-existing behaviour). Main Store: credited back into
 * the selling storefront's own earmark, same as returnToMainStore ("still logically earmarked for
 * them, just physically back at Main Store"). Callers keep their own track_stock / is_locally_sourced
 * filter.
 */
export function restockInvoiceLineStock(params: {
  tenantId: string;
  performedBy: string;
  storefrontId: string;
  stockLocationId: string | null;
  productId: string;
  quantity: number;
  referenceType: string;
  referenceId: string;
}): void {
  const { tenantId, performedBy, storefrontId, stockLocationId, productId, quantity, referenceType, referenceId } = params;
  applyValidatedStockMovement(
    {
      productId,
      locationId: stockLocationId ?? storefrontId,
      movementType: "return",
      quantityChange: quantity,
      referenceType,
      referenceId,
      performedBy,
      notes: null,
      ...(stockLocationId ? { allocationStorefrontId: storefrontId } : {})
    },
    tenantId
  );
}
