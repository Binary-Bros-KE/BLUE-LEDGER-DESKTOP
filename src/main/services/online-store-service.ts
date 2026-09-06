import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import electron from "electron";
import * as productRepository from "@main/database/repositories/product-repository";
import { API_BASE_URL } from "@main/services/license-service";
import { getCloudIdentity } from "@main/services/sync-engine";
import type { OnlineImageRef, Product } from "@shared/types/product";
import type { ProductOnlinePatch, StoreConfigPatch, StoreOwnerView } from "@shared/types/online-store";

const { dialog } = electron;

const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/**
 * Backs the desktop "Online Store" tab. Two kinds of work:
 *  - Local, offline-first: toggling a product's `publishedOnline` and its online price/description.
 *    These are plain synced Product columns — written straight to SQLite here, carried to the cloud
 *    by the normal sync engine. No network.
 *  - Online-only: reading/writing the cloud `web_stores` config, and uploading product photos to
 *    object storage. These POST to SERVER `/shop-admin/*` (device-authed, same {tenantId, deviceId}
 *    credential as /sync) and need a live connection.
 */

async function postShopAdmin<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const identity = getCloudIdentity();
  if (!identity) {
    throw new Error(
      "This device isn't linked to the cloud yet. Activate it and run Cloud Sync first, then try again.",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: identity.tenantId, deviceId: identity.deviceId, ...body }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Couldn't reach Blue Ledger's servers. Check your internet connection and try again.");
  }

  const json = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return json as T;
}

function currentProduct(productId: string): Product {
  const row = productRepository.findProductRowById(productId);
  if (!row) throw new Error("Product not found");
  return productRepository.mapProductRow(row);
}

export function getOverview(): Promise<StoreOwnerView> {
  return postShopAdmin<StoreOwnerView>("/shop-admin/store", {});
}

export function updateStoreConfig(patch: StoreConfigPatch): Promise<StoreOwnerView> {
  return postShopAdmin<StoreOwnerView>("/shop-admin/store/update", patch);
}

/** Local write only — the sync engine propagates published_online / online_* to the cloud. */
export function setProductOnline(productId: string, patch: ProductOnlinePatch): Product {
  const row = productRepository.setProductOnlineRow(productId, patch);
  return productRepository.mapProductRow(row);
}

/** Opens a file picker, uploads the chosen photo to object storage via SERVER (which resizes it to
 * WebP + a thumbnail), and appends the returned URL pair to the product's online images. Returns
 * the product unchanged if the picker was cancelled. */
export async function uploadProductImage(productId: string): Promise<Product> {
  // Make sure the product exists before opening a dialog for it.
  const existing = currentProduct(productId);

  const picked = await dialog.showOpenDialog({
    title: "Choose a product photo",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
  });
  const [sourcePath] = picked.filePaths;
  if (picked.canceled || !sourcePath) {
    return existing;
  }

  const ext = extname(sourcePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported image type. Use a JPG, PNG or WEBP file.");
  }
  if (statSync(sourcePath).size > UPLOAD_MAX_BYTES) {
    throw new Error("That image is larger than 5 MB — please choose a smaller file.");
  }

  const bytes = await readFile(sourcePath);
  const uploaded = await postShopAdmin<{ url: string; thumbUrl: string }>("/shop-admin/upload", {
    productId,
    productName: existing.name,
    filename: basename(sourcePath),
    dataBase64: bytes.toString("base64"),
  });

  const next: OnlineImageRef[] = [...currentProduct(productId).onlineImageUrls, uploaded];
  const row = productRepository.setProductOnlineRow(productId, { onlineImageUrls: next });
  return productRepository.mapProductRow(row);
}

/** Removes one image from the product. Tells the server to delete the object too (best-effort — an
 * orphan in R2 is harmless), then drops it from the local list regardless. */
export async function deleteProductImage(productId: string, url: string): Promise<Product> {
  await postShopAdmin("/shop-admin/image/delete", { productId, url }).catch(() => undefined);
  const next = currentProduct(productId).onlineImageUrls.filter((image) => image.url !== url);
  const row = productRepository.setProductOnlineRow(productId, { onlineImageUrls: next });
  return productRepository.mapProductRow(row);
}
