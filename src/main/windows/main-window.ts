import { existsSync } from "node:fs";
import { join } from "node:path";
import electron, { type BrowserWindow } from "electron";
import windowStateKeeper from "electron-window-state";
import { buildRendererCsp } from "@main/security/content-security-policy";

const { app, BrowserWindow: BrowserWindowCtor, screen, shell } = electron;

// The size this UI is actually designed/tested around — used as the very first launch's default,
// but only ever as a CEILING (see createMainWindow): a laptop, tablet, or oddly-shaped monitor
// smaller than this gets a window clamped to whatever it actually has, instead of a fixed size that
// doesn't care what screen it's on. That mismatch (always 1440x920 regardless of the real display,
// and never remembering anything the user did about it) is what made the window fight OS window
// management on one shop's monitor — too big for that screen, and every relaunch forgot any resize.
const REFERENCE_WIDTH = 1440;
const REFERENCE_HEIGHT = 900;
const WINDOW_STATE_FILE = "window-state.json";

// app.getAppPath() (the directory containing this app's own package.json — the project root in
// dev, resources/app in a packaged, non-asar build) is used here instead of __dirname deliberately:
// __dirname reflects wherever the BUNDLER happened to place the currently-executing chunk, which is
// an implementation detail that can silently change (e.g. a dynamic import() anywhere in this file's
// import chain gives Rollup a code-splitting boundary, moving this code into its own out/main/
// chunks/ subfolder and shifting every __dirname-relative path here one directory too deep — this
// broke the preload script, this icon, and the renderer's index.html simultaneously the one time it
// happened). app.getAppPath() is stable regardless of how the bundler chunks anything.
function getAppIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "icons", "BLUE_LEDGER.png")
    : join(app.getAppPath(), "resources/icons/BLUE_LEDGER.png");
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL);

  // Never bigger than the screen it's actually opening on — a fixed 1440x920 regardless of display
  // is exactly what broke on a monitor smaller than that. workAreaSize excludes the taskbar, so this
  // is the real usable space, on whichever display Electron considers primary.
  const { workAreaSize } = screen.getPrimaryDisplay();
  const defaultWidth = Math.min(REFERENCE_WIDTH, workAreaSize.width);
  const defaultHeight = Math.min(REFERENCE_HEIGHT, workAreaSize.height);

  // No state file yet = genuinely first launch on this machine — centers the window (by omitting
  // x/y below) instead of windowStateKeeper's own default of pinning it to the display's top-left
  // corner, which looks broken on a big monitor. Every launch after this one restores whatever the
  // user actually left the window at (size, position, and maximized/restored state) — see
  // windowState.manage() below, which also keeps saving on every resize/move/close from here on.
  const isFirstLaunch = !existsSync(join(app.getPath("userData"), WINDOW_STATE_FILE));
  const windowState = windowStateKeeper({ file: WINDOW_STATE_FILE, defaultWidth, defaultHeight });

  const window = new BrowserWindowCtor({
    ...(isFirstLaunch ? {} : { x: windowState.x, y: windowState.y }),
    width: windowState.width,
    height: windowState.height,
    minWidth: 1180,
    minHeight: 760,
    resizable: true,
    maximizable: true,
    title: "Blue Ledger POS",
    icon: getAppIconPath(),
    backgroundColor: "#eef5ff",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(app.getAppPath(), "out/preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Only reachable via Ctrl+Shift+I / F12 in a local dev build. Was left on in packaged builds
      // for a while to debug a production-only issue; disabled again now that it's resolved and no
      // errors are outstanding — a stray Ctrl+Shift+I from a real user (which happened) is more
      // likely than the low-probability "need to debug a live install" case it existed for.
      devTools: isDev
    }
  });

  // Restores last-known maximized/full-screen state (if any) and wires resize/move/close listeners
  // that keep the saved state file current from here on — this single call is the entire "remember
  // where I left it" mechanism.
  windowState.manage(window);

  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [buildRendererCsp(isDev)]
      }
    });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(join(app.getAppPath(), "out/renderer/index.html"));
  }

  return window;
}
