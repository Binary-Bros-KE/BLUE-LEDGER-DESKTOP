export type SyncDirection = "push" | "pull";
export type SyncStatus = "queued" | "syncing" | "synced" | "failed" | "conflict";
export type SyncEntity =
  | "tenant"
  | "workstation"
  | "product"
  | "customer"
  | "sale"
  | "payment"
  | "stock_movement"
  | "setting";

export type SyncQueueItem = {
  id: string;
  tenantId: string;
  clientId: string;
  serverId: string | null;
  entity: SyncEntity;
  entityId: string;
  operation: "create" | "update" | "delete";
  direction: SyncDirection;
  status: SyncStatus;
  attemptCount: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncSnapshot = {
  status: "offline" | "online" | "checking" | "error";
  lastPushAt: string | null;
  lastPullAt: string | null;
  queuedCount: number;
  failedCount: number;
  serverUrl: string | null;
};
