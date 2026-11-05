import { runInTransaction } from "@main/database/connection";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as requisitionRepository from "@main/database/repositories/purchase-requisition-repository";
import {
  getCurrentBranchScope,
  getCurrentEmployeeId,
  getCurrentIsSuperAdmin,
  requirePermission
} from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { createPurchaseWithHook } from "@main/services/purchase-service";
import { assertNotAlreadyDecidedRemotely } from "@main/services/sync-engine";
import { getCurrentTenant } from "@main/services/tenant-service";
import {
  purchaseRequisitionCreateSchema,
  purchaseRequisitionLinkItemSchema,
  purchaseRequisitionRejectSchema,
  purchaseRequisitionUpdateSchema
} from "@shared/schemas/purchase-requisition";
import { isStorefrontType, type LocationType } from "@shared/types/location";
import type {
  PurchaseRequisition,
  PurchaseRequisitionItem,
  PurchaseRequisitionListItem
} from "@shared/types/purchase-requisition";

/** REQ-D{n}-000001, REQ-D{n}-000002, ... */
function generateRequisitionNumber(tenantId: string): string {
  return generateDocumentNumber({
    tenantId,
    prefix: "REQ",
    digits: 6,
    existingNumbers: requisitionRepository.findRequisitionNumberRows(tenantId)
  });
}

function mapListRow(row: requisitionRepository.PurchaseRequisitionRow): PurchaseRequisitionListItem {
  return {
    id: row.id,
    requisitionNumber: row.requisition_number,
    storefrontId: row.storefront_id,
    storefrontName: row.storefront_name,
    status: row.status,
    itemCount: row.item_count,
    totalQuantityRequested: row.total_quantity_requested,
    unlinkedItemCount: row.unlinked_item_count,
    notes: row.notes,
    rejectionReason: row.rejection_reason,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    requestedAt: row.requested_at,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    purchaseId: row.purchase_id,
    purchaseNumber: row.purchase_number,
    purchaseStatus: row.purchase_status
  };
}

function mapItemRow(row: requisitionRepository.PurchaseRequisitionItemRow): PurchaseRequisitionItem {
  return {
    id: row.id,
    productId: row.product_id,
    itemName: row.item_name,
    productName: row.product_name,
    sku: row.sku,
    quantityRequested: row.quantity_requested,
    notes: row.notes
  };
}

/** "Not found" (not a permission error) for a branch-scoped caller reading another storefront's
 * requisition — same convention as stock-request-service.ts's buildStockRequest. */
function requireVisibleRow(id: string): requisitionRepository.PurchaseRequisitionRow {
  const row = requisitionRepository.findRequisitionRowById(id);
  const branchScope = getCurrentBranchScope();
  if (!row || row.tenant_id !== getCurrentTenant().tenantId || (branchScope && row.storefront_id !== branchScope)) {
    throw new Error("Requisition not found");
  }
  return row;
}

function buildRequisition(id: string): PurchaseRequisition {
  const row = requireVisibleRow(id);
  return { ...mapListRow(row), items: requisitionRepository.findRequisitionItemRows(id).map(mapItemRow) };
}

function requirePending(row: requisitionRepository.PurchaseRequisitionRow): void {
  if (row.status !== "pending") {
    throw new Error(`This requisition is already ${row.status}`);
  }
}

function requireEmployeeId(): string {
  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }
  return employeeId;
}

/** Branch-scoped roles see their own storefront's requisitions; an unassigned Super Admin sees all. */
export function listPurchaseRequisitions(): PurchaseRequisitionListItem[] {
  requirePermission("purchase_requisitions", "view");
  return requisitionRepository
    .findAllRequisitionRows(getCurrentTenant().tenantId, getCurrentBranchScope())
    .map(mapListRow);
}

/** Powers approver alerts (sidebar badge, toast, Windows notification) — polled by the renderer, so
 * only pending rows. Gated on "approve": only someone who can act on a requisition is alerted. */
export function listPendingPurchaseRequisitions(): PurchaseRequisitionListItem[] {
  requirePermission("purchase_requisitions", "approve");
  return requisitionRepository
    .findAllRequisitionRows(getCurrentTenant().tenantId, getCurrentBranchScope())
    .filter((row) => row.status === "pending")
    .map(mapListRow);
}

