import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as borrowRepository from "@main/database/repositories/borrow-repository";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as supplierRepository from "@main/database/repositories/supplier-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, getSession, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { computeBorrowReturnStatus } from "@shared/lib/borrow";
import { borrowCreateSchema, recordBorrowReturnSchema } from "@shared/schemas/borrow";
import type { Borrow, BorrowListItem, BorrowReturnEvent, BorrowReturnEventItem, BorrowStatus, BorrowSummary } from "@shared/types/borrow";

function generateBorrowNumber(tenantId: string): string {
  return generateDocumentNumber({
    tenantId,
    prefix: "BRW",
    digits: 6,
    existingNumbers: borrowRepository.findMaxBorrowNumberRow(tenantId)
  });
}

function assertSupplierExists(tenantId: string, supplierId: string): void {
  const row = supplierRepository.findSupplierRowById(supplierId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Shop (supplier) not found");
  }
}

function assertLocationBelongsToTenant(tenantId: string, locationId: string): void {
  const row = locationRepository.findLocationRowById(locationId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Location not found");
  }
}

function getBorrowDetail(id: string): Borrow {
  const row = borrowRepository.findBorrowDetailRowById(id);
  if (!row) {
    throw new Error("Borrow record not found");
  }
  const items = borrowRepository.findBorrowItemDetailRowsForBorrow(id).map(borrowRepository.mapBorrowItemDetailRow);
  return borrowRepository.mapBorrowDetailRow(row, items);
}

/** Tenant-wide by default; branch-scoped to the caller's assigned location like Purchases/Sales —
 * a super-admin with no assigned branch sees every storefront's borrow records. */
