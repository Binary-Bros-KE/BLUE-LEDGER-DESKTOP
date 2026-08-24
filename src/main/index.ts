// Must be the very first import — see env.ts's own comment for why this has to be a plain static
// side-effect import (never dynamic) positioned before every other import in this file.
import "./env";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import electron from "electron";
import { bootstrap } from "./app/bootstrap";

const { app, dialog } = electron;

/** Best-effort — if even this fails (e.g. userData itself unwritable), there's nothing more to do;
 * the error dialog below is still the primary channel back to whoever hits this. Appends rather than
 * overwrites so a support conversation can see every failed attempt, not just the latest. */
function logStartupCrash(error: unknown): void {
  try {
    const format = (err: unknown): string => (err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err));
    // migrate.ts wraps a failing migration's real error in `cause` (see its own comment) — logging
    // both means the log shows WHICH migration failed AND the original SQLite error underneath it.
    const message = error instanceof Error && error.cause !== undefined ? `${format(error)}\nCaused by: ${format(error.cause)}` : format(error);
    appendFileSync(join(app.getPath("userData"), "startup-crash.log"), `[${new Date().toISOString()}] ${message}\n\n`);
  } catch {
    // Nothing more we can do.
  }
}

/** bootstrap() runs migrateDatabase() and a long chain of ensure*() setup calls SYNCHRONOUSLY,
 * before any window ever opens — a failing migration (rolled back, so it never gets marked applied
 * and retries identically on every future launch — see runInTransaction) or any other startup
 * exception used to just die here with zero visible feedback: `void bootstrap()` had no `.catch()`,
 * so a thrown error became an unhandled promise rejection and Electron's main process exited
 * silently. To someone double-clicking the desktop icon this was indistinguishable from "the app
 * just doesn't open" — no error, no window, nothing — and the only "fix" was deleting the entire
 * userData folder (wiping the local database) to escape whatever data condition was tripping the
 * failing migration. This handler is what that gap was missing: a real, visible error message (also
 * logged to disk, since a dialog can be dismissed before it's read) instead of silent death, so the
 * NEXT occurrence is diagnosable instead of guessed at. */
function handleFatalStartupError(error: unknown): void {
  console.error("[Blue Ledger] Fatal startup error:", error);
  logStartupCrash(error);
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox(
    "Blue Ledger POS failed to start",
    `Something went wrong while starting up and the app could not open:\n\n${message}\n\n` +
      "This has been logged to startup-crash.log in the app's data folder. Please share this with support — your local data has NOT been deleted."
  );
  app.exit(1);
}

// Lets you run a second, fully independent "installation" side by side in dev — its own SQLite
// file, its own images, completely isolated from the default instance — by pointing it at a
// different folder. Must run before anything touches getDatabasePath()/userData, so this has to
// be the very first thing after the app object exists. Example (PowerShell):
//   $env:BLUE_LEDGER_DATA_DIR = "C:\bl-dev-monthly"; npm run dev
// The folder MUST exist before app.setPath() runs — Electron does not create it, and silently
// keeps the default path if it doesn't (this is why it looked like the override "did nothing").
//
// CRITICAL: sessionData must ALSO be overridden here, not just userData. They're two distinct
// Electron paths (sessionData defaults to the same location as userData, but overriding one does
// NOT move the other) — Chromium's own network cache/disk cache/cookies live under sessionData,
// NOT userData. Missing this for a long time was the actual cause of two dev instances
// intermittently crashing ("Network service crashed or was terminated", disk_cache
// "Critical error found -8", "No file for <hash>") — both instances were quietly fighting over the
// SAME shared cache directory even though they had separate, correctly-isolated userData folders
// for the actual app data (SQLite/images). Same relationship as Electron's own un-overridden
// default (sessionData === userData for a single, un-overridden install), just moved.
if (process.env.BLUE_LEDGER_DATA_DIR) {
  mkdirSync(process.env.BLUE_LEDGER_DATA_DIR, { recursive: true });
  app.setPath("userData", process.env.BLUE_LEDGER_DATA_DIR);
  app.setPath("sessionData", process.env.BLUE_LEDGER_DATA_DIR);
  console.log(`[Blue Ledger] Using overridden userData/sessionData path: ${app.getPath("userData")}`);
}

if (!app.isPackaged) {
  app.commandLine.appendSwitch("disable-crash-reporter");
}

void bootstrap().catch(handleFatalStartupError);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
