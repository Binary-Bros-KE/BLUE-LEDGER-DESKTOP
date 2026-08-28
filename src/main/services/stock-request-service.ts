import { runInTransaction } from "@main/database/connection";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as stockRequestRepository from "@main/database/repositories/stock-request-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { distributeMainStoreStockCore } from "@main/services/main-store-service";
import { assertNotAlreadyDecidedRemotely } from "@main/services/sync-engine";
import { getCurrentTenant } from "@main/services/tenant-service";
import {
  stockRequestCreateSchema,
  stockRequestRejectSchema,
  type StockRequestCreateInput,
  type StockRequestRejectInput
} from "@shared/schemas/stock-request";
import { isStorefrontType, type LocationType } from "@shared/types/location";
import type { StockRequest, StockRequestItem, StockRequestListItem } from "@shared/types/stock-request";

/** SR-D{n}-000001, SR-D{n}-000002, ... */
function generateStockRequestNumber(tenantId: string): string {
  return generateDocumentNumber({
    tenantId,
    prefix: "SR",
    digits: 6,
    existingNumbers: stockRequestRepository.findMaxStockRequestNumberRow(tenantId)
  });
}

function mapListRow(row: stockRequestRepository.StockRequestRow): StockRequestListItem {
  return {
    id: row.id,
    requestNumber: row.request_number,
    storefrontId: row.storefront_id,
    storefrontName: row.storefront_name,
    status: row.status,
    itemCount: row.item_count,
    totalQuantityRequested: row.total_quantity_requested,
    notes: row.notes,
    rejectionReason: row.rejection_reason,
    requestedByName: row.requested_by_name,
    requestedAt: row.requested_at,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at
  };
}

function mapItemRow(row: stockRequestRepository.StockRequestItemRow): StockRequestItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    quantityRequested: row.quantity_requested,
    previousQuantity: row.previous_quantity,
    newQuantity: row.new_quantity,
    mainStorePreviousQuantity: row.main_store_previous_quantity,
    mainStoreNewQuantity: row.main_store_new_quantity
  };
}

/** Throws "not found" (rather than a permission error) for a branch-scoped caller trying to read a
 * different storefront's request, so a Cashier probing ids can't tell the difference from a typo. */
function buildStockRequest(id: string): StockRequest {
  const row = stockRequestRepository.findStockRequestRowById(id);
  if (!row) {
    throw new Error("Stock request not found");
  }
  const branchScope = getCurrentBranchScope();
  if (branchScope && row.storefront_id !== branchScope) {
    throw new Error("Stock request not found");
  }
  const items = stockRequestRepository.findStockRequestItemRows(id).map(mapItemRow);
  return { ...mapListRow(row), items };
}

/** Branch-scoped roles (Cashier/Manager) only ever see their own storefront's requests; a null branch
 * scope (Storekeeper/Super Admin left unassigned) sees every storefront's, same convention as every
 * other branch-scoped read in this app. */
export function listStockRequests(): StockRequestListItem[] {
  requirePermission("stock_requests", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return stockRequestRepository.findAllStockRequestRows(tenantId, locationId).map(mapListRow);
}

export function getStockRequest(id: string): StockRequest {
  requirePermission("stock_requests", "view");
  return buildStockRequest(id);
}

/** A branch-scoped requester's storefront is always their own session branch — never trusted from the
 * client — so a Cashier/Manager can only ever request stock for the storefront they're signed into.
 * Only a cross-branch caller (no session branch) must name one explicitly. */
export function createStockRequest(input: unknown): StockRequest {
  requirePermission("stock_requests", "create");
  const parsed: StockRequestCreateInput = stockRequestCreateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }

  const branchScope = getCurrentBranchScope();
  const storefrontId = branchScope ?? parsed.storefrontId;
  if (!storefrontId) {
    throw new Error("Choose which storefront this request is for");
  }
  const location = locationRepository.findLocationRowById(storefrontId);
  if (!location || location.tenant_id !== tenantId || !isStorefrontType(location.location_type as LocationType)) {
    throw new Error("Storefront not found");
  }

  const requestNumber = generateStockRequestNumber(tenantId);
  let requestId = "";

  runInTransaction(() => {
    requestId = stockRequestRepository.insertStockRequestRow({
      tenantId,
      requestNumber,
      storefrontId,
      notes: parsed.notes,
      requestedBy: employeeId
    });
    for (const item of parsed.items) {
      stockRequestRepository.insertStockRequestItemRow({
        stockRequestId: requestId,
        productId: item.productId,
        quantityRequested: item.quantity
      });
    }
  });

  return buildStockRequest(requestId);
}

