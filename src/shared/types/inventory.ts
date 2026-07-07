export type InventorySyncStatus = "pending" | "synced" | "syncing" | "error";

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