export function listBorrows(): BorrowListItem[] {
  requirePermission("borrows", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return borrowRepository.findAllBorrowListRows(tenantId, locationId).map(borrowRepository.mapBorrowListRow);
}

export function getBorrowSummary(): BorrowSummary {
  requirePermission("borrows", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return borrowRepository.mapBorrowSummaryRow(borrowRepository.findBorrowSummaryRow(tenantId, locationId));
}

export function getBorrow(id: string): Borrow {
  requirePermission("borrows", "view");
  return getBorrowDetail(id);
}

/**
 * Creates a borrow/loan record AND moves stock immediately — unlike a purchase (stock only moves on
 * receiving), a borrow's physical handover already happened by the time anyone is recording it here,
 * so there's no separate "ordered, not yet arrived" state. See shared/types/borrow.ts's own doc
 * comment for the direction → movement-type mapping.
 */
export function createBorrow(input: unknown): Borrow {
  requirePermission("borrows", "create");
  const parsed = borrowCreateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();

  assertSupplierExists(tenantId, parsed.supplierId);
  assertLocationBelongsToTenant(tenantId, parsed.locationId);

  const borrowId = `borrow_${randomUUID()}`;
  const movementType = parsed.direction === "borrowed" ? "borrow_in" : "loan_out";
  const sign = parsed.direction === "borrowed" ? 1 : -1;

  return runInTransaction(() => {
    borrowRepository.insertBorrowRow({
      id: borrowId,
      tenantId,
      borrowNumber: generateBorrowNumber(tenantId),
      direction: parsed.direction,
      supplierId: parsed.supplierId,
      locationId: parsed.locationId,
      notes: parsed.notes,
      createdBy: employeeId
    });

    for (const item of parsed.items) {
      borrowRepository.insertBorrowItemRow({
        id: `borrow_item_${randomUUID()}`,
        borrowId,
        productId: item.productId,
        quantity: item.quantity
      });

      // Same movement-application path every other stock-moving action uses (checkout, purchases
      // receiving, stock requests) — throws its own "insufficient stock" error (naming the product)
      // if a "lent" line would take a product negative.
      applyValidatedStockMovement(
        {
          productId: item.productId,
          locationId: parsed.locationId,
          movementType,
          quantityChange: sign * item.quantity,
          referenceType: "borrow",
          referenceId: borrowId,
          performedBy: employeeId,
          notes: null
        },
        tenantId
      );
    }

    return getBorrowDetail(borrowId);
  });
}

/**
 * Records some or all of the outstanding quantity being returned on one or more lines — the mirror
 * image of receivePurchaseGoods, except the direction of the stock movement depends on which way
 * this borrow originally went (see createBorrow's own movementType/sign mapping, inverted here).
 * Supports repeated partial return sessions until every line is fully returned.
 */
export function recordBorrowReturn(id: string, input: unknown): Borrow {
  requirePermission("borrows", "edit");
  const parsed = recordBorrowReturnSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  const session = getSession();
  const returnedByName = session ? `${session.employee.firstName} ${session.employee.lastName}` : "Unknown";

  const borrow = borrowRepository.findBorrowRowById(id);
  if (!borrow || borrow.tenant_id !== tenantId) {
    throw new Error("Borrow record not found");
  }
  if (borrow.status === "returned") {
    throw new Error("This borrow record has already been fully returned");
  }

  const existingItems = borrowRepository.findBorrowItemDetailRowsForBorrow(id);
  const itemById = new Map(existingItems.map((item) => [item.id, item]));

  for (const entry of parsed.items) {
    const item = itemById.get(entry.borrowItemId);
    if (!item || item.borrow_id !== id) {
      throw new Error("One of the selected lines was not found");
    }
    if (entry.returnQuantity > item.remaining_quantity) {
      throw new Error(`Can't return ${entry.returnQuantity} units — only ${item.remaining_quantity} remain outstanding`);
    }
  }

  // Returning what THIS shop borrowed removes it again; getting back what THIS shop lent adds it
  // back — the exact inverse of createBorrow's own mapping.
  const movementType = borrow.direction === "borrowed" ? "borrow_return_out" : "loan_return_in";
  const sign = borrow.direction === "borrowed" ? -1 : 1;

  return runInTransaction(() => {
    const eventItems: BorrowReturnEventItem[] = [];

    for (const entry of parsed.items) {
      const item = itemById.get(entry.borrowItemId);
      if (!item || entry.returnQuantity <= 0) continue;

      const previousQuantity = inventoryRepository.findInventoryRow(item.product_id, borrow.location_id)?.quantity ?? 0;
      const newQuantity = previousQuantity + sign * entry.returnQuantity;

      const newReturnedQuantity = item.returned_quantity + entry.returnQuantity;
      borrowRepository.updateBorrowItemReturnedQuantityRow(item.id, newReturnedQuantity);

      applyValidatedStockMovement(
        {
          productId: item.product_id,
          locationId: borrow.location_id,
          movementType,
          quantityChange: sign * entry.returnQuantity,
          referenceType: "borrow",
          referenceId: id,
          performedBy: employeeId,
          notes: null
        },
        tenantId
      );

      eventItems.push({
        borrowItemId: item.id,
        productId: item.product_id,
        productName: item.product_name,
        sku: item.sku,
        returnQuantity: entry.returnQuantity,
        previousQuantity,
        newQuantity
      });
    }

    if (eventItems.length > 0) {
      const existingEvents = JSON.parse(borrow.return_events) as BorrowReturnEvent[];
      const newEvent: BorrowReturnEvent = {
        id: `borrow_return_${randomUUID()}`,
        returnedBy: employeeId ?? "",
        returnedByName,
        returnedAt: new Date().toISOString(),
        items: eventItems
      };
      borrowRepository.appendReturnEventToBorrowRow({
        id,
        returnEvents: [...existingEvents, newEvent]
      });
    }

    const updatedItems = borrowRepository.findBorrowItemRowsForBorrow(id);
    const newStatus = computeBorrowReturnStatus({
      items: updatedItems.map((item) => ({ quantity: item.quantity, returnedQuantity: item.returned_quantity }))
    });

    borrowRepository.updateBorrowStatusRow(id, newStatus as BorrowStatus);

    return getBorrowDetail(id);
  });
}
