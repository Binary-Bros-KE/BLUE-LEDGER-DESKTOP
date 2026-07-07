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

const PRODUCT_IMAGE_RELATIVE_DIR = join("images", "products");
const PRODUCT_IMAGE_ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function getManagedProductImagesDir(): string {
  return join(app.getPath("userData"), PRODUCT_IMAGE_RELATIVE_DIR);
}

function toManagedRelativePath(filename: string): string {
  return `${PRODUCT_IMAGE_RELATIVE_DIR}/${filename}`.split("\\").join("/");
}

function resolveManagedImagePath(relativePath: string): string {
  return join(app.getPath("userData"), relativePath);
}

/**
 * Copies a user-selected image into the app's managed storage directory under
 * userData, using a generated filename. The app never stores a reference to the
 * original file location, so moving/renaming/deleting the source afterwards has
 * no effect — this also prepares image files for future cloud sync.
 */
function storeProductImageFromSourcePath(sourcePath: string): string {
  const ext = extname(sourcePath).toLowerCase();
  if (!PRODUCT_IMAGE_ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported image type. Use JPG, PNG, or WEBP.");
  }

  const stats = statSync(sourcePath);
  if (stats.size > PRODUCT_IMAGE_MAX_BYTES) {
    throw new Error("Image is too large. Maximum size is 5MB.");
  }

  const destDir = getManagedProductImagesDir();
  mkdirSync(destDir, { recursive: true });

  const filename = `${randomUUID()}${ext}`;
  copyFileSync(sourcePath, join(destDir, filename));

  return toManagedRelativePath(filename);
}

/** Opens a file picker and copies the chosen image into managed storage. Returns the relative path to persist. */
export async function pickAndStoreProductImage(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: "Select product image",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }]
  });

  const [firstPath] = result.filePaths;
  if (result.canceled || !firstPath) {
    return null;
  }

  return storeProductImageFromSourcePath(firstPath);
}

/** Reads a previously-stored managed product image (relative path) for renderer preview. */
export async function readManagedProductImagePreview(relativePath: string): Promise<string | null> {
  return readLocalImagePreview(resolveManagedImagePath(relativePath));
}

/** Removes a managed product image from disk. Safe to call even if the file no longer exists. */
export function deleteManagedProductImage(relativePath: string | null): void {
  if (!relativePath) return;
  try {
    rmSync(resolveManagedImagePath(relativePath), { force: true });
  } catch {
    // Best-effort cleanup — a missing file on disk should never block a product save.
  }
}
