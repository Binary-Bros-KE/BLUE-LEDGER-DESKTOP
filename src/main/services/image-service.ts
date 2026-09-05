import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import electron from "electron";
import { loadHtmlIntoWindow } from "@main/services/html-window-loader";

const { app, dialog, shell, BrowserWindow } = electron;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

/** A floor, not a cap — comfortably clears the OS-level minimum window WIDTH a normal titled window
 * enforces regardless of any `minWidth` option (confirmed directly: even with minWidth/minHeight set
 * to 0, a real 100px-wide window came back 120px after setContentSize on Windows) — `frame: false`
 * below already avoids most of that, but staying well clear of whatever floor remains is simpler and
 * safer than chasing its exact value. Grown to match the image itself for anything larger, so a
 * real product photo (easily well over 512px on a side) is never silently clipped to this floor —
 * confirmed directly: an 800x600 image against a FIXED 512x512 canvas came back cropped to 512x512
 * before this was made a floor instead of a fixed size. */
const MIN_IMAGE_CONVERSION_CANVAS = 512;

/**
 * .webp specifically needs converting to PNG before it can safely reach a generated PDF — this is
 * the actual fix for a real client whose quotations failed to generate with an unreadable raw error
 * the moment a product photo was a .webp file (a common default on Android/WhatsApp). Chromium's
 * on-screen page renderer (Blink, what a loaded HTML document uses to actually display an `<img>`)
 * decodes webp fine, but `webContents.printToPDF()` renders through a separate, narrower Skia PDF
 * backend that doesn't reliably handle every webp variant — so the image can display perfectly in a
 * live preview yet still blow up the moment the SAME html is fed to printToPDF. Electron's own
 * `nativeImage` isn't a fix either — its own docs only ever claim PNG/JPEG, and it does in fact fail
 * to decode a real webp file (confirmed directly: isEmpty() came back true against a webp that Blink
 * itself rendered correctly).
 *
 * The actual fix: render the raw image in a real (hidden) page — the one code path already proven to
 * handle webp correctly — then capture EXACTLY its own natural pixel rect (not the whole window; the
 * window is always sized to at least MIN_IMAGE_CONVERSION_CANVAS regardless of the image's own size,
 * so a rect-less "capture the whole window" would silently pad a small image or clip a large one) as
 * a screenshot and re-encode it as PNG. No new dependency, no native module to keep working across
 * Electron upgrades — just reusing the rendering pipeline that was already working the whole time.
 *
 * Verified directly against real images at 1x1, 20x20, 100x50, 300x300, 800x600, and 1600x1200 —
 * every single one came back at its EXACT source resolution with byte-for-byte identical pixel
 * colors (no blending, no interpolation, no clipping, no padding).
 */
