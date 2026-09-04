import type { NotesSection } from "@shared/lib/document-sections";
import type { ProductTaxType } from "./product";
import type { SaleDelivery, SaleServiceCharge } from "./sale";

export type QuotationId = string;
export type QuotationItemId = string;

export const QUOTATION_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "converted", label: "Converted" }
] as const;

export type QuotationStatus = (typeof QUOTATION_STATUS_OPTIONS)[number]["value"];

export type QuotationSyncStatus = "pending" | "synced" | "syncing" | "error";

export type QuotationItem = {
  id: QuotationItemId;
  quotationId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  discountAmountCents: number;
  taxType: ProductTaxType;
  taxAmountCents: number;
  lineTotalCents: number;
  isLocallySourced: boolean;
  /** What THIS shop paid the local supplier for it — null unless isLocallySourced. Never contributes
   * to the customer-facing price, purely a cost figure for Reports. */
  localCostCents: number | null;
  localSupplierId: string | null;
  localSupplierName: string | null;
  /** Same per-line section grouping as SaleItem's own field (shared/types/sale.ts) — see that
   * doc comment and groupItemsBySections (shared/lib/document-sections.ts). */
  sectionLabel: string | null;
  createdAt: string;
};

/** A price offer to a customer — never affects inventory, payments, or financial reports on its own. */
export type Quotation = {
  id: QuotationId;
  tenantId: string;
  quotationNumber: string;
  /** Null means a walk-in quotation — no money/credit is ever at stake for a quote, unlike an
   * invoice, so (unlike Sale's own identical field) this is intentionally selectable in the UI, not
   * just a sync-safety fallback. See QuotationsRoute.tsx's Walk-in Customer picker option. */
  customerId: string | null;
  customerName: string | null;
  locationId: string;
  locationName: string;
  employeeId: string;
  employeeName: string;
  /** Always the live, date-aware status (see computeQuotationStatus) — never a stale stored value. */
  status: QuotationStatus;
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  grandTotalCents: number;
  validUntil: string;
  notes: string | null;
  /** Same additional titled note blocks as Sale["notesSections"]'s own doc comment
   * (shared/types/sale.ts) — the identical concept, defaults to []. */
  notesSections: NotesSection[];
  /** Whether the "Tax Breakdown" section prints/downloads/shares on this specific quotation — see
   * Sale["includeTaxBreakdown"]'s own doc comment (shared/types/sale.ts), the identical concept. */
  includeTaxBreakdown: boolean;
  /** See Sale["includeBusinessInfo"]'s own doc comment (shared/types/sale.ts) — the identical concept. */
  includeBusinessInfo: boolean;
  convertedSaleId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: QuotationSyncStatus;
  lastSyncedAt: string | null;
  items: QuotationItem[];
  serviceCharges: SaleServiceCharge[];
  delivery: SaleDelivery | null;
};

/** Lightweight row for the Quotations list — no line items, just enough to identify and act on it. */
export type QuotationListItem = {
  id: QuotationId;
  quotationNumber: string;
  customerName: string | null;
  locationId: string;
  locationName: string;
  employeeName: string;
  status: QuotationStatus;
  grandTotalCents: number;
  validUntil: string;
  createdAt: string;
  hasDeliveryNote: boolean;
};

/** Aggregate counts for the Quotations dashboard's summary cards. */
export type QuotationSummary = {
  totalQuotations: number;
  draftCount: number;
  sentCount: number;
  acceptedCount: number;
  expiredCount: number;
  rejectedCount: number;
  convertedCount: number;
};

/** One line's live-stock check result, used to warn before completing a conversion. */
export type QuotationStockCheckItem = {
  productId: string;
  productName: string;
  requestedQuantity: number;
  availableQuantity: number;
  sufficient: boolean;
};
