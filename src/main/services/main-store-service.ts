import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as mainStoreAllocationRepository from "@main/database/repositories/main-store-allocation-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { isStorefrontType, type LocationType } from "@shared/types/location";
import {
  mainStoreAdjustSchema,
  mainStoreDamageSchema,
  mainStoreReallocateSchema,
  mainStoreReceiveSchema,
  mainStoreTransferSchema,
  type MainStoreAdjustInput,
  type MainStoreDamageInput,
  type MainStoreReallocateInput,
  type MainStoreReceiveInput,
  type MainStoreTransferInput
} from "@shared/schemas/main-store";
import type {
  MainStoreAllocationSummary,
  MainStoreProductDetail,
  MainStoreProductRow,
  StockRequestAvailability
} from "@shared/types/main-store";

function requireMainStoreLocation(tenantId: string): locationRepository.LocationRow {
  const mainStore = locationRepository.findMainStoreLocationRow(tenantId);
  if (!mainStore) {
    throw new Error("No Main Store is set up for this business yet");
  }
  return mainStore;
}

function requireStorefront(storefrontId: string, tenantId: string): locationRepository.LocationRow {
  const row = locationRepository.findLocationRowById(storefrontId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Storefront not found");
  }
  if (!isStorefrontType(row.location_type as LocationType)) {
    throw new Error("That location isn't a storefront");
  }
  return row;
}

function buildProductDetail(tenantId: string, productId: string): MainStoreProductDetail {
  const mainStore = requireMainStoreLocation(tenantId);
  const totalAtMainStore = inventoryRepository.findInventoryRow(productId, mainStore.id)?.quantity ?? 0;
  const unallocatedQuantity = mainStoreAllocationRepository.findAllocationRow(productId, null)?.quantity ?? 0;

  const storefronts = locationRepository
    .findAllLocationRows(tenantId)
    .filter((row) => isStorefrontType(row.location_type as LocationType))
    .map((row) => ({
      storefrontId: row.id,
      storefrontName: row.location_name,
      allocatedQuantity: mainStoreAllocationRepository.findAllocationRow(productId, row.id)?.quantity ?? 0,
      onHandQuantity: inventoryRepository.findInventoryRow(productId, row.id)?.quantity ?? 0
    }));

  return { productId, unallocatedQuantity, totalAtMainStore, storefronts };
}

export function getMainStoreProductDetail(productId: string): MainStoreProductDetail {
  requirePermission("main_store", "view");
  const { tenantId } = getCurrentTenant();
  return buildProductDetail(tenantId, productId);
}

/**
 * One self-contained row per product for the Main Store list — every storefront's allocated and
 * on-hand quantity, plus the product-wide totalStock/hasLowStock figures (see MainStoreProductRow's
 * own doc comment). Built from a handful of bulk queries (not one per product) so the whole catalog
 * loads in a single round trip.
 */
export function listMainStoreProductRows(): MainStoreProductRow[] {
  requirePermission("main_store", "view");
  const { tenantId } = getCurrentTenant();

  const products = productRepository.findAllProductRows(tenantId, null).map(productRepository.mapProductListRow);
  const storefrontLocations = locationRepository
    .findAllLocationRows(tenantId)
    .filter((row) => isStorefrontType(row.location_type as LocationType));

  const allocationRows = mainStoreAllocationRepository.findAllAllocationRows(tenantId);
  const allocationByProduct = new Map<string, Map<string | null, number>>();
  for (const row of allocationRows) {
    const byBucket = allocationByProduct.get(row.product_id) ?? new Map<string | null, number>();
    byBucket.set(row.storefront_id, row.quantity);
    allocationByProduct.set(row.product_id, byBucket);
  }

  const onHandRows = inventoryRepository.findAllInventoryRowsForStorefronts(tenantId);
  const onHandByProduct = new Map<string, Map<string, number>>();
  for (const row of onHandRows) {
    const byStorefront = onHandByProduct.get(row.product_id) ?? new Map<string, number>();
    byStorefront.set(row.location_id, row.quantity);
    onHandByProduct.set(row.product_id, byStorefront);
  }

  return products.map((product) => {
    const buckets = allocationByProduct.get(product.id);
    const onHandForProduct = onHandByProduct.get(product.id);
    const unallocatedQuantity = buckets?.get(null) ?? 0;

    let totalAtMainStore = unallocatedQuantity;
    let onHandAcrossStorefronts = 0;

    const storefronts = storefrontLocations.map((location) => {
      const allocatedQuantity = buckets?.get(location.id) ?? 0;
      totalAtMainStore += allocatedQuantity;
      const onHandQuantity = onHandForProduct?.get(location.id) ?? 0;
      onHandAcrossStorefronts += onHandQuantity;
      // Still a per-storefront signal on purpose (this storefront's own shelf is running low),
      // distinct from the product-wide hasLowStock below — kept exactly as it already was.
      const isLow = product.reorderLevel > 0 && onHandQuantity < product.reorderLevel;
      return {
        storefrontId: location.id,
        storefrontName: location.location_name,
        allocatedQuantity,
        onHandQuantity,
        isLow
      };
    });

    // The true grand total across every location — mirrors ProductsRoute.tsx's own
    // totalStock<=reorderLevel convention exactly, inclusive comparison, no reorderLevel>0 guard
    // (a product with reorderLevel 0 is still correctly flagged once its total hits zero).
    const totalStock = totalAtMainStore + onHandAcrossStorefronts;
    const hasLowStock = totalStock <= product.reorderLevel;

    return {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      categoryName: product.categoryName,
      storefrontTagId: product.storefrontId,
      status: product.status,
      reorderLevel: product.reorderLevel,
      imagePath: product.imagePath,
      unallocatedQuantity,
      totalAtMainStore,
      storefronts,
      totalStock,
      hasLowStock
    };
  });
}

