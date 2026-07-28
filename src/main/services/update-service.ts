import electron from "electron";
import { autoUpdater } from "electron-updater";
import { API_BASE_URL } from "@main/services/license-service";

const { app } = electron;

/**
 * Auto-update via electron-updater's "generic" provider — SERVER serves the built NSIS installer +
 * latest.yml as plain static files (see SERVER's app.ts `/releases` route), no publish/upload
 * pipeline involved. Downloads happen silently in the background the moment a newer version is
 * found; the renderer polls getUpdateStatus() (same pattern as useSyncStatusWidget.ts) and shows a
 * "Restart & Update" button once status is "downloaded" — never a forced interruption mid-shift.
 * autoInstallOnAppQuit is the fallback for a cashier who never clicks that button: the update still
 * applies the next time they close the app normally at end of day.
 */

export type UpdateStatus = "idle" | "checking" | "downloading" | "downloaded" | "not-available" | "error";

type UpdateState = {
  status: UpdateStatus;
  version: string | null;
  error: string | null;
};

let state: UpdateState = { status: "idle", version: null, error: null };
let configured = false;

/** Only ever active in a packaged build. electron-updater already no-ops most of its own internal
 * checks in dev, but this skips even attempting a feed request, so `npm run dev` never tries to
 * reach a URL that isn't a meaningful update feed for local development anyway. */
function ensureConfigured(): boolean {
  if (!app.isPackaged) return false;
  if (configured) return true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Same "one env var controls the environment" convention as BLUE_LEDGER_API_URL itself (see
  // license-service.ts) — reused directly rather than a separate electron-builder publish config,
  // so a single built installer's update feed always tracks wherever this device is pointed.
  autoUpdater.setFeedURL({ provider: "generic", url: `${API_BASE_URL}/releases` });

  autoUpdater.on("checking-for-update", () => {
    state = { status: "checking", version: null, error: null };
  });
  autoUpdater.on("update-available", (info) => {
    console.log(`[update] Version ${info.version} available — downloading in the background.`);
    state = { status: "downloading", version: info.version, error: null };
  });
  autoUpdater.on("update-not-available", () => {
    state = { status: "not-available", version: null, error: null };
  });
  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[update] Version ${info.version} downloaded — ready to install.`);
    state = { status: "downloaded", version: info.version, error: null };
  });
  autoUpdater.on("error", (err) => {
    console.error("[update] check/download failed (treated as offline, never fatal):", err instanceof Error ? err.message : err);
    state = { status: "error", version: state.version, error: err instanceof Error ? err.message : String(err) };
  });

  configured = true;
  return true;
}

/** Never throws — an unreachable feed (no internet, SERVER down) is exactly the same "keep working
 * offline" case every other background check in this app already tolerates silently. Called at
 * boot and periodically (see bootstrap.ts) — safe to call as often as needed, electron-updater
 * itself is a fast no-op if a check is already in flight. */
export async function checkForUpdates(): Promise<void> {
  if (!ensureConfigured()) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    state = { status: "error", version: state.version, error: err instanceof Error ? err.message : String(err) };
  }
}

export function getUpdateStatus(): UpdateState & { currentVersion: string } {
  return { ...state, currentVersion: app.getVersion() };
}

/** Only meaningful once status is "downloaded". Electron's own quitAndInstall never resolves (the
 * process exits as part of the call), so there's nothing for a caller to await. */
export function installUpdateNow(): void {
  if (state.status !== "downloaded") return;
  autoUpdater.quitAndInstall();
}
