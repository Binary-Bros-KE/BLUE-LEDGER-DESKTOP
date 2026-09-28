import { runInTransaction } from "@main/database/connection";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as stockRequestRepository from "@main/database/repositories/stock-request-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { computeStockRequestAvailability, distributeMainStoreStockCore } from "@main/services/main-store-service";
import { assertNotAlreadyDecidedRemotely } from "@main/services/sync-engine";
import { getCurrentTenant } from "@main/services/tenant-service";
import {
  stockRequestCreateSchema,
  stockRequestFulfillSchema,
  stockRequestRejectSchema,
  type StockRequestCreateInput,
  type StockRequestFulfillInput,
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
    fulfillmentNote: row.fulfillment_note,
    fullyDispatched: row.fully_dispatched === null ? null : Boolean(row.fully_dispatched),
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
    mainStoreNewQuantity: row.main_store_new_quantity,
    quantityDispatched: row.quantity_dispatched
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

/** Powers the approver alerts (sidebar badge, toast, Windows notification, dashboard card) — polled
 * every few seconds by the renderer, so it returns only the pending requests, not the whole history.
 * Gated on "approve" (not "view"): only someone who can act on a request should be alerted to it. */
export function listPendingStockRequests(): StockRequestListItem[] {
  requirePermission("stock_requests", "approve");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return stockRequestRepository
    .findAllStockRequestRows(tenantId, locationId)
    .filter((row) => row.status === "pending")
    .map(mapListRow);
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

  // Client request: a request can no longer be created for stock Main Store doesn't have — checked
  // against the exact same "could ship right now" number the form's Available column shows (this
  // storefront's own earmark + the unallocated pool), nothing is inserted if any line is short.
  // Approval still re-checks at review time, since stock can move between request and review.
  const availableByProduct = new Map(
    computeStockRequestAvailability(tenantId, storefrontId).map((row) => [row.productId, row.availableQuantity])
  );
  const requestedByProduct = new Map<string, number>();
  for (const item of parsed.items) {
    requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  const shortages: string[] = [];
  for (const [productId, requested] of requestedByProduct) {
    const available = availableByProduct.get(productId) ?? 0;
    if (requested > available) {
      const name = productRepository.findProductRowById(productId)?.name ?? productId;
      shortages.push(
        available <= 0
          ? `"${name}" is not available at Main Store`
          : `"${name}": requested ${requested}, only ${available} available`
      );
    }
  }
  if (shortages.length > 0) {
    throw new Error(`Not enough stock at Main Store — ${shortages.join("; ")}. Reduce the quantity or remove the item.`);
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
 * Fulfils each item by shipping EXACTLY as much as the storekeeper says to ship — client request:
 * partial fulfillment. A request no longer has to be all-or-nothing: if 9 of 10 requested products
 * are in stock, the storekeeper dispatches those 9 and names 0 for the 10th, instead of having to
 * reject the whole request. Reuses the exact same allocation-aware logic `distributeFromMainStore`
 * uses for a manual transfer, just looped across every item under one transaction and traced back to
 * this request via `reference_id` in the stock ledger.
 *
 * Every `quantityDispatched` is validated against BOTH the line's own `quantity_requested` (can't
 * over-dispatch) AND what's actually available at Main Store right now (same
 * computeStockRequestAvailability check createStockRequest already enforces at request time) —
 * collects every offending line into one consolidated error, same shape as createStockRequest's own
 * shortages message, so a storekeeper's client-side number can never exceed real stock.
 *
 * previousQuantity/newQuantity (storefront) and mainStorePreviousQuantity/mainStoreNewQuantity (Main
 * Store) are captured HERE, immediately before/after each item's transfer applies — not recomputed
 * later — so the printed/reprinted request always shows exactly what was true at the moment of
 * fulfillment, even if the product's stock has moved on since. Same "freeze at the moment of the
 * action" discipline as stock-receipt-service.ts's own createStockReceipt. A line dispatched at 0
 * still gets a real (unchanged) before/after pair recorded — never left null — so it reads as
 * "reviewed, nothing shipped" rather than "not yet reviewed".
 */
export async function approveStockRequest(id: string, input: unknown): Promise<StockRequest> {
  requirePermission("stock_requests", "approve");
  const parsed: StockRequestFulfillInput = stockRequestFulfillSchema.parse(input);
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
  const itemById = new Map(items.map((item) => [item.id, item]));
  const mainStore = locationRepository.findMainStoreLocationRow(tenantId);
  if (!mainStore) {
    throw new Error("No Main Store is set up for this business yet");
  }

  const dispatchByItemId = new Map<string, number>();
  for (const entry of parsed.items) {
    const item = itemById.get(entry.itemId);
    if (!item || item.stock_request_id !== id) {
      throw new Error("One of the selected items was not found on this request");
    }
    dispatchByItemId.set(entry.itemId, entry.quantityDispatched);
  }
  // Any item the caller left out of parsed.items dispatches its full requested quantity — matches
  // today's default UI (every line pre-filled with min(requested, available)) and keeps this action
  // usable even if a caller only sends the lines it actually changed.
  for (const item of items) {
    if (!dispatchByItemId.has(item.id)) dispatchByItemId.set(item.id, item.quantity_requested);
  }

  const availableByProduct = new Map(
    computeStockRequestAvailability(tenantId, row.storefront_id).map((r) => [r.productId, r.availableQuantity])
  );
  const problems: string[] = [];
  for (const item of items) {
    const dispatched = dispatchByItemId.get(item.id) ?? 0;
    if (dispatched > item.quantity_requested) {
      problems.push(`"${item.product_name}": can't dispatch more than the ${item.quantity_requested} requested`);
      continue;
    }
    const available = availableByProduct.get(item.product_id) ?? 0;
    if (dispatched > available) {
      problems.push(`"${item.product_name}": only ${available} available at Main Store right now, tried to dispatch ${dispatched}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Can't dispatch as entered — ${problems.join("; ")}. Adjust the quantities and try again.`);
  }

  runInTransaction(() => {
    for (const item of items) {
      const quantityDispatched = dispatchByItemId.get(item.id) ?? 0;
      const previousQuantity = inventoryRepository.findInventoryRow(item.product_id, row.storefront_id)?.quantity ?? 0;
      const mainStorePreviousQuantity = inventoryRepository.findInventoryRow(item.product_id, mainStore.id)?.quantity ?? 0;

      if (quantityDispatched > 0) {
        try {
          distributeMainStoreStockCore({
            tenantId,
            employeeId,
            productId: item.product_id,
            storefrontId: row.storefront_id,
            quantity: quantityDispatched,
            notes: null,
            referenceType: "stock_request_fulfillment",
            referenceId: id
          });
        } catch (err) {
          // distributeMainStoreStockCore's own error already names the product (see its own doc
          // comment) — rethrown as-is rather than prefixed a second time, which used to read as
          // "ProductX: Not enough stock of "ProductX" to distribute...". Only the non-Error fallback
          // case still needs its own message.
          if (err instanceof Error) throw err;
          throw new Error(`${item.product_name}: Failed to fulfil item`);
        }
      }

      stockRequestRepository.updateStockRequestItemFulfillmentRow(item.id, {
        previousQuantity,
        newQuantity: previousQuantity + quantityDispatched,
        mainStorePreviousQuantity,
        mainStoreNewQuantity: mainStorePreviousQuantity - quantityDispatched,
        quantityDispatched
      });
    }

    stockRequestRepository.updateStockRequestStatusRow(id, {
      status: "approved",
      rejectionReason: null,
      fulfillmentNote: parsed.note,
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
    fulfillmentNote: null,
    reviewedBy: employeeId
  });

  return buildStockRequest(id);
}
