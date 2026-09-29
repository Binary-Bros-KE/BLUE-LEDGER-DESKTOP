import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import electron from "electron";
import { runInTransaction } from "@main/database/connection";
import * as productRepository from "@main/database/repositories/product-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import { requirePermission } from "@main/services/auth-service";
import { insertCompletedSaleFromCart, prepareCart, requireActiveSession } from "@main/services/sale-service";
import { API_BASE_URL } from "@main/services/license-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { getCloudIdentity } from "@main/services/sync-engine";
import type { OnlineImageRef, Product } from "@shared/types/product";
import type {
  ConvertOnlineOrderInput,
  ConvertOnlineOrderResult,
  OnlineOrder,
  OnlineOrderList,
  OnlineOrderStatus,
  OnlineOrderSummary,
  DeliveryMethodInput,
  NewsletterSubscriber,
  ProductOnlinePatch,
  StoreConfigPatch,
  StoreOwnerView,
  WebDeliveryMethod
} from "@shared/types/online-store";

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

/** The order line's variant key if this product still has it as an active shared variant here. */
function liveVariantKey(productId: string, variantKey: string | null | undefined): string | null {
  if (!variantKey) return null;
  const row = productRepository.findProductRowById(productId);
  const config = productRepository.parseVariantConfigJson(row?.variant_config_json);
  return config?.mode === "shared" && config.variants.some((v) => v.key === variantKey && v.active) ? variantKey : null;
}

export function getOverview(): Promise<StoreOwnerView> {
  return postShopAdmin<StoreOwnerView>("/shop-admin/store", {});
}

export function updateStoreConfig(patch: StoreConfigPatch): Promise<StoreOwnerView> {
  return postShopAdmin<StoreOwnerView>("/shop-admin/store/update", patch);
}

