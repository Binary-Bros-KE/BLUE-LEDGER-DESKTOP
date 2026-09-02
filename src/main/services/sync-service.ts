import { getDatabase } from "@main/database/connection";
import {
  getCloudIdentity,
  getDanglingRefCount,
  getEntitySyncOverview as getEntitySyncOverviewFromEngine,
  getNeedsAttentionCount,
  getPullOrphanCount,
  getSyncDiagnostics as getSyncDiagnosticsFromEngine,
  listBlockedRecords as listBlockedRecordsFromEngine,
  listConflicts as listConflictsFromEngine,
  listRecentReconciliations as listRecentReconciliationsFromEngine,
  readSetting,
  repairSync,
  resolveConflict as resolveConflictInEngine,
  resyncOrphanedEntities,
  syncNow,
  type DriftReport
} from "@main/services/sync-engine";
import { API_BASE_URL } from "@main/services/license-service";
import type {
  BlockedSyncRecord,
  ConflictResolution,
  EntitySyncOverviewRow,
  SyncConflictItem,
  SyncDiagnostics,
  SyncQueueItem,
  SyncReconciliationItem,
  SyncRunReport,
  SyncSnapshot
} from "@shared/types/sync";

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

/** "Recent" for online/offline purposes — a few multiples of the coupled sync cycle's own interval
 * (see bootstrap.ts's SYNC_INTERVAL_MS, 20s) so a single missed tick doesn't flip the status to
 * "offline" and back, while still reflecting real connectivity promptly now that this is shown
 * prominently in the persistent header widget (see AppShell.tsx), not just the dedicated Cloud Sync
 * page. Was 5 minutes, sized for the OLD independent 10-minute pull timer — left that stale this
 * long would make "Online" a meaningless label for a device that's actually been offline for
 * several minutes. */
const RECENT_SYNC_WINDOW_MS = 90 * 1000;

export function getSyncSnapshot(): SyncSnapshot {
  const db = getDatabase();
  const queuedCountRow = db
    .prepare("SELECT COUNT(*) FROM sync_outbox WHERE status IN ('queued', 'syncing')")
    .get() as { "COUNT(*)": number };
  const failedCountRow = db
    .prepare("SELECT COUNT(*) FROM sync_outbox WHERE status = 'failed'")
    .get() as { "COUNT(*)": number };

  const lastPushAt = readSetting<string>("sync_last_push_at");
  const lastPullAt = readSetting<string>("sync_last_pull_at");
  const lastDriftCheckAt = readSetting<string>("sync_last_drift_check_at");
  const drift = readSetting<DriftReport>("sync_drift_report") ?? {};
  const failedCount = failedCountRow["COUNT(*)"];

  const status = ((): SyncSnapshot["status"] => {
    if (!getCloudIdentity()) return "not_activated";
    if (failedCount > 0) return "error";
    const mostRecent = [lastPushAt, lastPullAt].filter((v): v is string => v !== null).map((v) => new Date(v).getTime());
    const recentlySynced = mostRecent.some((t) => Date.now() - t < RECENT_SYNC_WINDOW_MS);
    return recentlySynced ? "online" : "offline";
  })();

  return {
    status,
    lastPushAt,
    lastPullAt,
    lastDriftCheckAt,
    queuedCount: queuedCountRow["COUNT(*)"],
    failedCount,
    serverUrl: API_BASE_URL,
    drift,
    orphanedPullCount: getPullOrphanCount(),
    danglingRefCount: getDanglingRefCount(),
    needsAttentionCount: getNeedsAttentionCount(),
    lastRunReport: readSetting<SyncRunReport>("sync_last_run_report")
  };
}

/** Renderer-invokable — the records this device genuinely can't apply, for the Cloud Sync page's
 * "needs your attention" list. */
export function listBlockedRecords(): BlockedSyncRecord[] {
  return listBlockedRecordsFromEngine();
}

/** Renderer-invokable "Sync Now" button — runs a full push+pull+drift-check cycle immediately
 * instead of waiting for the next timer tick (see bootstrap.ts), then returns the fresh snapshot so
 * the UI can update without a second round trip. */
export async function runSyncNow(): Promise<SyncSnapshot> {
  await syncNow();
  return getSyncSnapshot();
}

/** Renderer-invokable "Retry Orphaned Records" button — rewinds every entity that has a stuck row or
 * a dangling link back to a full re-pull, then syncs immediately. */
export async function retryOrphanedRecords(): Promise<SyncSnapshot> {
  resyncOrphanedEntities();
  await syncNow();
  return getSyncSnapshot();
}

/** Renderer-invokable "Repair Sync" button — the force-everything path. Rewinds EVERY entity's pull
 * cursor to the beginning, clears all orphan/dangling bookkeeping, and runs a full cycle. Safe
 * because every apply path is idempotent. */
export async function runRepairSync(): Promise<SyncSnapshot> {
  await repairSync();
  return getSyncSnapshot();
}

/** Renderer-invokable "Copy Diagnostics" button — returns the full local sync state as plain data
 * for the user to paste into a support chat. */
export function getSyncDiagnostics(): SyncDiagnostics {
  return getSyncDiagnosticsFromEngine();
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

export function listConflicts(): SyncConflictItem[] {
  return listConflictsFromEngine();
}

export function listRecentReconciliations(): SyncReconciliationItem[] {
  return listRecentReconciliationsFromEngine();
}

export function resolveConflict(id: string, resolution: ConflictResolution): { success: true } {
  resolveConflictInEngine(id, resolution);
  return { success: true };
}

export async function getEntitySyncOverview(): Promise<EntitySyncOverviewRow[]> {
  return getEntitySyncOverviewFromEngine();
}
