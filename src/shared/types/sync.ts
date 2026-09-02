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
  | "supplier_balance_entries"
  | "customers"
  | "employees"
  | "roles"
  | "products"
  | "locations"
  | "working_hours"
  | "sales"
  | "expense_categories"
  | "expenses"
  | "salaries"
  | "recurring_bills"
  | "sale_voids"
  | "sale_returns"
  | "invoice_cancellations"
  | "quotations"
  | "purchases"
  | "stock_movements"
  | "stock_requests"
  | "stock_receipts"
  | "main_store_allocations"
  | "borrows";

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

/** One-line-per-run summary of what the last full sync cycle actually moved — surfaced on the Cloud
 * Sync page so "Sync Now" reports a concrete result ("pulled 1,204 changes, reconnected 3 late
 * references, 0 blocked") instead of a spinner that returns an identical-looking snapshot. `recovered`
 * = rows that failed their first apply because a referenced row hadn't arrived, then succeeded once
 * this device fetched that parent from the cloud on demand. `dangling` = rows applied with a link
 * left unconnected (the cloud had no copy of the parent either); they reconnect on their own when it
 * turns up. `orphaned` = rows that couldn't be applied even then (a genuine structural problem worth
 * the diagnostics export) — retried every cycle, never permanently skipped. */
export type SyncRunReport = {
  startedAt: string;
  finishedAt: string | null;
  pulled: number;
  recovered: number;
  dangling: number;
  orphaned: number;
  pushed: number;
  pushFailed: number;
  pushDeferred: number;
};

export type SyncSnapshot = {
  status: "not_activated" | "online" | "offline" | "error";
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastDriftCheckAt: string | null;
  queuedCount: number;
  failedCount: number;
  serverUrl: string | null;
  drift: Partial<Record<SyncEntity, DriftEntry>>;
  /** Rows that couldn't be applied to this device at all yet (post-2026 pipeline: a genuine
   * structural problem, not a late dependency — those now self-recover). Retried every cycle. */
  orphanedPullCount: number;
  /** Rows that ARE fully on this device but have one link pointing at something not here yet — a
   * benign, self-healing state, shown only so it's explainable rather than mysterious. */
  danglingRefCount: number;
  /** Of the orphaned rows, how many actually need a person — a real data conflict (same phone on two
   * devices, a CHECK/NOT-NULL problem) that auto-repair can't fix. This is the only count worth a
   * phone call; everything else is self-healing or being auto-repaired. */
  needsAttentionCount: number;
  lastRunReport: SyncRunReport | null;
};

/** One record this device can't apply, after auto-repair has had its shot — for the Cloud Sync
 * page's "needs your attention" list. `autoRecovering` true means a linked record is still catching
 * up (nothing to do); false means a human must resolve it on the device that has the row. */
export type BlockedSyncRecord = {
  entity: SyncEntity;
  rowId: string;
  label: string;
  reason: string;
  autoRecovering: boolean;
};

/** Everything needed to diagnose a stuck sync from a field report — copied to the clipboard as JSON
 * by the "Copy Diagnostics" button so a client can paste it into a chat instead of anyone needing
 * to open a dev console on their machine. Deliberately plain data, no PII beyond row ids. */
export type SyncDiagnostics = {
  generatedAt: string;
  appVersion: string;
  serverUrl: string | null;
  activated: boolean;
  tenantId: string | null;
  deviceId: string | null;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastDriftCheckAt: string | null;
  lastRunReport: SyncRunReport | null;
  cursors: Partial<Record<SyncEntity, string>>;
  outboxCounts: { queued: number; failed: number; conflict: number; synced: number };
  outboxProblems: Array<{
    entity: SyncEntity;
    entityId: string;
    status: string;
    attemptCount: number;
    lastError: string | null;
    updatedAt: string;
  }>;
  pullOrphans: Array<{
    entity: SyncEntity;
    rowId: string;
    attempts: number;
    lastError: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
  danglingRefs: Array<{
    entity: SyncEntity;
    rowId: string;
    refEntity: SyncEntity;
    refId: string;
    attempts: number;
    firstSeenAt: string;
  }>;
  /** Entities the app has scoped-auto-repaired (rewound + re-pulled) without anyone asking — shows
   * the recovery machinery is actually running so a "stuck" report can be judged against what it's
   * already tried. */
  autoRepairs: Array<{ entity: SyncEntity; attempts: number; lastAt: string }>;
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
