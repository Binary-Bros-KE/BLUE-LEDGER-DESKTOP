export type InventorySyncStatus = "pending" | "synced" | "syncing" | "error";

/** A single product's stock balance at one location — used by the POS screen to show available stock. */
export type LocationStockLevel = {
  productId: string;
  quantity: number;
};

export type InventoryBalance = {
  id: string | null;
  tenantId: string;
  productId: string;
  locationId: string;
  locationName: string;
  locationCode: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  updatedAt: string | null;
  syncStatus: InventorySyncStatus | null;
  lastSyncedAt: string | null;
};