/** Local write only — the sync engine propagates published_online / online_* to the cloud. */
/** Publish / unpublish many products in one local transaction (see bulkSetPublishedOnlineRows). */
export function bulkSetPublishedOnline(productIds: string[], published: boolean): { changed: number } {
  requirePermission("online_store", "edit");
  const ids = [...new Set(productIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return { changed: 0 };
  const { tenantId } = getCurrentTenant();
  const changed = runInTransaction(() => productRepository.bulkSetPublishedOnlineRows(tenantId, ids, published));
  return { changed };
}

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

// --- Trylist theme (storefront look) ----------------------------------------------------------

/** Opens a file picker, validates, and returns the chosen image as base64 + its basename — or null
 * if the picker was cancelled. Shared by product + theme uploads. */
async function pickImageBase64(title: string): Promise<{ filename: string; dataBase64: string } | null> {
  const picked = await dialog.showOpenDialog({
    title,
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
  });
  const [sourcePath] = picked.filePaths;
  if (picked.canceled || !sourcePath) return null;

  const ext = extname(sourcePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported image type. Use a JPG, PNG or WEBP file.");
  }
  if (statSync(sourcePath).size > UPLOAD_MAX_BYTES) {
    throw new Error("That image is larger than 5 MB — please choose a smaller file.");
  }
  const bytes = await readFile(sourcePath);
  return { filename: basename(sourcePath), dataBase64: bytes.toString("base64") };
}

/** Deep-merges a partial Trylist theme into the cloud web_stores.themeJson. Returns the fresh view. */
export function updateTheme(patch: Record<string, unknown>): Promise<StoreOwnerView> {
  return postShopAdmin<StoreOwnerView>("/shop-admin/theme/update", patch);
}

/** Picks + uploads a theme decoration image (hero shot/background, story row, category). Returns
 * the hosted URL pair — the renderer then writes it into the theme via updateTheme. `null` if the
 * picker was cancelled. */
export async function uploadThemeImage(slot: string): Promise<{ url: string; thumbUrl: string } | null> {
  const file = await pickImageBase64("Choose an image");
  if (!file) return null;
  return postShopAdmin<{ url: string; thumbUrl: string }>("/shop-admin/theme/upload", { slot, ...file });
}

/** Best-effort delete of any stored image (product or theme) by URL. */
export async function deleteThemeImage(url: string): Promise<{ ok: true }> {
  await postShopAdmin("/shop-admin/image/delete", { url }).catch(() => undefined);
  return { ok: true };
}

// --- Delivery methods (storefront checkout options) -------------------------------------------
// Every call returns the full fresh list.

/** Website newsletter sign-ups, newest first. */
export function listNewsletterSubscribers(): Promise<NewsletterSubscriber[]> {
  return postShopAdmin<NewsletterSubscriber[]>("/shop-admin/newsletter", {});
}

export function listDeliveryMethods(): Promise<WebDeliveryMethod[]> {
  return postShopAdmin<WebDeliveryMethod[]>("/shop-admin/delivery", {});
}

export function createDeliveryMethod(input: DeliveryMethodInput): Promise<WebDeliveryMethod[]> {
  return postShopAdmin<WebDeliveryMethod[]>("/shop-admin/delivery/create", input as Record<string, unknown>);
}

export function updateDeliveryMethod(
  id: string,
  patch: Partial<DeliveryMethodInput>,
): Promise<WebDeliveryMethod[]> {
  return postShopAdmin<WebDeliveryMethod[]>("/shop-admin/delivery/update", { id, ...patch });
}

export function deleteDeliveryMethod(id: string): Promise<WebDeliveryMethod[]> {
  return postShopAdmin<WebDeliveryMethod[]>("/shop-admin/delivery/delete", { id });
}

export function reorderDeliveryMethods(orderedIds: string[]): Promise<WebDeliveryMethod[]> {
  return postShopAdmin<WebDeliveryMethod[]>("/shop-admin/delivery/reorder", { orderedIds });
}

// --- Online orders inbox (online-only, like delivery methods) ------------------------------------

export function listOnlineOrders(status: OnlineOrderStatus | "ALL", page: number): Promise<OnlineOrderList> {
  return postShopAdmin<OnlineOrderList>("/shop-admin/orders", { status, page, pageSize: 30 });
}

/** Cheap poll behind the sidebar badge / new-order alerts. */
export function onlineOrderSummary(): Promise<OnlineOrderSummary> {
  return postShopAdmin<OnlineOrderSummary>("/shop-admin/orders/summary", {});
}

export function setOnlineOrderStatus(id: string, status: OnlineOrderStatus): Promise<OnlineOrder> {
  return postShopAdmin<OnlineOrder>("/shop-admin/orders/status", { id, status });
}

/** No ids = mark every unseen order as seen. */
export function markOnlineOrdersSeen(ids?: string[]): Promise<{ marked: number }> {
  return postShopAdmin<{ marked: number }>("/shop-admin/orders/seen", ids ? { ids } : {});
}

export function getOnlineOrder(id: string): Promise<OnlineOrder> {
  return postShopAdmin<OnlineOrder>("/shop-admin/orders/get", { id });
}

/**
 * "Ring up sale": turns a web order into a normal completed POS sale — same cart math, tax, stock
 * validation and receipt numbering as Checkout (prepareCart + insertCompletedSaleFromCart), so it
 * syncs, reports and prints like any other sale. Then completes + links the cloud order.
 *
 * - Prices: the website's own unit prices. With chargeWebPrice (default) VAT lines are treated as
 *   tax-INCLUSIVE, so the customer pays exactly what the website showed (tax extracted, still
 *   reported) — never the website price plus VAT on top.
 * - Delivery fee → a "Delivery" service charge (untaxed).
 * - Customer: always a walk-in labelled "Web order WEB-0012" — never matched to (or creating) a
 *   customer record, so a web order can't land on the wrong account. The shopper's name and phone
 *   stay on the web order itself.
 * - Never twice: refused if the cloud order is already linked, or if a local sale already carries
 *   this order's marker (covers "sale saved, cloud link failed offline").
 */
export async function convertOnlineOrderToSale(input: ConvertOnlineOrderInput): Promise<ConvertOnlineOrderResult> {
  requirePermission("online_store", "edit");
  requirePermission("sales", "create");

  const order = await getOnlineOrder(input.orderId);
  if (order.linkedSaleId) {
    throw new Error(`${order.orderNumber} was already rung up as receipt ${order.linkedReceiptNumber ?? order.linkedSaleId}.`);
  }
  if (order.status === "CANCELLED") {
    throw new Error(`${order.orderNumber} is cancelled — reopen it first if the customer still wants it.`);
  }

  const { tenantId, employeeId, locationId } = requireActiveSession(input.storefrontId ?? order.fulfilmentLocationId);

  const marker = `[Web order ${order.orderNumber}]`;
  const previous = saleRepository.findSaleByNoteMarkerRow(tenantId, marker);
  if (previous) {
    throw new Error(`${order.orderNumber} was already rung up as receipt ${previous.receipt_number ?? previous.id}.`);
  }

  // A product published online but not yet pulled to THIS computer can't be sold from here.
  for (const item of order.items) {
    const row = productRepository.findProductRowById(item.productId);
    if (!row || row.tenant_id !== tenantId) {
      throw new Error(`"${item.name}" isn't on this computer yet — run Cloud Sync, then try again.`);
    }
  }

  const cart = prepareCart(
    tenantId,
    order.items.map((item) => ({
      productId: item.productId,
      quantity: item.qty,
      discountAmountCents: 0,
      unitPriceCents: item.unitPriceCents,
      taxInclusiveOverride: input.chargeWebPrice ? true : undefined,
      // The shopper's variant, when it's still a live variant on this computer — a variant switched
      // off/removed since the order still rings up (as the plain product, at the web price).
      variantKey: liveVariantKey(item.productId, item.variantKey)
    })),
    {
      serviceCharges:
        order.deliveryFeeCents > 0
          ? [
              {
                name: order.deliveryMethodName ? `Delivery — ${order.deliveryMethodName}` : "Delivery",
                feeCents: order.deliveryFeeCents,
                costCents: 0,
                taxType: "none",
                taxInclusive: null
              }
            ]
          : [],
      delivery: null
    }
  );

  const walkInName = `Web order ${order.orderNumber}`;

  const noteParts = [marker];
  if (order.notes) noteParts.push(order.notes);

  const sale = insertCompletedSaleFromCart({
    tenantId,
    employeeId,
    locationId,
    customerId: null,
    walkInName,
    cart,
    paymentMethodId: input.paymentMethodId,
    paymentReference: input.paymentReference?.trim() || null,
    amountReceivedCents: input.amountReceivedCents,
    notes: noteParts.join(" · ")
  });

  let linkWarning: string | null = null;
  try {
    await postShopAdmin<OnlineOrder>("/shop-admin/orders/link-sale", {
      id: order.id,
      saleId: sale.id,
      receiptNumber: sale.receiptNumber
    });
  } catch (err) {
    linkWarning = `Sale recorded, but ${order.orderNumber} couldn't be marked completed online (${
      err instanceof Error ? err.message : "no connection"
    }). Mark it Completed once you're back online.`;
  }

  return {
    saleId: sale.id,
    receiptNumber: sale.receiptNumber,
    grandTotalCents: cart.grandTotalCents,
    customerLabel: `Walk-in: ${walkInName}`,
    linkWarning
  };
}
