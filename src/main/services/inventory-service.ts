import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as mainStoreAllocationRepository from "@main/database/repositories/main-store-allocation-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as stockMovementRepository from "@main/database/repositories/stock-movement-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission, requirePermissionAnyOf } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import {
  stockMovementInputSchema,
  stockTransferInputSchema,
  type StockMovementInput
} from "@shared/schemas/stock-movement";
import type { InventoryBalance, LocationStockLevel } from "@shared/types/inventory";
import type {
  StockMovement,
  StockMovementFeedItem,
  StockMovementType,
  StockTransferResult
} from "@shared/types/stock-movement";

const INCREASING_MOVEMENT_TYPES = new Set(["purchase", "transfer_in", "return", "opening_stock"]);
const DECREASING_MOVEMENT_TYPES = new Set(["sale", "transfer_out", "damage"]);

/** transfer_in/transfer_out must only ever be created as a matched pair via recordStockTransfer. */
const STANDALONE_BLOCKED_TYPES = new Set<StockMovementType>(["transfer_in", "transfer_out"]);

function assertValidDirection(input: StockMovementInput): void {
  if (INCREASING_MOVEMENT_TYPES.has(input.movementType) && input.quantityChange < 0) {
    throw new Error(`A "${input.movementType}" movement must increase stock (use a positive quantity)`);
  }
  if (DECREASING_MOVEMENT_TYPES.has(input.movementType) && input.quantityChange > 0) {
    throw new Error(`A "${input.movementType}" movement must decrease stock (use a negative quantity)`);
  }
}

/**
 * Applies an already-validated movement: inserts the ledger row, then upserts the balance.
 * Must be called from within a transaction (own or a caller's, e.g. product creation with opening stock).
 *
 * When the movement's location is the tenant's Main Store, this also keeps the Main Store allocation
 * breakdown (main-store-service.ts) in lockstep with the plain inventory total:
 *  - Pass allocationStorefrontId to target a SPECIFIC named storefront's own earmark precisely (throws
 *    if that bucket doesn't have enough — used by the Main Store's own receive/distribute/return
 *    actions).
 *  - Leave it unset (or pass null) and the change is validated/reflected against the "unallocated"
 *    pool instead. This is the fallback for every other existing caller (manual add/remove,
 *    product-creation opening stock, generic transfers) that doesn't know about allocations.
 *
 * The plain inventory row (this location's own running total, rebuilt by replaying stock_movements —
 * always correct by construction, since that ledger is append-only with no concurrent-edit scenario to
 * ever drift against) is the single source of truth for the TOTAL at Main Store. A named storefront's
 * own earmark is the only thing still independently stored/synced; "unallocated" is always derived as
 * that ledger-true total minus every named earmark, both for validating this movement and for the
 * write at the bottom of this function — never read from or written to a stored row of its own. This
 * used to run the other way (buckets treated as truth, the plain row self-healed from their sum) —
 * that's exactly what let the buckets silently drift from the ledger on a real tenant's machine; see
 * main-store-service.ts's trueUnallocatedQuantity/deriveUnallocatedQuantity doc comments and migration
 * 77 for the full root-cause writeup.
 */
