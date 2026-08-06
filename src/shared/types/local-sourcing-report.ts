export type LocalSourcingSupplierTotal = {
  supplierId: string | null;
  supplierName: string;
  revenueCents: number;
  costCents: number;
  netMarginCents: number;
  lineCount: number;
};

export type LocalSourcingTopProductRow = {
  productId: string;
  productName: string;
  sku: string;
  quantitySold: number;
  revenueCents: number;
  costCents: number;
  netMarginCents: number;
};

/** Sales built from stock bought on the spot from another shop rather than this shop's own
 * inventory — see sale_items.is_locally_sourced. revenueCents is what the customer paid
 * (lineTotalCents); costCents is what this shop paid the local supplier for it. */
export type LocalSourcingReport = {
  totalRevenueCents: number;
  totalCostCents: number;
  totalNetMarginCents: number;
  lineCount: number;
  bySupplier: LocalSourcingSupplierTotal[];
  topProducts: LocalSourcingTopProductRow[];
};
