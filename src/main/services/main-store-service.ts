import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as mainStoreAllocationRepository from "@main/database/repositories/main-store-allocation-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import { getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { isStorefrontType, type LocationType } from "@shared/types/location";
import {
  mainStoreDamageSchema,
  mainStoreReallocateSchema,
  mainStoreReceiveSchema,
  mainStoreTransferSchema,
  type MainStoreDamageInput,
  type MainStoreReallocateInput,
  type MainStoreReceiveInput,
  type MainStoreTransferInput
} from "@shared/schemas/main-store";
import type {
  MainStoreAllocationSummary,
  MainStoreProductDetail,
  MainStoreProductRow
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
  requirePermission("inventory", "view");
  const { tenantId } = getCurrentTenant();
  return buildProductDetail(tenantId, productId);
}

/**
 * One self-contained row per product for the Main Store list — every storefront's allocated and
 * on-hand quantity, with low-stock flagged right on the storefront's own shelf figure. Built from a
 * handful of bulk queries (not one per product) so the whole catalog loads in a single round trip.
 */
export function listMainStoreProductRows(): MainStoreProductRow[] {
  requirePermission("inventory", "view");
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
    let hasLowStock = false;

    const storefronts = storefrontLocations.map((location) => {
      const allocatedQuantity = buckets?.get(location.id) ?? 0;
      totalAtMainStore += allocatedQuantity;
      const onHandQuantity = onHandForProduct?.get(location.id) ?? 0;
      const isLow = product.reorderLevel > 0 && onHandQuantity < product.reorderLevel;
      if (isLow) hasLowStock = true;
      return {
        storefrontId: location.id,
        storefrontName: location.location_name,
        allocatedQuantity,
        onHandQuantity,
        isLow
      };
    });

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
      hasLowStock
    };
  });
}

/** Every product's allocation breakdown at once — powers the Main Store list's columns without a
 * round-trip per row. */
export function getMainStoreAllocationSummary(): MainStoreAllocationSummary[] {
  requirePermission("inventory", "view");
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

/** Records new physical stock arriving at Main Store, earmarked for a storefront (or left unallocated). */
export function receiveMainStoreStock(input: unknown): MainStoreProductDetail {
  requirePermission("inventory", "edit");
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
 * Ships stock from Main Store to a storefront. Draws from that storefront's own earmarked allocation
 * first; only dips into the unallocated bucket if the storefront doesn't have enough already earmarked
 * — it never draws from a DIFFERENT storefront's allocation, so one branch's incoming stock can never
 * silently end up at another.
 */
export function distributeFromMainStore(input: unknown): MainStoreProductDetail {
  requirePermission("stock_transfers", "create");
  const parsed: MainStoreTransferInput = mainStoreTransferSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  const mainStore = requireMainStoreLocation(tenantId);
  requireStorefront(parsed.storefrontId, tenantId);

  const allocatedQuantity =
    mainStoreAllocationRepository.findAllocationRow(parsed.productId, parsed.storefrontId)?.quantity ?? 0;
  const unallocatedQuantity = mainStoreAllocationRepository.findAllocationRow(parsed.productId, null)?.quantity ?? 0;

  let sourceBucket: string | null;
  if (allocatedQuantity >= parsed.quantity) {
    sourceBucket = parsed.storefrontId;
  } else if (unallocatedQuantity >= parsed.quantity) {
    sourceBucket = null;
  } else {
    throw new Error(
      `Not enough stock to distribute ${parsed.quantity}. Earmarked for this storefront: ${allocatedQuantity}, unallocated: ${unallocatedQuantity}.`
    );
  }

  const transferId = `transfer_${randomUUID()}`;

  runInTransaction(() => {
    applyValidatedStockMovement(
      {
        productId: parsed.productId,
        locationId: mainStore.id,
        movementType: "transfer_out",
        quantityChange: -parsed.quantity,
        referenceType: "main_store_distribution",
        referenceId: transferId,
        performedBy: employeeId,
        notes: parsed.notes,
        allocationStorefrontId: sourceBucket
      },
      tenantId
    );
    applyValidatedStockMovement(
      {
        productId: parsed.productId,
        locationId: parsed.storefrontId,
        movementType: "transfer_in",
        quantityChange: parsed.quantity,
        referenceType: "main_store_distribution",
        referenceId: transferId,
        performedBy: employeeId,
        notes: parsed.notes
      },
      tenantId
    );
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
  requirePermission("inventory", "edit");
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

/** Bookkeeping-only move between two Main Store buckets — nothing physically relocates, so no stock
 * movement is recorded and the plain inventory total at Main Store is untouched. */
export function reallocateMainStoreStock(input: unknown): MainStoreProductDetail {
  requirePermission("inventory", "edit");
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