export function applyValidatedStockMovement(
  input: StockMovementInput & { allocationStorefrontId?: string | null },
  tenantId: string
): StockMovement {
  assertValidDirection(input);

  const product = productRepository.findProductRowById(input.productId);
  if (!product || product.tenant_id !== tenantId) {
    throw new Error("Product not found");
  }

  const location = locationRepository.findLocationRowById(input.locationId);
  if (!location || location.tenant_id !== tenantId) {
    throw new Error("Location not found");
  }

  const mainStore = locationRepository.findMainStoreLocationRow(tenantId);
  const isMainStoreBucketMove = Boolean(mainStore) && input.locationId === mainStore!.id;
  // Named earmark (a real storefront) vs the "unallocated" pool — see this function's own doc
  // comment above the bucket-write section below for why only the FORMER is ever stored anymore.
  const targetsNamedBucket = isMainStoreBucketMove && input.allocationStorefrontId !== undefined && input.allocationStorefrontId !== null;

  // For a Main Store movement, the plain inventory row (this location's own running ledger total —
  // always correct, since stock_movements is append-only with no concurrent-edit scenario to ever
  // drift against, unlike the allocation buckets below) is read once and used for BOTH the
  // unallocated-pool derivation and the actual write at the bottom of this function.
  const plainInventoryQuantity = isMainStoreBucketMove
    ? (inventoryRepository.findInventoryRow(input.productId, input.locationId)?.quantity ?? 0)
    : 0;

  // currentQuantity is validated against the SPECIFIC bucket this movement actually targets — a
  // named storefront's own earmark (a real, independently-synced fact — a Storekeeper's own
  // decision) if allocationStorefrontId names one, or the "unallocated" pool otherwise. Unallocated
  // is deliberately never read from (or written to — see below) its own stored row: it's always
  // derived as the ledger-true Main Store total minus every named earmark. Storing it as its own
  // independently-synced fact is exactly what let it drift from reality — confirmed live: one
  // product's stored "unallocated" bucket read 4 units higher than what its own stock_movements
  // ledger supported, traced to a two-device race whose corresponding bucket write silently never
  // landed on the other device even though the ledger entry itself (and the plain row rebuilt from
  // it) did. A named bucket genuinely needs its own synced row (two devices really can each
  // legitimately earmark stock for a DIFFERENT storefront before syncing), so it keeps the same
  // narrower risk every other conflict-aware entity already carries — this only removes the
  // needless extra copy of a number that was always fully derivable from data that's already
  // ledger-true.
  let currentQuantity: number;
  if (isMainStoreBucketMove) {
    if (targetsNamedBucket) {
      currentQuantity = mainStoreAllocationRepository.findAllocationRow(input.productId, input.allocationStorefrontId as string)?.quantity ?? 0;
    } else {
      const namedTotal = mainStoreAllocationRepository
        .findAllocationRowsForProduct(input.productId)
        .filter((row) => row.storefront_id !== null)
        .reduce((sum, row) => sum + row.quantity, 0);
      currentQuantity = Math.max(0, plainInventoryQuantity - namedTotal);
    }
  } else {
    const existing = inventoryRepository.findInventoryRow(input.productId, input.locationId);
    currentQuantity = existing?.quantity ?? 0;
  }
  const nextQuantity = currentQuantity + input.quantityChange;

  if (nextQuantity < 0 && !product.allow_negative_stock) {
    // Leads with the product name — this is the shared validator behind nearly every stock-moving
    // action in the app (checkout, invoices, quotations, purchases receiving, stock requests, Main
    // Store), so a generic "Insufficient stock at X. Available: N, requested change: -M" with no
    // product name was genuinely useless for a real cart/document with many lines: a client with a
    // 20+ product order had no way to tell which single line the error was even about.
    throw new Error(
      `Insufficient stock for "${product.name}" at ${location.location_name}. Available: ${currentQuantity}, requested: ${Math.abs(input.quantityChange)}`
    );
  }

  const movementRow = stockMovementRepository.insertStockMovementRow({
    ...input,
    id: `movement_${randomUUID()}`,
    tenantId
  });

  if (isMainStoreBucketMove) {
    // Only a NAMED bucket is ever written — see targetsNamedBucket's own doc comment above for why
    // "unallocated" no longer has a row to write at all. The plain inventory row below is what
    // actually carries the physical total now; unallocated is always re-derived from it on read
    // (main-store-service.ts's trueUnallocatedQuantity/deriveUnallocatedQuantity), never stored.
    if (targetsNamedBucket) {
      mainStoreAllocationRepository.adjustAllocationQuantity({
        tenantId,
        productId: input.productId,
        storefrontId: input.allocationStorefrontId as string,
        delta: input.quantityChange
      });
    }
    inventoryRepository.upsertInventoryQuantity({
      tenantId,
      productId: input.productId,
      locationId: input.locationId,
      quantity: plainInventoryQuantity + input.quantityChange
    });
  } else {
    inventoryRepository.upsertInventoryQuantity({
      tenantId,
      productId: input.productId,
      locationId: input.locationId,
      quantity: nextQuantity
    });
  }

  return stockMovementRepository.mapStockMovementRow(movementRow);
}

