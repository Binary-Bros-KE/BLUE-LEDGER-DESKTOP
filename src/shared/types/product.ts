export type ProductId = string;

export type ProductStatus = "active" | "inactive";

export type ProductSyncStatus = "pending" | "synced" | "syncing" | "error";

export type ProductOpeningStockEntry = {
  locationId: string;
  quantity: number;
};

export type ProductInputFields = {
  sku: string;
  barcode: string | null;
  supplierSku: string | null;
  name: string;
  shortName: string | null;
  description: string | null;
  categoryId: string | null;
  /** Which storefront this product belongs to — null means it's available to every storefront ("All"). */
  storefrontId: string | null;
  buyingPriceCents: number;
  sellingPriceCents: number;
  wholesalePriceCents: number | null;
  wholesaleMinQuantity: number;
  minimumPriceCents: number | null;
  taxRate: number;
  reorderLevel: number;
  trackStock: boolean;
  allowNegativeStock: boolean;
  imagePath: string | null;
};

export type Product = ProductInputFields & {
  id: ProductId;
  tenantId: string;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  syncStatus: ProductSyncStatus;
  lastSyncedAt: string | null;
};

/** Product row enriched with catalog-list-only aggregates, computed via joins. */
export type ProductListItem = Product & {
  categoryName: string | null;
  categoryColor: string | null;
  totalStock: number;
};
