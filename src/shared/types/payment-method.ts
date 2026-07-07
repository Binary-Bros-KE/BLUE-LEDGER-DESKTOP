export type PaymentMethodId = string;

export type PaymentMethodSyncStatus = "pending" | "synced" | "syncing" | "error";

export type PaymentMethodInputFields = {
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  requiresReference: boolean;
  sortOrder: number;
};

export type PaymentMethod = PaymentMethodInputFields & {
  id: PaymentMethodId;
  tenantId: string;
  isSystemMethod: boolean;
  createdAt: string;
  updatedAt: string;
  syncStatus: PaymentMethodSyncStatus;
  lastSyncedAt: string | null;
};
