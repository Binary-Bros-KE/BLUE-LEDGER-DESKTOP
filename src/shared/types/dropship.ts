/** What a dropshipping tenant's device knows about its supplier-linked products. Empty for every
 * other tenant. See SERVER's lib/dropship-links.ts. */
export type DropshipSupplierInfo = {
  name: string;
  /** When this supplier's devices last reached the server — how fresh its stock figure is. */
  asOf: string | null;
};

export type DropshipState = {
  /** productId -> supplier name */
  links: Record<string, string>;
  suppliers: DropshipSupplierInfo[];
};

/** "Supplier Price Changes" report — SERVER's services/dropship-report-service.ts, fetched live. */
export type DropshipPriceReportQuery = {
  startDate: string;
  endDate: string;
  search?: string;
  /** The supplier's selling price went up / down. */
  direction?: "all" | "raised" | "lowered";
  /** This store's prices changed with it / stayed the same. */
  outcome?: "all" | "updated" | "kept";
  offset?: number;
};

export type DropshipPriceReportRow = {
  id: string;
  at: string;
  supplierName: string;
  productId: string;
  productName: string;
  sku: string | null;
  /** supplier_change — the supplier changed a price; rule_applied — the price rule re-priced it. */
  kind: "supplier_change" | "rule_applied";
  /** [before, after]; null unless this store follows the supplier's prices. */
  supplierBuyingCents: [number, number] | null;
  supplierSellingCents: [number, number];
  buyingCents: [number, number];
  sellingCents: [number, number];
  outcome: "updated" | "kept";
};

export type DropshipPriceReport = {
  currency: string;
  startDate: string;
  endDate: string;
  suppliers: Array<{ name: string; followPrices: boolean; sellingMarkupBp: number; priceRoundingCents: number }>;
  summary: { supplierChanges: number; raised: number; lowered: number; updated: number; kept: number; ruleApplied: number };
  rows: DropshipPriceReportRow[];
  total: number;
};
