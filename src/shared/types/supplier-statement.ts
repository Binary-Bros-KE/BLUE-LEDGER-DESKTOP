import type { PurchasePaymentStatus } from "./purchase";

export type StatementPurchaseLine = {
  id: string;
  purchaseNumber: string;
  orderedAt: string | null;
  grandTotalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  paymentStatus: PurchasePaymentStatus;
};

/** A supplier's "Statement of Account" — every purchase order we haven't fully paid off yet, across
 * every storefront, with running totals. Mirrors CustomerStatementViewModel exactly (same "purely
 * computed from existing rows, no table of its own" reasoning — see
 * purchase-repository.ts's findOutstandingPurchaseRowsForSupplier), just for what WE owe a supplier
 * instead of what a customer owes US. DESKTOP-only (view/Print/PDF) — unlike Customer Statement,
 * deliberately has no Share/public-link capability, since this is an internal AP document, not
 * something routinely sent to the supplier over WhatsApp. */
export type SupplierStatementViewModel = {
  businessName: string;
  physicalAddress: string | null;
  primaryPhone: string | null;
  currency: string;
  supplierId: string;
  supplierName: string;
  supplierPhone: string;
  supplierEmail: string | null;
  /** Null when the supplier has no credit limit set on file — the statement simply omits the block. */
  creditLimitCents: number | null;
  generatedAt: string;
  purchases: StatementPurchaseLine[];
  totalOrderedCents: number;
  totalPaidCents: number;
  totalOutstandingCents: number;
};
