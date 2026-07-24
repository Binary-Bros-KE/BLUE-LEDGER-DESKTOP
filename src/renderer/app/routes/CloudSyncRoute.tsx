import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { AlertTriangle, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { SYNC_STATUS_COPY } from "@renderer/shared/lib/sync-status";
import type {
  EntitySyncOverviewRow,
  SyncConflictItem,
  SyncQueueItem,
  SyncReconciliationItem,
  SyncSnapshot
} from "@shared/types/sync";

/** Metadata fields that exist on every conflict-aware payload but aren't meaningful to show as a
 * "your value vs their value" diff row — either pure bookkeeping (id/tenantId/deviceId/syncedAt/
 * baseUpdatedAt) or a timestamp whose difference is already implied by "this is a conflict". */
const DIFF_IGNORED_FIELDS = new Set([
  "id",
  "tenantId",
  "deviceId",
  "syncedAt",
  "baseUpdatedAt",
  "localCreatedAt",
  "localUpdatedAt"
]);

function diffFields(
  local: Record<string, unknown>,
  remote: Record<string, unknown>
): Array<{ key: string; local: unknown; remote: unknown }> {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const rows: Array<{ key: string; local: unknown; remote: unknown }> = [];
  for (const key of keys) {
    if (DIFF_IGNORED_FIELDS.has(key)) continue;
    if (JSON.stringify(local[key]) !== JSON.stringify(remote[key])) {
      rows.push({ key, local: local[key], remote: remote[key] });
    }
  }
  return rows;
}

/** Every synced money field is named `*Cents` and stores an integer cent amount — shown raw here
 * before this fix (e.g. a basic salary of 400,000 rendered as "40000000"), which is exactly why the
 * user's own "Yours"/"Theirs" figures looked 100x too large the moment the diff table started
 * showing real values instead of the empty placeholder (see the "Yours column empty" fix). Keyed
 * off the field name, same convention as DIFF_IGNORED_FIELDS above. */
function formatDiffValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && key.endsWith("Cents")) return formatCents(value);
  return String(value);
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  try {
    return format(new Date(value), "PP p");
  } catch {
    return value;
  }
}

const QUEUE_STATUS_TONE: Record<SyncQueueItem["status"], "warning" | "success" | "danger" | "accent"> = {
  queued: "accent",
  syncing: "warning",
  synced: "success",
  failed: "danger",
  conflict: "danger"
};

