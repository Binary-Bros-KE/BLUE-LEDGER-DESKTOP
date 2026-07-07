import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as stockMovementRepository from "@main/database/repositories/stock-movement-repository";
import { getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import {
  stockMovementInputSchema,
  stockTransferInputSchema,
  type StockMovementInput
} from "@shared/schemas/stock-movement";
import type { InventoryBalance, LocationStockLevel } from "@shared/types/inventory";
import type { StockMovement, StockMovementType, StockTransferResult } from "@shared/types/stock-movement";

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
 */
export function applyValidatedStockMovement(input: StockMovementInput, tenantId: string): StockMovement {
  assertValidDirection(input);

  const product = productRepository.findProductRowById(input.productId);
  if (!product || product.tenant_id !== tenantId) {
    throw new Error("Product not found");
  }

  const location = locationRepository.findLocationRowById(input.locationId);
  if (!location || location.tenant_id !== tenantId) {
    throw new Error("Location not found");
  }

  const existing = inventoryRepository.findInventoryRow(input.productId, input.locationId);
  const currentQuantity = existing?.quantity ?? 0;
  const nextQuantity = currentQuantity + input.quantityChange;

  if (nextQuantity < 0 && !product.allow_negative_stock) {
    throw new Error(
      `Insufficient stock at ${location.location_name}. Available: ${currentQuantity}, requested change: ${input.quantityChange}`
    );
  }

  const movementRow = stockMovementRepository.insertStockMovementRow({
    ...input,
    id: `movement_${randomUUID()}`,
    tenantId
  });

  inventoryRepository.upsertInventoryQuantity({
    tenantId,
    productId: input.productId,
    locationId: input.locationId,
    quantity: nextQuantity
  });

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

/** Every stocked product's balance at one location — feeds the POS screen's available-stock display. */
export function listInventoryForLocation(locationId: string): LocationStockLevel[] {
  requirePermission("inventory", "view");
  return inventoryRepository.findInventoryRowsForLocation(locationId).map((row) => ({
    productId: row.product_id,
    quantity: row.quantity
  }));
}
