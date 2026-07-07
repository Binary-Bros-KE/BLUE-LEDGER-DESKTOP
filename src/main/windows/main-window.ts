import { join } from "node:path";
import electron, { type BrowserWindow } from "electron";
import { buildRendererCsp } from "@main/security/content-security-policy";

const { app, BrowserWindow: BrowserWindowCtor, shell } = electron;

function getAppIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "icons", "BLUE_LEDGER.png")
    : join(__dirname, "../../resources/icons/BLUE_LEDGER.png");
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
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged
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
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}