export function CloudSyncRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canRunSync = can("cloud_sync", "edit");

  const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null);
  const [queue, setQueue] = useState<SyncQueueItem[] | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflictItem[] | null>(null);
  const [reconciliations, setReconciliations] = useState<SyncReconciliationItem[] | null>(null);
  const [entityOverview, setEntityOverview] = useState<EntitySyncOverviewRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [snapshotResult, queueResult, conflictsResult, reconciliationsResult, entityOverviewResult] =
        await Promise.all([
          window.blueLedger.sync.getSnapshot(),
          window.blueLedger.sync.listQueue({ limit: 25 }),
          window.blueLedger.sync.listConflicts(),
          window.blueLedger.sync.listReconciliations(),
          window.blueLedger.sync.getEntityOverview()
        ]);
      setSnapshot(snapshotResult);
      setQueue(queueResult);
      setConflicts(conflictsResult);
      setReconciliations(reconciliationsResult);
      setEntityOverview(entityOverviewResult);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load sync status"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSyncNow(): Promise<void> {
    setSyncing(true);
    setError(null);
    try {
      const result = await window.blueLedger.sync.runNow();
      setSnapshot(result);
      const [queueResult, conflictsResult, entityOverviewResult] = await Promise.all([
        window.blueLedger.sync.listQueue({ limit: 25 }),
        window.blueLedger.sync.listConflicts(),
        window.blueLedger.sync.getEntityOverview()
      ]);
      setQueue(queueResult);
      setConflicts(conflictsResult);
      setEntityOverview(entityOverviewResult);
    } catch (err) {
      setError(getErrorMessage(err, "Sync failed"));
    } finally {
      setSyncing(false);
    }
  }

  async function handleResolve(id: string, resolution: "mine" | "theirs"): Promise<void> {
    setResolvingId(id);
    setError(null);
    try {
      await window.blueLedger.sync.resolveConflict(id, resolution);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to resolve conflict"));
    } finally {
      setResolvingId(null);
    }
  }

  if (loading || !snapshot || !queue || !conflicts || !reconciliations || !entityOverview) {
    return (
      <div className="mt-8 flex min-h-[420px] items-center justify-center text-muted">
        <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  const statusCopy = SYNC_STATUS_COPY[snapshot.status];
  const driftEntries = Object.entries(snapshot.drift);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mt-6 space-y-5 pb-10"
    >
      <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Blue Ledger Management</p>
            <h2 className="mt-1 text-xl font-extrabold">Cloud Sync</h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Categories, payment methods, riders, suppliers, customers, employees, roles, products, storefronts,
              sales/receipts/invoices, quotations, purchases, sale returns/voids, expenses, salaries,
              recurring bills, stock movements, and stock requests sync automatically — this shows what's
              happened and lets you force a sync right now.
            </p>
          </div>
          {canRunSync && (
            <Button
              type="button"
              onClick={() => void handleSyncNow()}
              disabled={syncing || snapshot.status === "not_activated"}
              className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="mr-2 size-4" aria-hidden="true" />
              )}
              {syncing ? "Syncing..." : "Sync Now"}
            </Button>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label="Status">
            <DashedPill tone={statusCopy.tone} className="mt-1">
              {statusCopy.label}
            </DashedPill>
          </StatTile>
          <StatTile label="Last Push" value={formatDate(snapshot.lastPushAt)} />
          <StatTile label="Last Pull" value={formatDate(snapshot.lastPullAt)} />
          <StatTile label="Last Drift Check" value={formatDate(snapshot.lastDriftCheckAt)} />
          <StatTile label="Queued" value={String(snapshot.queuedCount)} mono />
          <StatTile label="Failed" value={String(snapshot.failedCount)} mono />
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-extrabold">Sync Status by Entity</h2>
        <p className="mt-1 text-xs font-semibold text-muted">
          What's on this device vs. what's in the cloud right now, and what's still waiting to go up.
        </p>

        <div className="mt-4 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-soft text-left text-[11px] font-extrabold uppercase tracking-wider text-muted">
                <th className="px-4 py-2.5">Entity</th>
                <th className="px-4 py-2.5 text-right">Local</th>
                <th className="px-4 py-2.5 text-right">Cloud</th>
                <th className="px-4 py-2.5 text-right">Pending</th>
                <th className="px-4 py-2.5">Last Synced</th>
              </tr>
            </thead>
            <tbody>
              {entityOverview.map((row) => {
                const mismatched = row.remoteCount !== null && row.remoteCount !== row.localCount;
                return (
                  <tr key={row.entity} className="border-b border-line last:border-0 odd:bg-white even:bg-soft/30">
                    <td className="px-4 py-2.5 font-bold">{row.entity}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.localCount}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${mismatched ? "font-bold text-danger" : ""}`}>
                      {row.remoteCount === null ? "—" : row.remoteCount}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${row.pendingCount > 0 ? "font-bold text-warning" : "text-muted"}`}>
                      {row.pendingCount}
                    </td>
                    <td className="px-4 py-2.5 text-muted">{formatDate(row.lastSyncedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {driftEntries.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-bold text-warning">
          <AlertTriangle className="mt-0.5 size-4 flex-none" aria-hidden="true" />
          <div>
            <p>Local and cloud counts don't match for {driftEntries.length} {driftEntries.length === 1 ? "entity" : "entities"}.</p>
            <ul className="mt-1 space-y-0.5 text-xs font-semibold">
              {driftEntries.map(([entity, counts]) => (
                <li key={entity}>
                  {entity}: {counts?.local} local vs {counts?.remote} cloud
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs font-semibold">
              This is a signal to investigate, not something Blue Ledger fixes automatically — contact support if
              it doesn't resolve itself after a manual Sync Now.
            </p>
          </div>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-white p-5 shadow-soft">
          <div className="flex items-center gap-2">
            <GitBranch className="size-5 flex-none text-danger" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-extrabold">
                Conflicts <span className="text-danger">({conflicts.length})</span>
              </h2>
              <p className="mt-0.5 text-xs font-semibold text-muted">
                Edited on two devices before either could sync — pick which version to keep.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {conflicts.map((conflict) => {
              const rows = diffFields(conflict.localSnapshot, conflict.remoteSnapshot);
              const busy = resolvingId === conflict.id;
              return (
                <div key={conflict.id} className="rounded-lg border border-line bg-soft p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-extrabold text-ink">{conflict.label}</p>
                      <p className="text-xs font-semibold text-muted">
                        {conflict.entity} · detected {formatDate(conflict.detectedAt)}
                      </p>
                    </div>
                    {canRunSync && (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleResolve(conflict.id, "theirs")}
                          className="h-9 cursor-pointer border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Keep Theirs
                        </Button>
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleResolve(conflict.id, "mine")}
                          className="h-9 cursor-pointer text-xs disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" /> : null}
                          Keep Mine
                        </Button>
                      </div>
                    )}
                  </div>

                  {rows.length > 0 && (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-white">
                      <table className="w-full min-w-[420px] border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-line text-left font-extrabold uppercase tracking-wider text-muted">
                            <th className="px-3 py-2">Field</th>
                            <th className="px-3 py-2">Yours</th>
                            <th className="px-3 py-2">Theirs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.key} className="border-b border-line last:border-0">
                              <td className="px-3 py-2 font-bold text-ink">{r.key}</td>
                              <td className="px-3 py-2 text-ink">{formatDiffValue(r.key, r.local)}</td>
                              <td className="px-3 py-2 text-ink">{formatDiffValue(r.key, r.remote)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {reconciliations.length > 0 && (
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-extrabold">Auto-Merged Records</h2>
          <p className="mt-1 text-xs font-semibold text-muted">
            Two devices each created one of these before they'd synced with each other — recognized as the
            same real thing (by name/code) and merged automatically instead of creating a duplicate. Nothing
            to do here, just a record of what happened.
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[500px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-soft text-left text-[11px] font-extrabold uppercase tracking-wider text-muted">
                  <th className="px-4 py-2.5">Entity</th>
                  <th className="px-4 py-2.5">Record</th>
                  <th className="px-4 py-2.5">Merged</th>
                </tr>
              </thead>
              <tbody>
                {reconciliations.map((item, index) => (
                  <tr
                    key={`${item.entity}-${item.localId}-${index}`}
                    className="border-b border-line last:border-0 odd:bg-white even:bg-soft/30"
                  >
                    <td className="px-4 py-2.5 font-bold">{item.entity}</td>
                    <td className="px-4 py-2.5 text-ink">{item.label}</td>
                    <td className="px-4 py-2.5 text-muted">{formatDate(item.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-extrabold">Recent Sync Activity</h2>
        <p className="mt-1 text-xs font-semibold text-muted">The last {queue.length} queued/pushed changes.</p>

        <div className="mt-4 overflow-x-auto rounded-lg border border-line">
          {queue.length === 0 ? (
            <div className="flex min-h-[120px] items-center justify-center p-6 text-center text-sm text-muted">
              Nothing has synced yet.
            </div>
          ) : (
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-soft text-left text-[11px] font-extrabold uppercase tracking-wider text-muted">
                  <th className="px-4 py-2.5">Entity</th>
                  <th className="px-4 py-2.5">Record</th>
                  <th className="px-4 py-2.5">Operation</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Attempts</th>
                  <th className="px-4 py-2.5">Last Error</th>
                  <th className="px-4 py-2.5">Updated</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <tr key={item.id} className="border-b border-line last:border-0 odd:bg-white even:bg-soft/30">
                    <td className="px-4 py-2.5 font-bold">{item.entity}</td>
                    <td className="max-w-[180px] truncate px-4 py-2.5 font-mono text-xs text-muted" title={item.entityId}>
                      {item.entityId}
                    </td>
                    <td className="px-4 py-2.5 text-muted">{item.operation}</td>
                    <td className="px-4 py-2.5">
                      <DashedPill tone={QUEUE_STATUS_TONE[item.status]}>{item.status}</DashedPill>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{item.attemptCount}</td>
                    <td className="max-w-[240px] truncate px-4 py-2.5 text-muted" title={item.lastError ?? undefined}>
                      {item.lastError ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted">{formatDate(item.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StatTile({
  label,
  value,
  mono,
  children
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-soft px-3 py-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      {children ?? <p className={`mt-1 truncate text-sm font-bold text-ink ${mono ? "tabular-nums" : ""}`}>{value}</p>}
    </div>
  );
}
