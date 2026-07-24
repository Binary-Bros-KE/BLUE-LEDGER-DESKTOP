export type SyncDirection = "push" | "pull";
export type SyncStatus = "queued" | "syncing" | "synced" | "failed" | "conflict";

/** The DESKTOP app's own SQLite table names — matches SERVER's SYNC_ENTITY_NAMES exactly (see
 * SERVER/src/schemas/sync.ts), and matches the literal strings the per-table sync_outbox triggers
 * insert (see migrate.ts migration v34). Extend this — and its cloud-side counterpart — together
 * as later phases add entities. */
export type SyncEntity =
  | "categories"
  | "payment_methods"
  | "riders"
  | "suppliers"
  | "customers"
  | "employees"
  | "roles"
  | "products"
  | "locations"
  | "sales"
  | "expense_categories"
  | "expenses"
  | "salaries"
  | "recurring_bills"
  | "sale_voids"
  | "sale_returns"
  | "quotations"
  | "purchases"
  | "stock_movements"
  | "stock_requests";

export type SyncQueueItem = {
  id: string;
  tenantId: string;
  clientId: string;
  serverId: string | null;
  entity: SyncEntity;
  entityId: string;
  /** No separate "create" vs "update" — the outbox is only ever a breadcrumb saying "this row
   * changed"; sync-engine.ts always re-reads current state at push time and upserts it, so a
   * created-then-edited-before-its-next-sync row naturally coalesces into one push. "delete" is the
   * one genuinely different case (no row left to re-read). */
  operation: "upsert" | "delete";
  direction: SyncDirection;
  status: SyncStatus;
  attemptCount: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Per-entity local-vs-remote row count mismatch — a reconciliation SIGNAL only (see
 * sync-engine.ts's checkDrift()), never something this app auto-resolves. */
export type DriftEntry = { local: number; remote: number };

export type SyncSnapshot = {
  status: "not_activated" | "online" | "offline" | "error";
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastDriftCheckAt: string | null;
  queuedCount: number;
  failedCount: number;
  serverUrl: string | null;
  drift: Partial<Record<SyncEntity, DriftEntry>>;
};

/** Phase 2 — a push that lost the optimistic-lock check (see sync-service.ts's pushRows on the
 * SERVER, and pushBatch's conflict branch in sync-engine.ts). `localSnapshot` is exactly what this
 * device tried to send (the outbox row's own payload_json); `remoteSnapshot` is the server's
 * current row at the moment the conflict was detected — together they're the whole diff, no
 * further fetch needed to render one. */
export type SyncConflictItem = {
  id: string;
  entity: SyncEntity;
  entityId: string;
  label: string;
  localSnapshot: Record<string, unknown>;
  remoteSnapshot: Record<string, unknown>;
  detectedAt: string;
};

export type ConflictResolution = "mine" | "theirs";

/** A natural-key reconciliation that already happened silently (see sync-engine.ts's
 * recordIdAlias/sync_id_aliases) — two devices independently created what turned out to be the same
 * real-world reference-data row (e.g. both seeded a "Cashier" role before either synced), and the
 * duplicate was merged into one instead of colliding. Not a conflict needing a decision — purely
 * informational, so the user isn't left wondering why a role's fields changed on their own. */
export type SyncReconciliationItem = {
  entity: SyncEntity;
  localId: string;
  label: string;
  detectedAt: string;
};

/** One row per synced entity for the Cloud Sync page's always-visible status table — unlike
 * DriftEntry/checkDrift (a reconciliation SIGNAL that only surfaces entities where local/remote
 * actually disagree), this shows every entity's own numbers regardless of match, so "everything's
 * fine" is visible too. `remoteCount` is `null` (never 0) whenever it couldn't be fetched (not
 * activated, offline, timeout) — the UI renders that as "—", not a misleading zero. */
export type EntitySyncOverviewRow = {
  entity: SyncEntity;
  localCount: number;
  remoteCount: number | null;
  pendingCount: number;
  lastSyncedAt: string | null;
};