async function convertWebpToPngDataUrl(rawDataUrl: string): Promise<string | null> {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    width: MIN_IMAGE_CONVERSION_CANVAS,
    height: MIN_IMAGE_CONVERSION_CANVAS,
    webPreferences: { offscreen: false }
  });
  try {
    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:transparent;"><img id="managed-image" src="${rawDataUrl}" style="display:block;" /></body></html>`;
    // See loadHtmlIntoWindow's own doc comment — a data:base64 URL here has the same
    // ERR_INVALID_URL ceiling for a large enough source image (a full-resolution phone photo can
    // run several MB), not just the invoice/quotation case it was first found on.
    await loadHtmlIntoWindow(win, html);
    const size = (await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const img = document.getElementById("managed-image");
        function done() { resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null); }
        if (img.complete) done();
        else { img.addEventListener("load", done); img.addEventListener("error", () => resolve(null)); }
      });
    `)) as { width: number; height: number } | null;
    if (!size) return null;

    win.setContentSize(Math.max(size.width, MIN_IMAGE_CONVERSION_CANVAS), Math.max(size.height, MIN_IMAGE_CONVERSION_CANVAS));
    // capturePage() can race ahead of the compositor actually producing a frame for the just-resized
    // window — confirmed directly: capturing immediately after setContentSize threw "UnknownVizError"
    // even though the image itself had already loaded successfully. A short settle delay is enough.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const captured = await win.webContents.capturePage({ x: 0, y: 0, width: size.width, height: size.height });
    return captured.toDataURL();
  } catch {
    return null;
  } finally {
    win.destroy();
  }
}

/** Reads a local image file and returns it as a data URL for renderer preview / embedding in a
 * generated PDF. A .webp file is additionally converted to PNG first (see convertWebpToPngDataUrl's
 * own doc comment) — every other supported format is returned as-is, unchanged from before.
 * Never persisted; never throws (a missing file, an unsupported extension, or a conversion failure
 * all return null the same way — every caller already treats null as "no image"). */
export async function readLocalImagePreview(filePath: string): Promise<string | null> {
  const extension = extname(filePath).toLowerCase();
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) {
    return null;
  }

  try {
    const buffer = await readFile(filePath);
    const rawDataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    if (extension !== ".webp") return rawDataUrl;
    // Deliberately does NOT fall back to the raw webp data URL on conversion failure — that would
    // just reintroduce the exact risk this function exists to remove. Null degrades to "no
    // logo/photo shown" instead, same as any other unreadable/corrupt image.
    return await convertWebpToPngDataUrl(rawDataUrl);
  } catch {
    return null;
  }
}

const DEFAULT_ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Builds a self-contained "pick / store / preview / delete" API for a managed image category
 * (e.g. product photos, employee photos), all rooted under a dedicated subdirectory of userData.
 * The app never stores a reference to the original file location, so moving/renaming/deleting the
 * source afterwards has no effect — this also prepares image files for future cloud sync.
 */
function createManagedImageStore(options: {
  relativeDir: string;
  dialogTitle: string;
  allowedExtensions?: Set<string>;
  maxBytes?: number;
}) {
  const allowedExtensions = options.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  function getManagedDir(): string {
    return join(app.getPath("userData"), options.relativeDir);
  }

  function toManagedRelativePath(filename: string): string {
    return `${options.relativeDir}/${filename}`.split("\\").join("/");
  }

  function resolveManagedPath(relativePath: string): string {
    return join(app.getPath("userData"), relativePath);
  }

  function storeFromSourcePath(sourcePath: string): string {
    const ext = extname(sourcePath).toLowerCase();
    if (!allowedExtensions.has(ext)) {
      throw new Error("Unsupported image type. Use JPG, PNG, or WEBP.");
    }

    const stats = statSync(sourcePath);
    if (stats.size > maxBytes) {
      throw new Error(`Image is too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))}MB.`);
    }

    const destDir = getManagedDir();
    mkdirSync(destDir, { recursive: true });

    const filename = `${randomUUID()}${ext}`;
    copyFileSync(sourcePath, join(destDir, filename));

    return toManagedRelativePath(filename);
  }

  async function pickAndStore(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: options.dialogTitle,
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }]
    });

    const [firstPath] = result.filePaths;
    if (result.canceled || !firstPath) {
      return null;
    }

    return storeFromSourcePath(firstPath);
  }

  /** Accepts a managed relative path, but also a pre-migration raw absolute path for backward compatibility. */
  async function readPreview(relativePathOrLegacyAbsolute: string): Promise<string | null> {
    const resolved = isAbsolute(relativePathOrLegacyAbsolute)
      ? relativePathOrLegacyAbsolute
      : resolveManagedPath(relativePathOrLegacyAbsolute);
    return readLocalImagePreview(resolved);
  }

  function remove(relativePath: string | null): void {
    if (!relativePath || isAbsolute(relativePath)) return;
    try {
      rmSync(resolveManagedPath(relativePath), { force: true });
    } catch {
      // Best-effort cleanup — a missing file on disk should never block a save.
    }
  }

  return { pickAndStore, readPreview, remove };
}

const productImageStore = createManagedImageStore({
  relativeDir: join("images", "products"),
  dialogTitle: "Select product image"
});

/** Opens a file picker and copies the chosen image into managed storage. Returns the relative path to persist. */
export const pickAndStoreProductImage = productImageStore.pickAndStore;
/** Reads a previously-stored managed product image (relative path) for renderer preview. */
export const readManagedProductImagePreview = productImageStore.readPreview;
/** Removes a managed product image from disk. Safe to call even if the file no longer exists. */
export const deleteManagedProductImage = productImageStore.remove;

const employeePhotoStore = createManagedImageStore({
  relativeDir: join("images", "employees"),
  dialogTitle: "Select employee photo"
});

/** Opens a file picker and copies the chosen photo into managed storage. Returns the relative path to persist. */
export const pickAndStoreEmployeePhoto = employeePhotoStore.pickAndStore;
/** Reads a previously-stored managed employee photo (relative path) for renderer preview. */
export const readManagedEmployeePhotoPreview = employeePhotoStore.readPreview;
/** Removes a managed employee photo from disk. Safe to call even if the file no longer exists. */
export const deleteManagedEmployeePhoto = employeePhotoStore.remove;

const businessLogoStore = createManagedImageStore({
  relativeDir: join("images", "business"),
  dialogTitle: "Select business logo"
});

/** Opens a file picker and copies the chosen logo into managed storage. Returns the relative path to persist. */
export const pickAndStoreBusinessLogo = businessLogoStore.pickAndStore;
/** Reads a previously-stored managed business logo (relative path) for renderer preview. */
export const readManagedBusinessLogoPreview = businessLogoStore.readPreview;
/** Removes a managed business logo from disk. Safe to call even if the file no longer exists. */
export const deleteManagedBusinessLogo = businessLogoStore.remove;

const locationLogoStore = createManagedImageStore({
  relativeDir: join("images", "locations"),
  dialogTitle: "Select storefront logo"
});

/** Opens a file picker and copies the chosen logo into managed storage. Returns the relative path to persist. */
export const pickAndStoreLocationLogo = locationLogoStore.pickAndStore;
/** Reads a previously-stored managed storefront logo (relative path) for renderer preview. */
export const readManagedLocationLogoPreview = locationLogoStore.readPreview;
/** Removes a managed storefront logo from disk. Safe to call even if the file no longer exists. */
export const deleteManagedLocationLogo = locationLogoStore.remove;

const ATTACHMENT_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp"]);
const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Same managed-storage approach as the image stores above, but for arbitrary supplier documents
 * (PDF invoices, scanned receipts, delivery notes) that can't be rendered as an <img> preview.
 * Opens with the OS's default viewer instead of returning a data URL.
 */
function createManagedFileStore(options: { relativeDir: string; dialogTitle: string }) {
  function getManagedDir(): string {
    return join(app.getPath("userData"), options.relativeDir);
  }

  function toManagedRelativePath(filename: string): string {
    return `${options.relativeDir}/${filename}`.split("\\").join("/");
  }

  function resolveManagedPath(relativePath: string): string {
    return join(app.getPath("userData"), relativePath);
  }

  async function pickAndStore(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: options.dialogTitle,
      properties: ["openFile"],
      filters: [{ name: "Documents", extensions: ["pdf", "jpg", "jpeg", "png", "webp"] }]
    });

    const [firstPath] = result.filePaths;
    if (result.canceled || !firstPath) {
      return null;
    }

    const ext = extname(firstPath).toLowerCase();
    if (!ATTACHMENT_EXTENSIONS.has(ext)) {
      throw new Error("Unsupported file type. Use PDF, JPG, PNG, or WEBP.");
    }

    const stats = statSync(firstPath);
    if (stats.size > ATTACHMENT_MAX_BYTES) {
      throw new Error(`File is too large. Maximum size is ${Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024))}MB.`);
    }

    const destDir = getManagedDir();
    mkdirSync(destDir, { recursive: true });

    const filename = `${randomUUID()}${ext}`;
    copyFileSync(firstPath, join(destDir, filename));

    return toManagedRelativePath(filename);
  }

  /** Opens the stored file in the OS's default viewer/application. */
  async function open(relativePath: string): Promise<void> {
    const resolved = isAbsolute(relativePath) ? relativePath : resolveManagedPath(relativePath);
    const errorMessage = await shell.openPath(resolved);
    if (errorMessage) {
      throw new Error(`Couldn't open the file: ${errorMessage}`);
    }
  }

  function remove(relativePath: string | null): void {
    if (!relativePath || isAbsolute(relativePath)) return;
    try {
      rmSync(resolveManagedPath(relativePath), { force: true });
    } catch {
      // Best-effort cleanup — a missing file on disk should never block a save.
    }
  }

  return { pickAndStore, open, remove };
}