/** Validates and applies a single manual stock movement in its own transaction — the IPC entry point. */
export function recordStockMovement(input: unknown): StockMovement {
  requirePermission("inventory", "edit");
  const parsed = stockMovementInputSchema.parse(input);

  if (STANDALONE_BLOCKED_TYPES.has(parsed.movementType)) {
    throw new Error("Transfers must move stock between two locations — use the transfer action instead");
  }

  const { tenantId } = getCurrentTenant();
  const performedBy = getCurrentEmployeeId();
  return runInTransaction(() => applyValidatedStockMovement({ ...parsed, performedBy }, tenantId));
}

/**
 * Moves stock from one location to another as a single atomic operation: a transfer_out at the
 * source and a transfer_in at the destination, sharing a reference id so they can be correlated.
 */
export function recordStockTransfer(input: unknown): StockTransferResult {
  requirePermission("stock_transfers", "create");
  const parsed = stockTransferInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const performedBy = getCurrentEmployeeId();
  const transferId = `transfer_${randomUUID()}`;

  return runInTransaction(() => {
    const transferOut = applyValidatedStockMovement(
      {
        productId: parsed.productId,
        locationId: parsed.fromLocationId,
        movementType: "transfer_out",
        quantityChange: -parsed.quantity,
        referenceType: "transfer",
        referenceId: transferId,
        performedBy,
        notes: parsed.notes
      },
      tenantId
    );

    const transferIn = applyValidatedStockMovement(
      {
        productId: parsed.productId,
        locationId: parsed.toLocationId,
        movementType: "transfer_in",
        quantityChange: parsed.quantity,
        referenceType: "transfer",
        referenceId: transferId,
        performedBy,
        notes: parsed.notes
      },
      tenantId
    );

    return { transferOut, transferIn };
  });
}

/** Every tenant location left-joined against this product's stock — locations with no row read as zero. */
export function getInventoryOverview(productId: string): InventoryBalance[] {
  requirePermission("inventory", "view");
  const { tenantId } = getCurrentTenant();
  return inventoryRepository
    .findInventoryOverviewForProduct(tenantId, productId)
    .map((row) => inventoryRepository.mapInventoryOverviewRow(row, tenantId, productId));
}

export function listStockMovements(productId: string, limit?: number): StockMovement[] {
  requirePermission("inventory", "view");
  return stockMovementRepository
    .findStockMovementRowsForProduct(productId, limit)
    .map(stockMovementRepository.mapStockMovementRow);
}

/** Every product's stock movements in one feed — the Stock Ledger. Branch-scoped like everything
 * else: a storekeeper assigned to the Main Store sees only its movements, a super-admin sees all. */
// Ported from report-service.ts's own startOfDayIso/addDaysIso — same reasoning: a plain
// "T00:00:00.000Z" suffix silently treats every calendar day as UTC, which is wrong the moment a
// movement near midnight is checked from a timezone ahead of UTC. Kept as a small local duplicate
// rather than shared/imported, matching this codebase's existing convention for these two helpers
// (report-service.ts doesn't export them either).
function startOfDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toISOString();
}

function addDaysIso(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** startDate/endDate are plain YYYY-MM-DD (inclusive) — pass neither to skip date filtering
 * entirely. limit stays as a safety cap even with a date range (e.g. a genuinely huge storefront
 * picking "All Years"), same as every other capped feed in this app. */
export function listAllStockMovements(startDate?: string, endDate?: string, limit = 5000): StockMovementFeedItem[] {
  requirePermission("inventory", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  const startIso = startDate ? startOfDayIso(startDate) : null;
  const endIsoExclusive = endDate ? startOfDayIso(addDaysIso(endDate, 1)) : null;
  return stockMovementRepository
    .findAllStockMovementRows(tenantId, locationId, limit, startIso, endIsoExclusive)
    .map(stockMovementRepository.mapStockMovementFeedRow);
}

/** Every stocked product's balance at one location — feeds the POS screen's available-stock display. */
export function listInventoryForLocation(locationId: string): LocationStockLevel[] {
  requirePermissionAnyOf([
    ["inventory", "view"],
    ["products", "view"]
  ]);
  return inventoryRepository.findInventoryRowsForLocation(locationId).map((row) => ({
    productId: row.product_id,
    quantity: row.quantity
  }));
}