/** Every product's allocation breakdown at once — powers the Main Store list's columns without a
 * round-trip per row. */
export function getMainStoreAllocationSummary(): MainStoreAllocationSummary[] {
  requirePermission("main_store", "view");
  const { tenantId } = getCurrentTenant();
  const rows = mainStoreAllocationRepository.findAllAllocationRows(tenantId);

  const byProduct = new Map<string, MainStoreAllocationSummary>();
  for (const row of rows) {
    const entry = byProduct.get(row.product_id) ?? {
      productId: row.product_id,
      unallocatedQuantity: 0,
      allocatedByStorefront: {}
    };
    if (row.storefront_id === null) {
      entry.unallocatedQuantity = row.quantity;
    } else {
      entry.allocatedByStorefront[row.storefront_id] = row.quantity;
    }
    byProduct.set(row.product_id, entry);
  }

  return Array.from(byProduct.values());
}

/**
 * Powers the "Available at Main Store" hint on the New Stock Request form — permission-gated by
 * "stock_requests":"create" (NOT "main_store":"view", which Cashier/Manager deliberately never get)
 * precisely so it can be shown to the same requesters who fill out that form. Resolves the target
 * storefront the exact same way createStockRequest itself does: a branch-scoped caller's own session
 * branch always wins over whatever storefrontId was passed in (never trusted from the client for
 * them); a branch-less caller (Storekeeper/Super Admin picking a storefront) must supply one
 * explicitly. Returns an empty list rather than throwing when no storefront can be resolved yet —
 * this is a read that renders before the form is fully filled in, not a submission.
 */
export function getMainStoreAvailabilityForStockRequest(storefrontId: string | null): StockRequestAvailability[] {
  requirePermission("stock_requests", "create");
  const { tenantId } = getCurrentTenant();
  const branchScope = getCurrentBranchScope();
  const target = branchScope ?? storefrontId;
  if (!target) return [];

  const location = locationRepository.findLocationRowById(target);
  if (!location || location.tenant_id !== tenantId || !isStorefrontType(location.location_type as LocationType)) {
    return [];
  }

  const rows = mainStoreAllocationRepository.findAllAllocationRows(tenantId);
  const byProduct = new Map<string, StockRequestAvailability>();
  for (const row of rows) {
    if (row.storefront_id !== null && row.storefront_id !== target) continue;
    const entry = byProduct.get(row.product_id) ?? { productId: row.product_id, availableQuantity: 0 };
    entry.availableQuantity += row.quantity;
    byProduct.set(row.product_id, entry);
  }
  return Array.from(byProduct.values());
}

/** Records new physical stock arriving at Main Store, earmarked for a storefront (or left unallocated). */
export function receiveMainStoreStock(input: unknown): MainStoreProductDetail {
  requirePermission("main_store", "edit");
  const parsed: MainStoreReceiveInput = mainStoreReceiveSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  const mainStore = requireMainStoreLocation(tenantId);
  if (parsed.storefrontId) requireStorefront(parsed.storefrontId, tenantId);

  runInTransaction(() => {
    applyValidatedStockMovement(
      {
        productId: parsed.productId,
        locationId: mainStore.id,
        movementType: "purchase",
        quantityChange: parsed.quantity,
        referenceType: "main_store_receipt",
        referenceId: null,
        performedBy: employeeId,
        notes: parsed.notes,
        allocationStorefrontId: parsed.storefrontId
      },
      tenantId
    );
  });

  return buildProductDetail(tenantId, parsed.productId);
}