const purchaseAttachmentStore = createManagedFileStore({
  relativeDir: join("attachments", "purchases"),
  dialogTitle: "Select supplier invoice, receipt, or delivery note"
});

/** Opens a file picker and copies the chosen document into managed storage. Returns the relative path to persist. */
export const pickAndStorePurchaseAttachment = purchaseAttachmentStore.pickAndStore;
/** Opens a previously-stored purchase attachment in the OS's default viewer. */
export const openManagedPurchaseAttachment = purchaseAttachmentStore.open;
/** Removes a managed purchase attachment from disk. Safe to call even if the file no longer exists. */
export const deleteManagedPurchaseAttachment = purchaseAttachmentStore.remove;

const expenseAttachmentStore = createManagedFileStore({
  relativeDir: join("attachments", "expenses"),
  dialogTitle: "Select receipt or invoice"
});

/** Opens a file picker and copies the chosen document into managed storage. Returns the relative path to persist. */
export const pickAndStoreExpenseAttachment = expenseAttachmentStore.pickAndStore;
/** Opens a previously-stored expense attachment in the OS's default viewer. */
export const openManagedExpenseAttachment = expenseAttachmentStore.open;
/** Removes a managed expense attachment from disk. Safe to call even if the file no longer exists. */
export const deleteManagedExpenseAttachment = expenseAttachmentStore.remove;
