import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import electron from "electron";
import type { BrowserWindow as BrowserWindowType } from "electron";

const { app } = electron;

/** Loads a full HTML document into a hidden print/PDF/image-conversion window via a temp file
 * rather than a `data:text/html;base64,...` URL — a real client's quotation started failing with
 * `ERR_INVALID_URL (-300)` the moment it had enough product-image thumbnails embedded (each an
 * `<img>` data: URI already, so the WHOLE document could run to several MB): Chromium enforces a
 * hard max URL length, and re-encoding that already-large HTML string as a second, OUTER base64
 * data: URL for loadURL blew straight through it. Confirmed live: the exact same document
 * generated fine with product images turned off (small HTML, well under the ceiling) and failed
 * every time with them on. A `file://` URL via loadFile has no such length ceiling regardless of
 * how many/large the embedded images are, so this is the actual fix rather than a size cap on
 * images — a shop is entitled to quote as many products as they want on one document. Shared by
 * every hidden-window HTML loader in the app (printer-service.ts, report-export-service.ts,
 * export-service.ts, image-service.ts) — none of them should ever go back to the data: URL
 * pattern this replaces. */
export async function loadHtmlIntoWindow(win: BrowserWindowType, html: string): Promise<void> {
  const tempPath = join(app.getPath("temp"), `blue-ledger-print-${randomUUID()}.html`);
  await writeFile(tempPath, html, "utf-8");
  try {
    await win.loadFile(tempPath);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}