export function getPurchaseRequisition(id: string): PurchaseRequisition {
  requirePermission("purchase_requisitions", "view");
  return buildRequisition(id);
}

/** A branch-scoped requester always requisitions for their own session branch — never trusted from
 * the client. Catalog lines snapshot the product's current name into item_name. */
export function createPurchaseRequisition(input: unknown): PurchaseRequisition {
  requirePermission("purchase_requisitions", "create");
  const parsed = purchaseRequisitionCreateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = requireEmployeeId();

  const storefrontId = getCurrentBranchScope() ?? parsed.storefrontId;
  if (!storefrontId) {
    throw new Error("Choose which storefront this requisition is for");
  }
  const location = locationRepository.findLocationRowById(storefrontId);
  if (!location || location.tenant_id !== tenantId || !isStorefrontType(location.location_type as LocationType)) {
    throw new Error("Storefront not found");
  }

  const lines = parsed.items.map((item) => {
    if (!item.productId) {
      return { productId: null, itemName: item.itemName, quantity: item.quantity, notes: item.notes };
    }
    const product = productRepository.findProductRowById(item.productId);
    if (!product || product.tenant_id !== tenantId) {
      throw new Error("One of the selected products was not found");
    }
    return { productId: product.id, itemName: product.name, quantity: item.quantity, notes: item.notes };
  });

  const requisitionNumber = generateRequisitionNumber(tenantId);
  const requisitionId = runInTransaction(() => {
    const id = requisitionRepository.insertRequisitionRow({
      tenantId,
      requisitionNumber,
      storefrontId,
      notes: parsed.notes,
      requestedBy: employeeId
    });
    for (const line of lines) {
      requisitionRepository.insertRequisitionItemRow({
        requisitionId: id,
        productId: line.productId,
        itemName: line.itemName,
        quantityRequested: line.quantity,
        notes: line.notes
      });
    }
    return id;
  });

  return buildRequisition(requisitionId);
}

/** Client rule: a requisition belongs to whoever raised it — only they (or a Super Admin) may edit or
 * withdraw it. Approvers act on it through Approve/Reject instead. */
function requireOwnerOrSuperAdmin(row: requisitionRepository.PurchaseRequisitionRow, employeeId: string, verb: string): void {
  if (row.requested_by !== employeeId && !getCurrentIsSuperAdmin()) {
    throw new Error(`Only the person who raised this requisition (or a Super Admin) can ${verb} it`);
  }
}

/** Rewrites a PENDING requisition's notes and lines (requester or Super Admin). Catalog lines
 * re-snapshot the product's current name; a free-text line keeps what was typed. */
export function updatePurchaseRequisition(id: string, input: unknown): PurchaseRequisition {
  requirePermission("purchase_requisitions", "view");
  const parsed = purchaseRequisitionUpdateSchema.parse(input);
  const employeeId = requireEmployeeId();
  const row = requireVisibleRow(id);
  requirePending(row);
  requireOwnerOrSuperAdmin(row, employeeId, "edit");

  const lines = parsed.items.map((item) => {
    if (!item.productId) {
      return { id: item.id ?? null, productId: null, itemName: item.itemName, quantityRequested: item.quantity, notes: item.notes };
    }
    const product = productRepository.findProductRowById(item.productId);
    if (!product || product.tenant_id !== row.tenant_id) {
      throw new Error("One of the selected products was not found");
    }
    return { id: item.id ?? null, productId: product.id, itemName: product.name, quantityRequested: item.quantity, notes: item.notes };
  });

  runInTransaction(() => requisitionRepository.replaceRequisitionContentRows(id, parsed.notes, lines));
  return buildRequisition(id);
}

export async function cancelPurchaseRequisition(id: string): Promise<PurchaseRequisition> {
  requirePermission("purchase_requisitions", "view");
  const employeeId = requireEmployeeId();
  const row = requireVisibleRow(id);
  requirePending(row);
  requireOwnerOrSuperAdmin(row, employeeId, "cancel");
  await assertNotAlreadyDecidedRemotely("purchase_requisitions", id, "pending");

  requisitionRepository.updateRequisitionDecisionRow(id, {
    status: "cancelled",
    rejectionReason: null,
    purchaseId: null,
    reviewedBy: employeeId
  });
  return buildRequisition(id);
}

