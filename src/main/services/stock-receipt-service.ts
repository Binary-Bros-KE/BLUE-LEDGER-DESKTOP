import { runInTransaction } from "@main/database/connection";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as mainStoreAllocationRepository from "@main/database/repositories/main-store-allocation-repository";
import * as stockReceiptRepository from "@main/database/repositories/stock-receipt-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { deriveUnallocatedQuantity, distributeMainStoreStockCore } from "@main/services/main-store-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { stockReceiptCreateSchema, type StockReceiptCreateInput } from "@shared/schemas/stock-receipt";
import { isStorefrontType, type LocationType } from "@shared/types/location";
import type { StockReceipt, StockReceiptItem, StockReceiptListItem } from "@shared/types/stock-receipt";

/** GRN-D{n}-000001, GRN-D{n}-000002, ... — "Goods Received Note", the standard term for this document. */
function generateStockReceiptNumber(tenantId: string): string {
  return generateDocumentNumber({
    tenantId,
    prefix: "GRN",
    digits: 6,
    existingNumbers: stockReceiptRepository.findMaxStockReceiptNumberRow(tenantId)
  });
}

function mapListRow(row: stockReceiptRepository.StockReceiptRow): StockReceiptListItem {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    locationId: row.location_id,
    locationName: row.location_name,
    allocationStorefrontId: row.allocation_storefront_id,
    allocationStorefrontName: row.allocation_storefront_name,
    receivedByName: row.received_by_name,
    itemCount: row.item_count,
    totalQuantityReceived: row.total_quantity_received,
    sourceType: row.is_transfer > 0 ? "transfer" : "purchase",
    notes: row.notes,
    createdAt: row.created_at
  };
}

function mapItemRow(row: stockReceiptRepository.StockReceiptItemRow): StockReceiptItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    quantityReceived: row.quantity_received,
    previousQuantity: row.previous_quantity,
    newQuantity: row.new_quantity,
    mainStorePreviousQuantity: row.main_store_previous_quantity,
    mainStoreNewQuantity: row.main_store_new_quantity
  };
}

/** Throws "not found" (rather than a permission error) for a branch-scoped caller trying to read a
 * different location's receipt, so a Cashier probing ids can't tell the difference from a typo —
 * same convention as stock-request-service.ts's own buildStockRequest. */
function buildStockReceipt(id: string): StockReceipt {
  const row = stockReceiptRepository.findStockReceiptRowById(id);
  if (!row) {
    throw new Error("Stock receipt not found");
  }
  const branchScope = getCurrentBranchScope();
  if (branchScope && row.location_id !== branchScope) {
    throw new Error("Stock receipt not found");
  }
  const items = stockReceiptRepository.findStockReceiptItemRows(id).map(mapItemRow);
  return { ...mapListRow(row), items };
}

/** Branch-scoped roles (Cashier/Manager) only ever see their own storefront's receipts; a null branch
 * scope (Storekeeper/Super Admin, or anyone receiving into Main Store which nobody is "scoped" to)
 * sees every location's, same convention as every other branch-scoped read in this app. */
