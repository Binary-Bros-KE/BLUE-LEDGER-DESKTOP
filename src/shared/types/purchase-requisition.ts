import type { PurchaseStatus } from "./purchase";

/**
 * A request to BUY stock from a supplier — the gap Stock Requests can't cover for a business with no
 * Main Store (or for anything Main Store simply doesn't carry). Anyone can raise one; an approver
 * (purchase_requisitions:approve — Manager by default) turns it into a normal Purchase, which then
 * goes through the usual order → receive → pay flow. Fully separate from Stock Requests by design.
 *
 *   pending   — waiting for an approver
 *   approved  — converted into purchase `purchaseId` (exactly one purchase per requisition)
 *   rejected  — approver declined, with a reason
 *   cancelled — the requester (or an approver) withdrew it while still pending
 */
export type PurchaseRequisitionStatus = "pending" | "approved" | "rejected" | "cancelled";

export type PurchaseRequisitionItem = {
  id: string;
  /** Null for a free-text line ("a product we don't stock yet") until an approver links it to a real
   * catalog product — every line must be linked before the requisition can become a purchase. */
  productId: string | null;
  /** What the requester typed (free-text lines) or the product's name at request time — kept even
   * after linking, so the requisition always shows what was actually asked for. */
  itemName: string;
  /** Current catalog name/SKU of the linked product, null while unlinked. */
  productName: string | null;
  sku: string | null;
  quantityRequested: number;
  notes: string | null;
};

export type PurchaseRequisitionListItem = {
  id: string;
  requisitionNumber: string;
  storefrontId: string;
  storefrontName: string;
  status: PurchaseRequisitionStatus;
  itemCount: number;
  totalQuantityRequested: number;
  /** Lines still waiting to be linked to a catalog product (free-text items). */
  unlinkedItemCount: number;
  notes: string | null;
  rejectionReason: string | null;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  /** Set once approved — the purchase it became, plus that purchase's live progress so the
   * requester can follow it to "received" without needing Purchases access. */
  purchaseId: string | null;
  purchaseNumber: string | null;
  purchaseStatus: PurchaseStatus | null;
};

export type PurchaseRequisition = PurchaseRequisitionListItem & {
  items: PurchaseRequisitionItem[];
};
