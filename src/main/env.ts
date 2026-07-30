import path from "node:path";
import { config as loadEnv } from "dotenv";
import electron from "electron";

const { app } = electron;

// Side-effect module, imported FIRST (and only ever statically) in main/index.ts — static sibling
// imports evaluate in declaration order, so this module's own body (the loadEnv call below) always
// finishes running before any later-declared import's module graph starts evaluating, including
// bootstrap.ts and everything it transitively imports (e.g. BLUE_LEDGER_API_URL read at
// module-evaluation time in license-service.ts). This MUST stay a plain static side-effect import,
// never a dynamic import() — a dynamic import is a genuine code-splitting boundary, and splitting
// main-window.ts (which bootstrap.ts eventually imports) into its own chunk file broke every
// __dirname-relative path it built (preload script, app icon, renderer index.html all resolved one
// directory too deep, since __dirname pointed at the chunk's own folder instead of out/main/) —
// caught live: "Unable to load preload script ...out/main/preload/index.js" (should have been
// .../out/preload/index.js) in a packaged build, and the renderer stuck on its boot spinner forever
// in dev, because a failed preload load means window.blueLedger never exists for the renderer to
// call. Keep this file free of anything that would give a bundler a reason to split it off.
//
// Dev: dotenv's own default lookup (the project root's own .env) is fine as-is. Packaged: that
// default (process.cwd()) is unreliable for a GUI-launched installed app — it's often the shell's
// own working directory, not the install folder — and no .env file even ships inside "files" in
// package.json's electron-builder config anyway. Packaged builds instead get their own bundled
// .env via extraResources (see package.json's build.extraResources + resources/.env.production),
// copied into the packaged app's resources folder, whose path Electron always resolves correctly
// via process.resourcesPath regardless of the current working directory.
loadEnv(app.isPackaged ? { path: path.join(process.resourcesPath, ".env") } : undefined);