export function listStockReceipts(): StockReceiptListItem[] {
  requirePermission("inventory", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return stockReceiptRepository.findAllStockReceiptRows(tenantId, locationId).map(mapListRow);
}

export function getStockReceipt(id: string): StockReceipt {
  requirePermission("inventory", "view");
  return buildStockReceipt(id);
}

/** Receives many products in one batch — the bulk counterpart to the single-item Receive tab in
 * MainStoreStockModal, sharing its exact same "Into Main Store (pick a bucket) vs Direct to
 * Storefront vs Transfer from Main Store" destination model, just applied once for the whole batch
 * instead of per item. The transfer destination is the bulk counterpart of MainStoreStockModal's own
 * Transfer tab (distributeFromMainStore) — same allocated-then-unallocated sourcing, just looped
 * across many products atomically instead of one distributeFromMainStore call per product, which was
 * the actual field complaint this batch mode exists to fix (transferring a multi-product delivery one
 * product at a time).
 *
 * previousQuantity/newQuantity (and, for a transfer, mainStorePreviousQuantity/mainStoreNewQuantity)
 * are captured HERE, immediately before each item's movement applies — not recomputed later — so the
 * printed/reprinted document always shows exactly what was true at the moment of receiving, even if
 * the product's stock has moved on since. previousQuantity/newQuantity always describe the RECEIVING
 * location's own on-hand stock (mirroring the "direct to storefront" case even for a transfer);
 * mainStorePreviousQuantity/mainStoreNewQuantity are the OTHER side of a transfer specifically — null
 * for a plain purchase, where there's no Main Store side to show. */
export function createStockReceipt(input: unknown): StockReceipt {
  requirePermission("inventory", "edit");
  const parsed: StockReceiptCreateInput = stockReceiptCreateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }

  let targetLocationId: string;
  let allocationStorefrontId: string | null;
  // Only ever resolved for main_store_transfer — needed to capture the Main Store's OWN before/after
  // quantity per item, alongside the receiving storefront's own (targetLocationId, below).
  let mainStoreLocationId: string | null = null;

  if (parsed.destination === "main_store") {
    // Same boundary role-service.ts's own DEFAULT_SYSTEM_ROLES comment describes: Manager keeps
    // "inventory" (their own storefront's stock) but deliberately never gets "main_store" — that
    // split only means something if it's also enforced here, not just left to the UI hiding the
    // option. requirePermission("inventory", "edit") above is not enough on its own.
    requirePermission("main_store", "edit");
    const mainStore = locationRepository.findMainStoreLocationRow(tenantId);
    if (!mainStore) {
      throw new Error("No Main Store is set up for this business yet");
    }
    targetLocationId = mainStore.id;
    allocationStorefrontId = parsed.allocationStorefrontId ?? null;
    if (allocationStorefrontId) {
      const bucket = locationRepository.findLocationRowById(allocationStorefrontId);
      if (!bucket || bucket.tenant_id !== tenantId || !isStorefrontType(bucket.location_type as LocationType)) {
        throw new Error("Storefront not found");
      }
    }
  } else {
    // "storefront" and "main_store_transfer" resolve their target the same way — the only
    // difference is which movement each item's loop iteration below actually applies.
    if (parsed.destination === "main_store_transfer") {
      requirePermission("stock_transfers", "create");
      const mainStore = locationRepository.findMainStoreLocationRow(tenantId);
      if (!mainStore) {
        throw new Error("No Main Store is set up for this business yet");
      }
      mainStoreLocationId = mainStore.id;
    }
    const branchScope = getCurrentBranchScope();
    const storefrontId = branchScope ?? parsed.locationId;
    if (!storefrontId) {
      throw new Error("Choose which storefront this receipt is for");
    }
    const location = locationRepository.findLocationRowById(storefrontId);
    if (!location || location.tenant_id !== tenantId || !isStorefrontType(location.location_type as LocationType)) {
      throw new Error("Storefront not found");
    }
    targetLocationId = storefrontId;
    allocationStorefrontId = null;
  }

  const receiptNumber = generateStockReceiptNumber(tenantId);
  let receiptId = "";

  runInTransaction(() => {
    receiptId = stockReceiptRepository.insertStockReceiptRow({
      tenantId,
      receiptNumber,
      locationId: targetLocationId,
      allocationStorefrontId,
      notes: parsed.notes,
      receivedBy: employeeId
    });

    for (const item of parsed.items) {
      // A named allocationStorefrontId still reads a real, independently-synced bucket row — but
      // "unallocated" (allocationStorefrontId null) is never stored any more, so it has to be derived
      // the same way applyValidatedStockMovement itself derives it below (see that function's own
      // doc comment, and migration 77). Reading a stored storefront_id IS NULL row here would always
      // return 0 post-migration, silently printing the wrong "previous quantity" on the receipt.
      const previousQuantity =
        parsed.destination === "main_store"
          ? (allocationStorefrontId
              ? (mainStoreAllocationRepository.findAllocationRow(item.productId, allocationStorefrontId)?.quantity ?? 0)
              : deriveUnallocatedQuantity(item.productId, targetLocationId))
          : (inventoryRepository.findInventoryRow(item.productId, targetLocationId)?.quantity ?? 0);

      // Main Store's own physical on-hand quantity for this product, captured BEFORE
      // distributeMainStoreStockCore below draws it down — same "freeze at the moment of receiving"
      // discipline as previousQuantity/newQuantity above, just for the other side of the transfer.
      const mainStorePreviousQuantity =
        mainStoreLocationId != null ? (inventoryRepository.findInventoryRow(item.productId, mainStoreLocationId)?.quantity ?? 0) : null;

      if (parsed.destination === "main_store_transfer") {
        // Draws from Main Store (this storefront's own earmarked allocation first, then unallocated
        // — throws if both are insufficient) and credits the storefront, atomically, inside this
        // same transaction — the exact core distributeFromMainStore itself calls, just reused here
        // for a whole batch instead of one product.
        distributeMainStoreStockCore({
          tenantId,
          employeeId,
          productId: item.productId,
          storefrontId: targetLocationId,
          quantity: item.quantityReceived,
          notes: parsed.notes,
          referenceType: "stock_receipt",
          referenceId: receiptId
        });
      } else {
        applyValidatedStockMovement(
          {
            productId: item.productId,
            locationId: targetLocationId,
            movementType: "purchase",
            quantityChange: item.quantityReceived,
            referenceType: "stock_receipt",
            referenceId: receiptId,
            performedBy: employeeId,
            notes: parsed.notes,
            ...(parsed.destination === "main_store" ? { allocationStorefrontId } : {})
          },
          tenantId
        );
      }

      stockReceiptRepository.insertStockReceiptItemRow({
        stockReceiptId: receiptId,
        productId: item.productId,
        quantityReceived: item.quantityReceived,
        previousQuantity,
        newQuantity: previousQuantity + item.quantityReceived,
        mainStorePreviousQuantity,
        mainStoreNewQuantity: mainStorePreviousQuantity != null ? mainStorePreviousQuantity - item.quantityReceived : null
      });
    }
  });

  return buildStockReceipt(receiptId);
}
