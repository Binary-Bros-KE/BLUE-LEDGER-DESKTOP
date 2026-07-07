import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import electron from "electron";

const { app, dialog } = electron;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

/** Reads a local image file and returns it as a data URL for renderer preview. Never persisted. */
export async function readLocalImagePreview(filePath: string): Promise<string | null> {
  const mime = MIME_BY_EXTENSION[extname(filePath).toLowerCase()];
  if (!mime) {
    return null;
  }

  try {
    const buffer = await readFile(filePath);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

const DEFAULT_ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

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

  async function readPreview(relativePath: string): Promise<string | null> {
    return readLocalImagePreview(resolveManagedPath(relativePath));
  }

  function remove(relativePath: string | null): void {
    if (!relativePath) return;
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
