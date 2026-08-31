import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as mainStoreAllocationRepository from "@main/database/repositories/main-store-allocation-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import {
  getCurrentBranchScope,
  getCurrentEmployeeId,
  requirePermission,
  requirePermissionAnyOf
} from "@main/services/auth-service";
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

/**
 * Main Store's "unallocated" pool was ORIGINALLY stored as its own directly-synced row in
 * main_store_allocations (storefront_id IS NULL) — but conceptually it was never really an
 * independent fact, it's always supposed to equal "the ledger-true total at Main Store, minus
 * whatever's earmarked for a named storefront". Storing it as its own writable/syncable number
 * instead of always deriving it is exactly what let it drift from reality: confirmed live, one real
 * product's stored unallocated bucket read 19 while its own stock_movements ledger (replayed by
 * hand) supported only 15 — traced to a two-device race whose bucket write apparently never durably
 * landed on this device even though the ledger movement itself, and the plain inventory row rebuilt
 * from it (always correct — stock_movements is append-only, no concurrent-edit scenario to ever
 * drift against), both did.
 *
 * FIXED at the root, not just patched: nothing in this codebase writes a storefront_id-NULL
 * main_store_allocations row anymore (see inventory-service.ts's applyValidatedStockMovement and
 * this file's own distributeMainStoreStockCore/recordMainStoreAdjustment/reallocateMainStoreStock) —
 * unallocated is ALWAYS computed this way, everywhere it's needed, never independently synced, so it
 * can no longer drift by construction. A named storefront's own earmark stays a real, independently-
 * synced business decision (a Storekeeper's own choice, and two devices genuinely can each earmark
 * stock for a DIFFERENT storefront before syncing) — that one keeps the same narrower conflict
 * surface every other mutable synced row already carries; this just removes the needless extra copy
 * of a number that was always fully derivable from data that's already ledger-true. Clamped at 0 as
 * a last-resort guard, never expected to matter now that nothing can push it negative.
 */
function trueUnallocatedQuantity(totalAtMainStore: number, allocatedToNamedStorefronts: number): number {
  return Math.max(0, totalAtMainStore - allocatedToNamedStorefronts);
}

/** Fetch-and-derive convenience wrapper around trueUnallocatedQuantity, for the write-path callers
 * below that need the current unallocated figure to validate or compute a delta against (the
 * display functions further down build allocatedToNamedStorefronts from a bulk query instead, since
 * they already need every storefront's own figure individually). */
export function deriveUnallocatedQuantity(productId: string, mainStoreLocationId: string): number {
  const totalAtMainStore = inventoryRepository.findInventoryRow(productId, mainStoreLocationId)?.quantity ?? 0;
  const allocatedToNamedStorefronts = mainStoreAllocationRepository
    .findAllocationRowsForProduct(productId)
    .filter((row) => row.storefront_id !== null)
    .reduce((sum, row) => sum + row.quantity, 0);
  return trueUnallocatedQuantity(totalAtMainStore, allocatedToNamedStorefronts);
}

