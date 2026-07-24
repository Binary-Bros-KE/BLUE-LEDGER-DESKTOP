// Must run before any other import that reads process.env (e.g. BLUE_LEDGER_API_URL in
// license-service.ts) — dotenv only populates process.env once this actually executes.
import "dotenv/config";
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
if (process.env.BLUE_LEDGER_DATA_DIR) {
  mkdirSync(process.env.BLUE_LEDGER_DATA_DIR, { recursive: true });
  app.setPath("userData", process.env.BLUE_LEDGER_DATA_DIR);
  console.log(`[Blue Ledger] Using overridden userData path: ${app.getPath("userData")}`);
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
