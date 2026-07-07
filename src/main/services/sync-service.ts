import { getDatabase } from "@main/database/connection";
import type { SyncQueueItem, SyncSnapshot } from "@shared/types/sync";

type SyncRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  server_id: string | null;
  entity: SyncQueueItem["entity"];
  entity_id: string;
  operation: SyncQueueItem["operation"];
  direction: SyncQueueItem["direction"];
  status: SyncQueueItem["status"];
  attempt_count: number;
  payload_json: string;
  idempotency_key: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export function getSyncSnapshot(): SyncSnapshot {
  const db = getDatabase();
  const queuedCountRow = db
    .prepare("SELECT COUNT(*) FROM sync_outbox WHERE status IN ('queued', 'syncing')")
    .get() as { "COUNT(*)": number };
  const failedCountRow = db
    .prepare("SELECT COUNT(*) FROM sync_outbox WHERE status = 'failed'")
    .get() as { "COUNT(*)": number };

  return {
    status: "offline",
    lastPushAt: null,
    lastPullAt: null,
    queuedCount: queuedCountRow["COUNT(*)"],
    failedCount: failedCountRow["COUNT(*)"],
    serverUrl: process.env.BLUE_LEDGER_SYNC_URL ?? null
  };
}

export function listSyncQueue(limit = 20): SyncQueueItem[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM sync_outbox ORDER BY created_at DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 100)) as SyncRow[];

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    clientId: row.client_id,
    serverId: row.server_id,
    entity: row.entity,
    entityId: row.entity_id,
    operation: row.operation,
    direction: row.direction,
    status: row.status,
    attemptCount: row.attempt_count,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    idempotencyKey: row.idempotency_key,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}
