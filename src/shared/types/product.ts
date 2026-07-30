export type ProductId = string;

/** Fixed list, not free text — keeps the field usable as a real dropdown everywhere it appears
 * (create/edit forms, bulk import) instead of accumulating typo'd variants ("Kg", "kgs", "KG"). */
export const UNIT_OF_MEASURE_OPTIONS = [
  { value: "piece", label: "Piece" },
  { value: "pack", label: "Pack" },
  { value: "box", label: "Box" },
  { value: "carton", label: "Carton" },
  { value: "set", label: "Set" },
  { value: "kg", label: "Kilogram (kg)" },
  { value: "g", label: "Gram (g)" },
  { value: "L", label: "Litre (L)" },
  { value: "mL", label: "Millilitre (mL)" },
  { value: "m", label: "Metre (m)" },
  { value: "cm", label: "Centimetre (cm)" },
  { value: "dozen", label: "Dozen" },
  { value: "pair", label: "Pair" },
  { value: "roll", label: "Roll" },
  { value: "bottle", label: "Bottle" },
  { value: "can", label: "Can" },
  { value: "bag", label: "Bag" },
  { value: "sack", label: "Sack" },
  { value: "bundle", label: "Bundle" },
  { value: "tray", label: "Tray" },
  { value: "tube", label: "Tube" },
  { value: "jar", label: "Jar" },
  { value: "bucket", label: "Bucket" },
  { value: "plate", label: "Plate" },
  { value: "sheet", label: "Sheet" }
] as const;

export type UnitOfMeasure = (typeof UNIT_OF_MEASURE_OPTIONS)[number]["value"];

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
  /** Null is a real, expected state — not every product has a known unit yet (especially one
   * created via bulk import from a migration file that never tracked this). */
  unitOfMeasure: UnitOfMeasure | null;
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

/** A narrow, read-only stock summary for one product — deliberately not a per-storefront
 * breakdown, so any role that can see the product catalog can check "do we have this, is there
 * more at Main Store, and how much of that is still unallocated" without exposing other
 * storefronts' own stock levels. */
export type ProductStockSummary = {
  ownLocationName: string | null;
  ownLocationQuantity: number | null;
  mainStoreQuantity: number;
  mainStoreUnallocatedQuantity: number;
};
