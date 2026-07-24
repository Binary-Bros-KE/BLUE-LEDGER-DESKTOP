import { formatDistanceToNowStrict } from "date-fns";
import type { SyncSnapshot } from "@shared/types/sync";

/** Shared between the full Cloud Sync page and the persistent header widget (AppShell) — one
 * source of truth for what each status means and how it's colored. */
export const SYNC_STATUS_COPY: Record<SyncSnapshot["status"], { label: string; tone: "warning" | "success" | "danger" | "accent" }> = {
  not_activated: { label: "Not Activated", tone: "warning" },
  online: { label: "Online", tone: "success" },
  offline: { label: "Offline", tone: "accent" },
  error: { label: "Sync Errors", tone: "danger" }
};

/** "2m ago" / "Just now" — compact enough for the header widget's limited width, unlike the full
 * date CloudSyncRoute shows in its own stat tiles. */
export function formatRelativeSyncTime(value: string | null): string {
  if (!value) return "Never synced";
  try {
    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 30_000) return "Just now";
    return `${formatDistanceToNowStrict(date)} ago`;
  } catch {
    return "Unknown";
  }
}