/**
 * Core of shipping stock from Main Store to a storefront — drains that storefront's own earmarked
 * allocation FIRST, then tops up the remainder from the unallocated bucket if the earmark alone isn't
 * enough (never from a DIFFERENT storefront's allocation). A genuine split, not an all-or-nothing pick
 * between the two buckets — 5 earmarked + 50 unallocated, distributing 10, draws 5 from the earmark and
 * only the remaining 5 from unallocated (previously this picked whichever SINGLE bucket could cover the
 * whole 10 on its own, which meant a partially-earmarked storefront's own earmark was skipped entirely
 * and left untouched — caught live against exactly that 5/50/10 scenario). Deliberately NOT wrapped in
 * its own transaction and NOT permission-checked, so callers that need to fulfil several products
 * atomically under one already-checked permission (e.g. approving a multi-item stock request, or a
 * whole Goods Received transfer batch) can loop this inside a single `runInTransaction`.
 * `distributeFromMainStore` below is the normal single-product, permission-checked, self-transacted
 * entry point most callers should use instead.
 */
export function distributeMainStoreStockCore(params: {
  tenantId: string;
  employeeId: string | null;
  productId: string;
  storefrontId: string;
  quantity: number;
  notes: string | null;
  referenceType: string;
  referenceId: string;
}): void {
  const mainStore = requireMainStoreLocation(params.tenantId);
  requireStorefront(params.storefrontId, params.tenantId);

  const allocatedQuantity =
    mainStoreAllocationRepository.findAllocationRow(params.productId, params.storefrontId)?.quantity ?? 0;
  const unallocatedQuantity = mainStoreAllocationRepository.findAllocationRow(params.productId, null)?.quantity ?? 0;

  if (allocatedQuantity + unallocatedQuantity < params.quantity) {
    throw new Error(
      `Not enough stock to distribute ${params.quantity}. Earmarked for this storefront: ${allocatedQuantity}, unallocated: ${unallocatedQuantity}.`
    );
  }

  const fromAllocated = Math.min(allocatedQuantity, params.quantity);
  const fromUnallocated = params.quantity - fromAllocated;

  // Two separate transfer_out movements (one per bucket actually drawn from) rather than one for the
  // combined quantity — each needs its own allocationStorefrontId so the ledger correctly shows which
  // bucket lost how much, and applyValidatedStockMovement validates/applies against exactly the bucket
  // it's given.
  if (fromAllocated > 0) {
    applyValidatedStockMovement(
      {
        productId: params.productId,
        locationId: mainStore.id,
        movementType: "transfer_out",
        quantityChange: -fromAllocated,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        performedBy: params.employeeId,
        notes: params.notes,
        allocationStorefrontId: params.storefrontId
      },
      params.tenantId
    );
  }
  if (fromUnallocated > 0) {
    applyValidatedStockMovement(
      {
        productId: params.productId,
        locationId: mainStore.id,
        movementType: "transfer_out",
        quantityChange: -fromUnallocated,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        performedBy: params.employeeId,
        notes: params.notes,
        allocationStorefrontId: null
      },
      params.tenantId
    );
  }
  applyValidatedStockMovement(
    {
      productId: params.productId,
      locationId: params.storefrontId,
      movementType: "transfer_in",
      quantityChange: params.quantity,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      performedBy: params.employeeId,
      notes: params.notes
    },
    params.tenantId
  );
}

/**
 * Ships stock from Main Store to a storefront. Drains that storefront's own earmarked allocation
 * first, then tops up any remainder from the unallocated bucket — it never draws from a DIFFERENT
 * storefront's allocation, so one branch's incoming stock can never silently end up at another.
 */
export function distributeFromMainStore(input: unknown): MainStoreProductDetail {
  requirePermission("stock_transfers", "create");
  const parsed: MainStoreTransferInput = mainStoreTransferSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  const transferId = `transfer_${randomUUID()}`;

  runInTransaction(() => {
    distributeMainStoreStockCore({
      tenantId,
      employeeId,
      productId: parsed.productId,
      storefrontId: parsed.storefrontId,
      quantity: parsed.quantity,
      notes: parsed.notes,
      referenceType: "main_store_distribution",
      referenceId: transferId
    });
  });

  return buildProductDetail(tenantId, parsed.productId);
}

/** Returns stock from a storefront back to Main Store — credited back into that same storefront's
 * own allocation, since it's still logically earmarked for them, just physically back at Main Store. */