/**
 * Fulfils every item by shipping it from Main Store to the requesting storefront — reuses the exact
 * same allocation-aware logic `distributeFromMainStore` uses for a manual transfer, just looped across
 * every item under one transaction and traced back to this request via `reference_id` in the stock
 * ledger. If ANY item doesn't have enough stock at Main Store, the whole approval rolls back — nothing
 * partially fulfils, so the approver must free up stock (or reject) and try again.
 *
 * previousQuantity/newQuantity (storefront) and mainStorePreviousQuantity/mainStoreNewQuantity (Main
 * Store) are captured HERE, immediately before/after each item's transfer applies — not recomputed
 * later — so the printed/reprinted request always shows exactly what was true at the moment of
 * approval, even if the product's stock has moved on since. Same "freeze at the moment of the action"
 * discipline as stock-receipt-service.ts's own createStockReceipt.
 */
export async function approveStockRequest(id: string): Promise<StockRequest> {
  requirePermission("stock_requests", "approve");
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }

  const row = stockRequestRepository.findStockRequestRowById(id);
  if (!row) {
    throw new Error("Stock request not found");
  }
  if (row.status !== "pending") {
    throw new Error("This request has already been reviewed");
  }
  await assertNotAlreadyDecidedRemotely("stock_requests", id, "pending");

  const items = stockRequestRepository.findStockRequestItemRows(id);
  const mainStore = locationRepository.findMainStoreLocationRow(tenantId);
  if (!mainStore) {
    throw new Error("No Main Store is set up for this business yet");
  }

  runInTransaction(() => {
    for (const item of items) {
      const previousQuantity = inventoryRepository.findInventoryRow(item.product_id, row.storefront_id)?.quantity ?? 0;
      const mainStorePreviousQuantity = inventoryRepository.findInventoryRow(item.product_id, mainStore.id)?.quantity ?? 0;

      try {
        distributeMainStoreStockCore({
          tenantId,
          employeeId,
          productId: item.product_id,
          storefrontId: row.storefront_id,
          quantity: item.quantity_requested,
          notes: null,
          referenceType: "stock_request_fulfillment",
          referenceId: id
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fulfil item";
        throw new Error(`${item.product_name}: ${message}`);
      }

      stockRequestRepository.updateStockRequestItemFulfillmentRow(item.id, {
        previousQuantity,
        newQuantity: previousQuantity + item.quantity_requested,
        mainStorePreviousQuantity,
        mainStoreNewQuantity: mainStorePreviousQuantity - item.quantity_requested
      });
    }

    stockRequestRepository.updateStockRequestStatusRow(id, {
      status: "approved",
      rejectionReason: null,
      reviewedBy: employeeId
    });
  });

  return buildStockRequest(id);
}

export async function rejectStockRequest(id: string, input: unknown): Promise<StockRequest> {
  requirePermission("stock_requests", "approve");
  const parsed: StockRequestRejectInput = stockRequestRejectSchema.parse(input);
  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }

  const row = stockRequestRepository.findStockRequestRowById(id);
  if (!row) {
    throw new Error("Stock request not found");
  }
  if (row.status !== "pending") {
    throw new Error("This request has already been reviewed");
  }
  await assertNotAlreadyDecidedRemotely("stock_requests", id, "pending");

  stockRequestRepository.updateStockRequestStatusRow(id, {
    status: "rejected",
    rejectionReason: parsed.reason,
    reviewedBy: employeeId
  });

  return buildStockRequest(id);
}
