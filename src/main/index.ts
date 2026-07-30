// Must be the very first import — see env.ts's own comment for why this has to be a plain static
// side-effect import (never dynamic) positioned before every other import in this file.
import "./env";
import { mkdirSync } from "node:fs";
import electron from "electron";
import { bootstrap } from "./app/bootstrap";

const { app } = electron;

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

void bootstrap();

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
