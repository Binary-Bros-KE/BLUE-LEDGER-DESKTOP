import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import electron from "electron";
import { autoUpdater } from "electron-updater";
import { API_BASE_URL } from "@main/services/license-service";

const { app } = electron;

/**
 * Auto-update via electron-updater's "generic" provider — SERVER serves the built NSIS installer +
 * latest.yml as plain static files (see SERVER's app.ts `/releases` route), no publish/upload
 * pipeline involved. Downloads happen silently in the background the moment a newer version is
 * found; the renderer polls getUpdateStatus() (same pattern as useSyncStatusWidget.ts) and shows a
 * "Restart & Update" button once status is "downloaded" — the ONLY way an update is ever installed.
 *
 * autoInstallOnAppQuit (electron-updater's own built-in fallback for a user who never clicks that
 * button) is deliberately left OFF — it used to be on, and it's the actual root cause of a real
 * field failure: internally it calls `install(isSilent: true, ...)` on ANY normal quit once a
 * download has finished, with ZERO visible UI. A cashier just closing the app for the day would see
 * nothing happen (no progress window, nothing) — indistinguishable from a completely normal close —
 * and if they reopened the app within the next several seconds while the NSIS uninstall+reinstall
 * was still mid-write, Windows launched the OLD (partially-deleted) exe straight into that live file
 * conflict, corrupting the install so badly the app was left neither updated nor even present on
 * disk. This is a documented class of electron-builder/electron-updater bug on Windows/NSIS (e.g.
 * electron-userland/electron-builder#7807), and autoInstallOnAppQuit=false is the community-confirmed
 * mitigation. The explicit "Restart & Update" button path is much safer on its own even without this
 * change — quitAndInstall() with no args runs NON-silently (isSilent defaults to false), so the user
 * actually SEES an NSIS "Installing..." window and isn't left guessing — but see
 * markUpdateInstallStarting/isUpdateInstallInProgress below for a second layer of protection on top
 * of that, since "much less likely" still isn't "impossible" for an impatient double-click.
 */

// Self-consuming marker: written the instant an install is about to start, checked ONCE at the next
// app launch (see bootstrap.ts), then deleted regardless of the verdict — a launch that finds it
// fresh treats itself as a possible race with a still-running installer and backs off instead of
// touching the database or opening a window; a launch that finds it missing or stale (the installer
// genuinely finished, or crashed and never got this far) proceeds completely normally. Deliberately
// lives in userData, not the install directory — NSIS only ever touches the install directory, so
// this survives the uninstall+reinstall cycle intact regardless of how that goes.
const UPDATE_LOCK_FILE = "update-install-started-at.txt";
// Generous relative to how long this installer actually takes (well under a minute on real
// hardware) without leaving a crashed/interrupted installer able to lock a user out of their own
// app for more than a few minutes.
const UPDATE_LOCK_MAX_AGE_MS = 3 * 60 * 1000;

function updateLockFilePath(): string {
  return join(app.getPath("userData"), UPDATE_LOCK_FILE);
}

/** Called immediately before quitAndInstall() below — see the module doc comment. Best-effort: if
 * this write fails for any reason, the update still proceeds exactly as it always has, just without
 * this extra safety net. */
function markUpdateInstallStarting(): void {
  try {
    writeFileSync(updateLockFilePath(), String(Date.now()));
  } catch (err) {
    console.error("[update] failed to write install-in-progress marker (proceeding anyway):", err);
  }
}

/** Checked once, at the very start of app startup (bootstrap.ts) — before the database, before any
 * window. Consumes the marker unconditionally so a second launch attempt (whether the user is
 * retrying after being turned away, or this is just a normal unrelated launch days later) always
 * proceeds normally; it is genuinely a one-shot check, not a standing lock. */
export function isUpdateInstallInProgress(): boolean {
  const path = updateLockFilePath();
  try {
    const startedAt = Number(readFileSync(path, "utf8"));
    return Number.isFinite(startedAt) && Date.now() - startedAt < UPDATE_LOCK_MAX_AGE_MS;
  } catch {
    return false;
  } finally {
    rmSync(path, { force: true });
  }
}

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
  // See this file's own module doc comment — the real cause of a real field failure.
  autoUpdater.autoInstallOnAppQuit = false;
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
 * process exits as part of the call), so there's nothing for a caller to await. Marks the
 * install-in-progress lock file first (see module doc comment) — this is the ONLY place an install
 * is ever triggered now that autoInstallOnAppQuit is off, so it's the one spot that needs to. */
export function installUpdateNow(): void {
  if (state.status !== "downloaded") return;
  markUpdateInstallStarting();
  autoUpdater.quitAndInstall();
}