export function returnToMainStore(input: unknown): MainStoreProductDetail {
  requirePermission("stock_transfers", "create");
  const parsed: MainStoreTransferInput = mainStoreTransferSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  const mainStore = requireMainStoreLocation(tenantId);
  requireStorefront(parsed.storefrontId, tenantId);

  const transferId = `transfer_${randomUUID()}`;

  runInTransaction(() => {
    applyValidatedStockMovement(
      {
        productId: parsed.productId,
        locationId: parsed.storefrontId,
        movementType: "transfer_out",
        quantityChange: -parsed.quantity,
        referenceType: "main_store_return",
        referenceId: transferId,
        performedBy: employeeId,
        notes: parsed.notes
      },
      tenantId
    );
    applyValidatedStockMovement(
      {
        productId: parsed.productId,
        locationId: mainStore.id,
        movementType: "transfer_in",
        quantityChange: parsed.quantity,
        referenceType: "main_store_return",
        referenceId: transferId,
        performedBy: employeeId,
        notes: parsed.notes,
        allocationStorefrontId: parsed.storefrontId
      },
      tenantId
    );
  });

  return buildProductDetail(tenantId, parsed.productId);
}

/** Records damaged/lost stock at Main Store, reducing a specific bucket (unallocated or a storefront's
 * own earmarked allocation) rather than the general total, so a loss earmarked for one storefront is
 * never silently absorbed from another's. */
export function recordMainStoreDamage(input: unknown): MainStoreProductDetail {
  requirePermission("main_store", "edit");
  const parsed: MainStoreDamageInput = mainStoreDamageSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  const mainStore = requireMainStoreLocation(tenantId);
  if (parsed.storefrontId) requireStorefront(parsed.storefrontId, tenantId);

  runInTransaction(() => {
    applyValidatedStockMovement(
      {
        productId: parsed.productId,
        locationId: mainStore.id,
        movementType: "damage",
        quantityChange: -parsed.quantity,
        referenceType: "main_store_damage",
        referenceId: null,
        performedBy: employeeId,
        notes: parsed.notes,
        allocationStorefrontId: parsed.storefrontId
      },
      tenantId
    );
  });

  return buildProductDetail(tenantId, parsed.productId);
}

/** Corrects a bucket's stock to match a physical count — e.g. a shelf count turns up 42 units but
 * the system shows 47, so this records a -5 adjustment. The delta is computed here, against the
 * SAME bucket-quantity read the rest of this transaction uses, rather than trusting a delta the
 * renderer computed against a possibly-stale on-screen number. A count that already matches current
 * stock is a no-op, not an error — nothing to record. */
export function recordMainStoreAdjustment(input: unknown): MainStoreProductDetail {
  requirePermission("main_store", "edit");
  const parsed: MainStoreAdjustInput = mainStoreAdjustSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  const mainStore = requireMainStoreLocation(tenantId);
  if (parsed.storefrontId) requireStorefront(parsed.storefrontId, tenantId);

  runInTransaction(() => {
    const currentQuantity =
      mainStoreAllocationRepository.findAllocationRow(parsed.productId, parsed.storefrontId)?.quantity ?? 0;
    const delta = parsed.countedQuantity - currentQuantity;
    if (delta === 0) return;

    applyValidatedStockMovement(
      {
        productId: parsed.productId,
        locationId: mainStore.id,
        movementType: "adjustment",
        quantityChange: delta,
        referenceType: "main_store_adjustment",
        referenceId: null,
        performedBy: employeeId,
        notes: parsed.notes,
        allocationStorefrontId: parsed.storefrontId
      },
      tenantId
    );
  });

  return buildProductDetail(tenantId, parsed.productId);
}

/** Bookkeeping-only move between two Main Store buckets — nothing physically relocates, so no stock
 * movement is recorded and the plain inventory total at Main Store is untouched. */
export function reallocateMainStoreStock(input: unknown): MainStoreProductDetail {
  requirePermission("main_store", "edit");
  const parsed: MainStoreReallocateInput = mainStoreReallocateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  requireMainStoreLocation(tenantId);
  if (parsed.fromStorefrontId) requireStorefront(parsed.fromStorefrontId, tenantId);
  if (parsed.toStorefrontId) requireStorefront(parsed.toStorefrontId, tenantId);

  runInTransaction(() => {
    mainStoreAllocationRepository.adjustAllocationQuantity({
      tenantId,
      productId: parsed.productId,
      storefrontId: parsed.fromStorefrontId,
      delta: -parsed.quantity
    });
    mainStoreAllocationRepository.adjustAllocationQuantity({
      tenantId,
      productId: parsed.productId,
      storefrontId: parsed.toStorefrontId,
      delta: parsed.quantity
    });
  });

  return buildProductDetail(tenantId, parsed.productId);
}