function buildProductDetail(tenantId: string, productId: string): MainStoreProductDetail {
  const mainStore = requireMainStoreLocation(tenantId);
  // The plain inventory row (rebuilt by replaying stock_movements — see
  // applyValidatedStockMovement's own comment on it being "a correct running total of the ledger")
  // is the TOTAL physical quantity at Main Store, ledger-true by construction. See
  // trueUnallocatedQuantity's own doc comment for why unallocated is derived from it rather than
  // trusted as its own independently-stored, independently-drifting number.
  const totalAtMainStore = inventoryRepository.findInventoryRow(productId, mainStore.id)?.quantity ?? 0;

  const storefronts = locationRepository
    .findAllLocationRows(tenantId)
    .filter((row) => isStorefrontType(row.location_type as LocationType))
    .map((row) => ({
      storefrontId: row.id,
      storefrontName: row.location_name,
      allocatedQuantity: mainStoreAllocationRepository.findAllocationRow(productId, row.id)?.quantity ?? 0,
      onHandQuantity: inventoryRepository.findInventoryRow(productId, row.id)?.quantity ?? 0
    }));

  const allocatedToNamedStorefronts = storefronts.reduce((sum, s) => sum + s.allocatedQuantity, 0);
  const unallocatedQuantity = trueUnallocatedQuantity(totalAtMainStore, allocatedToNamedStorefronts);

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
  const mainStore = requireMainStoreLocation(tenantId);

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

  // Ledger-true total at Main Store per product — see trueUnallocatedQuantity's own doc comment for
  // why this (not the separately-synced allocation bucket sum) is what totalAtMainStore is built
  // from here.
  const mainStoreInventoryByProduct = new Map<string, number>();
  for (const row of inventoryRepository.findInventoryRowsForLocation(mainStore.id)) {
    mainStoreInventoryByProduct.set(row.product_id, row.quantity);
  }

  return products.map((product) => {
    const buckets = allocationByProduct.get(product.id);
    const onHandForProduct = onHandByProduct.get(product.id);
    const totalAtMainStore = mainStoreInventoryByProduct.get(product.id) ?? 0;

    let allocatedToNamedStorefronts = 0;
    let onHandAcrossStorefronts = 0;

    const storefronts = storefrontLocations.map((location) => {
      const allocatedQuantity = buckets?.get(location.id) ?? 0;
      allocatedToNamedStorefronts += allocatedQuantity;
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

    const unallocatedQuantity = trueUnallocatedQuantity(totalAtMainStore, allocatedToNamedStorefronts);

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
  const mainStore = requireMainStoreLocation(tenantId);
  const rows = mainStoreAllocationRepository.findAllAllocationRows(tenantId);

  const byProduct = new Map<string, MainStoreAllocationSummary>();
  for (const row of rows) {
    const entry = byProduct.get(row.product_id) ?? {
      productId: row.product_id,
      unallocatedQuantity: 0,
      allocatedByStorefront: {}
    };
    if (row.storefront_id !== null) {
      entry.allocatedByStorefront[row.storefront_id] = row.quantity;
    }
    byProduct.set(row.product_id, entry);
  }

  // unallocatedQuantity is derived (ledger-true Main Store total minus what's earmarked for a named
  // storefront), never read directly off the stored bucket — see trueUnallocatedQuantity's own doc
  // comment. This powers Goods Received's "Transfer from Main Store" availability preview and the
  // Stock Request "Available at Main Store" hint, both of which need the real, undrifted number.
  for (const row of inventoryRepository.findInventoryRowsForLocation(mainStore.id)) {
    const entry = byProduct.get(row.product_id) ?? {
      productId: row.product_id,
      unallocatedQuantity: 0,
      allocatedByStorefront: {}
    };
    const allocatedToNamedStorefronts = Object.values(entry.allocatedByStorefront).reduce((sum, q) => sum + q, 0);
    entry.unallocatedQuantity = trueUnallocatedQuantity(row.quantity, allocatedToNamedStorefronts);
    byProduct.set(row.product_id, entry);
  }

  return Array.from(byProduct.values());
}

/**
 * Powers the "Available at Main Store" hint on both the New Stock Request form (the requester) and
 * the request detail modal (the Storekeeper/Super Admin deciding whether to approve) — permission-
 * gated by "stock_requests":"create" OR "stock_requests":"approve" (NOT "main_store":"view", which
 * Cashier/Manager deliberately never get) precisely so it can be shown to both. Deliberately excludes
 * plain "stock_requests":"view" — every default role that can see requests at all also has create or
 * approve, but a hypothetical view-only custom role has no action to inform here. Resolves the target
 * storefront the exact same way createStockRequest itself does: a branch-scoped caller's own session
 * branch always wins over whatever storefrontId was passed in (never trusted from the client for
 * them — irrelevant for a Storekeeper/Super Admin viewing someone else's request, who is always
 * branch-less and so always falls through to the passed storefrontId); a branch-less caller must
 * supply one explicitly. Returns an empty list rather than throwing when no storefront can be
 * resolved yet — this is a read that renders before the form is fully filled in, not a submission.
 */
export function getMainStoreAvailabilityForStockRequest(storefrontId: string | null): StockRequestAvailability[] {
  requirePermissionAnyOf([
    ["stock_requests", "create"],
    ["stock_requests", "approve"]
  ]);
  const { tenantId } = getCurrentTenant();
  const branchScope = getCurrentBranchScope();
  const target = branchScope ?? storefrontId;
  if (!target) return [];

  const location = locationRepository.findLocationRowById(target);
  if (!location || location.tenant_id !== tenantId || !isStorefrontType(location.location_type as LocationType)) {
    return [];
  }
  const mainStore = requireMainStoreLocation(tenantId);

  // Per product: this target storefront's own named earmark, plus the derived unallocated pool —
  // the exact same "could ship right now" formula distributeMainStoreStockCore itself draws from.
  // Built from bulk queries (not one per product) the same way the display functions above are.
  const namedTotalByProduct = new Map<string, number>();
  const targetAllocationByProduct = new Map<string, number>();
  for (const row of mainStoreAllocationRepository.findAllAllocationRows(tenantId)) {
    if (row.storefront_id === null) continue;
    namedTotalByProduct.set(row.product_id, (namedTotalByProduct.get(row.product_id) ?? 0) + row.quantity);
    if (row.storefront_id === target) {
      targetAllocationByProduct.set(row.product_id, row.quantity);
    }
  }

  const byProduct = new Map<string, StockRequestAvailability>();
  for (const row of inventoryRepository.findInventoryRowsForLocation(mainStore.id)) {
    const namedTotal = namedTotalByProduct.get(row.product_id) ?? 0;
    const unallocated = trueUnallocatedQuantity(row.quantity, namedTotal);
    const targetAllocation = targetAllocationByProduct.get(row.product_id) ?? 0;
    byProduct.set(row.product_id, { productId: row.product_id, availableQuantity: unallocated + targetAllocation });
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
  const unallocatedQuantity = deriveUnallocatedQuantity(params.productId, mainStore.id);

  if (allocatedQuantity + unallocatedQuantity < params.quantity) {
    // Leads with the product name — this is the shared core behind Main Store's own manual
    // distribute, Goods Received transfers, AND Stock Request approval (which loops this once per
    // item), so a bare "Not enough stock to distribute 6" with no product name left the approver of
    // a many-line request no way to tell which product actually came up short.
    const productName = productRepository.findProductRowById(params.productId)?.name ?? params.productId;
    throw new Error(
      `Not enough stock of "${productName}" to distribute ${params.quantity}. Earmarked for this storefront: ${allocatedQuantity}, unallocated: ${unallocatedQuantity}.`
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
    const currentQuantity = parsed.storefrontId
      ? (mainStoreAllocationRepository.findAllocationRow(parsed.productId, parsed.storefrontId)?.quantity ?? 0)
      : deriveUnallocatedQuantity(parsed.productId, mainStore.id);
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
 * movement is recorded and the plain inventory total at Main Store is untouched. Only ever writes a
 * NAMED storefront's own bucket (a real, independently-synced earmark decision) — moving to/from the
 * "unallocated" pool needs no write of its own anymore (see trueUnallocatedQuantity's own doc
 * comment): reducing a named bucket automatically grows the derived unallocated remainder, and vice
 * versa, since unallocated is always computed as the ledger-true total minus every named bucket. */
export function reallocateMainStoreStock(input: unknown): MainStoreProductDetail {
  requirePermission("main_store", "edit");
  const parsed: MainStoreReallocateInput = mainStoreReallocateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const mainStore = requireMainStoreLocation(tenantId);
  if (parsed.fromStorefrontId) requireStorefront(parsed.fromStorefrontId, tenantId);
  if (parsed.toStorefrontId) requireStorefront(parsed.toStorefrontId, tenantId);

  runInTransaction(() => {
    if (parsed.fromStorefrontId) {
      mainStoreAllocationRepository.adjustAllocationQuantity({
        tenantId,
        productId: parsed.productId,
        storefrontId: parsed.fromStorefrontId,
        delta: -parsed.quantity
      });
    } else {
      // Coming FROM the unallocated pool — nothing stored to decrement, but still needs the same
      // "can't go negative" guard adjustAllocationQuantity already gives a named bucket below.
      const currentUnallocated = deriveUnallocatedQuantity(parsed.productId, mainStore.id);
      if (parsed.quantity > currentUnallocated) {
        const productName = productRepository.findProductRowById(parsed.productId)?.name ?? parsed.productId;
        throw new Error(
          `Not enough unallocated stock of "${productName}" to reallocate ${parsed.quantity}. Available: ${currentUnallocated}.`
        );
      }
    }
    if (parsed.toStorefrontId) {
      mainStoreAllocationRepository.adjustAllocationQuantity({
        tenantId,
        productId: parsed.productId,
        storefrontId: parsed.toStorefrontId,
        delta: parsed.quantity
      });
    }
    // else: going TO the unallocated pool — nothing to write; the FROM side above already reduced
    // whichever named bucket unallocated is derived against.
  });

  return buildProductDetail(tenantId, parsed.productId);
}