export async function rejectPurchaseRequisition(id: string, input: unknown): Promise<PurchaseRequisition> {
  requirePermission("purchase_requisitions", "approve");
  const parsed = purchaseRequisitionRejectSchema.parse(input);
  const employeeId = requireEmployeeId();
  const row = requireVisibleRow(id);
  requirePending(row);
  await assertNotAlreadyDecidedRemotely("purchase_requisitions", id, "pending");

  requisitionRepository.updateRequisitionDecisionRow(id, {
    status: "rejected",
    rejectionReason: parsed.reason,
    purchaseId: null,
    reviewedBy: employeeId
  });
  return buildRequisition(id);
}

/** Links a line (normally a free-text one) to a catalog product, ahead of conversion. Pending only —
 * an approved requisition's lines are history. */
export function linkPurchaseRequisitionItem(id: string, input: unknown): PurchaseRequisition {
  requirePermission("purchase_requisitions", "approve");
  const parsed = purchaseRequisitionLinkItemSchema.parse(input);
  const row = requireVisibleRow(id);
  requirePending(row);

  const item = requisitionRepository.findRequisitionItemRows(id).find((entry) => entry.id === parsed.itemId);
  if (!item) {
    throw new Error("That line was not found on this requisition");
  }
  const product = productRepository.findProductRowById(parsed.productId);
  if (!product || product.tenant_id !== row.tenant_id) {
    throw new Error("Product not found");
  }

  requisitionRepository.updateRequisitionItemProductRow(id, parsed.itemId, product.id);
  return buildRequisition(id);
}

/**
 * Approves by turning the requisition into a normal Purchase — `purchaseInput` is exactly what the
 * Purchase form would send for a new purchase (supplier, costs, tax, shipping, ...), so every
 * purchase rule (createPurchase's validation, "ordered" price sync, shipping expense) applies
 * unchanged. The destination is always the requisition's own storefront, never the client's choice.
 * The approver may adjust lines/quantities in that form — the requisition keeps what was ASKED for,
 * the purchase records what was actually ordered.
 *
 * Purchase + requisition status commit in ONE transaction (createPurchaseWithHook), so there's never
 * a purchase without its approved requisition or vice versa. Requires purchases:create too — the
 * approver is creating a purchase.
 */
export async function approvePurchaseRequisition(id: string, purchaseInput: unknown): Promise<PurchaseRequisition> {
  requirePermission("purchase_requisitions", "approve");
  const employeeId = requireEmployeeId();
  const row = requireVisibleRow(id);
  requirePending(row);

  const unlinked = requisitionRepository.findRequisitionItemRows(id).filter((item) => !item.product_id);
  if (unlinked.length > 0) {
    throw new Error(
      `Link every new item to a product before converting — still unlinked: ${unlinked.map((item) => `"${item.item_name}"`).join(", ")}`
    );
  }
  await assertNotAlreadyDecidedRemotely("purchase_requisitions", id, "pending");

  const base = (purchaseInput && typeof purchaseInput === "object" ? purchaseInput : {}) as Record<string, unknown>;
  const notes = typeof base.notes === "string" && base.notes.trim() ? base.notes : `From requisition ${row.requisition_number}`;

  createPurchaseWithHook({ ...base, locationId: row.storefront_id, notes }, (purchaseId) => {
    // Re-read inside the transaction: a pull may have decided this requisition since the checks above.
    const fresh = requisitionRepository.findRequisitionRowById(id);
    if (!fresh || fresh.status !== "pending") {
      throw new Error(`This requisition is already ${fresh?.status ?? "gone"} — no purchase was created`);
    }
    requisitionRepository.updateRequisitionDecisionRow(id, {
      status: "approved",
      rejectionReason: null,
      purchaseId,
      reviewedBy: employeeId
    });
  });

  return buildRequisition(id);
}
