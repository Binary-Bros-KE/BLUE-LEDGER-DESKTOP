import { join } from "node:path";
import electron, { type BrowserWindow } from "electron";
import { buildRendererCsp } from "@main/security/content-security-policy";

const { app, BrowserWindow: BrowserWindowCtor, shell } = electron;

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

  const window = new BrowserWindowCtor({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
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
      // Reachable via Ctrl+Shift+I / F12 even in a packaged build — never auto-opened, but a
      // stuck/blank window in production is otherwise completely unobservable (no console, no way
      // to see the actual error). Low-risk for offline B2B desktop software: anyone able to press
      // this shortcut already has physical/remote access to the machine, at which point DevTools
      // grants them nothing they didn't already have.
      devTools: true
    }
  });

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
