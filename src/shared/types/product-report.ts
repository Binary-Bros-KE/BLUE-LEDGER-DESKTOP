import type { DateRangeInput, SalesTransactionKind } from "./report";

export type ProductPerformanceRow = {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  quantitySold: number;
  revenueCents: number;
  costCents: number;
  profitCents: number;
};

/** A product ranked by how little it's moved in the selected period — sorted
 * worst first (fewest units sold, longest idle). `lastSoldAt`/`daysSinceLastSale`
 * are `null` for a product that has never had a single qualifying sale. */
export type SlowMovingProductRow = {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  quantitySoldInPeriod: number;
  revenueCentsInPeriod: number;
  lastSoldAt: string | null;
  daysSinceLastSale: number | null;
};

export type ProductsPerformanceReport = {
  bestSelling: ProductPerformanceRow[];
  slowMoving: SlowMovingProductRow[];
};

export type ProductSalesHistoryEntry = {
  saleItemId: string;
  occurredAt: string;
  documentNumber: string | null;
  kind: SalesTransactionKind;
  locationName: string;
  customerName: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type ProductSalesHistoryInput = {
  productId: string;
};

export type { DateRangeInput };
