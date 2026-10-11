import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import electron from "electron";
import { runInTransaction } from "@main/database/connection";
import * as deliveryNoteRepository from "@main/database/repositories/delivery-note-repository";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as riderRepository from "@main/database/repositories/rider-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import { getSession, requirePermission } from "@main/services/auth-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { insertCompletedSaleFromCart, prepareCart, requireActiveSession } from "@main/services/sale-service";
import { API_BASE_URL } from "@main/services/license-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { getCloudIdentity } from "@main/services/sync-engine";
import type { OnlineImageRef, Product } from "@shared/types/product";
import type { SalePayment } from "@shared/types/sale";
import type {
  ConvertOnlineOrderInput,
  ConvertOnlineOrderResult,
  OnlineOrder,
  OnlineOrderFulfilmentInput,
  OnlineOrderList,
  OnlineOrderListQuery,
  OnlineOrderStatus,
  OnlineOrderStatusChange,
  OnlineOrderStockHold,
  OnlineOrderSummary,
  RecordOnlineOrderPaymentInput,
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

/** "Jane Doe" for the signed-in user — written into the order's history next to what they did. */
function actor(): { id: string; name: string } {
  const session = getSession();
  if (!session) throw new Error("You must be signed in to do that");
  return {
    id: session.employee.id,
    name: `${session.employee.firstName} ${session.employee.lastName}`.trim()
  };
}

/** Adds each line's picture + SKU from the local product (the cloud order only knows ids/names). */
function withLocalProductInfo(order: OnlineOrder): OnlineOrder {
  return {
    ...order,
    payments: order.payments ?? [],
    history: order.history ?? [],
    items: order.items.map((item) => {
      const row = productRepository.findProductRowById(item.productId);
      if (!row) return item;
      const online = productRepository.mapProductRow(row).onlineImageUrls[0];
      return { ...item, imageUrl: online?.thumbUrl ?? online?.url ?? null, imagePath: row.image_path, sku: row.sku };
    })
  };
}

export async function listOnlineOrders(query: OnlineOrderListQuery): Promise<OnlineOrderList> {
  const result = await postShopAdmin<OnlineOrderList>("/shop-admin/orders", {
    ...(query.statuses === "ALL" ? { status: "ALL" } : { statuses: query.statuses }),
    page: query.page,
    pageSize: 30,
    ...(query.search ? { search: query.search } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {})
  });
  return { ...result, orders: result.orders.map(withLocalProductInfo) };
}

/** Cheap poll behind the sidebar badge / new-order alerts. */
export function onlineOrderSummary(): Promise<OnlineOrderSummary> {
  return postShopAdmin<OnlineOrderSummary>("/shop-admin/orders/summary", {});
}

// --- Stock hold: a confirmed order's items are taken out of the branch so the till can't sell them
// again. online_hold movements when it's confirmed (or moved past pending without one — older
// orders), online_release when it's cancelled / un-confirmed (here) or completed (inside the sale's
// own transaction, convertOnlineOrderToSale). The cloud order records the hold, and SERVER clears it
// atomically, so exactly one till ever gives it back.

/** Steps after pending: the order's stock must be held from here on. */
const HOLDING_STATUSES: ReadonlySet<OnlineOrderStatus> = new Set(["CONFIRMED", "READY", "SHIPPED", "PICKED_UP", "DELIVERED"]);

/** Quantities per product (variants share their product's stock), stock-tracked products only. */
function holdItemsFor(order: OnlineOrder, tenantId: string): OnlineOrderStockHold["items"] {
  const qty = new Map<string, number>();
  for (const item of order.items) {
    const row = productRepository.findProductRowById(item.productId);
    if (!row || row.tenant_id !== tenantId) {
      throw new Error(`"${item.name}" isn't on this computer yet — run Cloud Sync, then try again.`);
    }
    if (row.track_stock) qty.set(item.productId, (qty.get(item.productId) ?? 0) + item.qty);
  }
  return [...qty].map(([productId, q]) => ({ productId, qty: q }));
}

/** Writes the hold / release movements. Call inside a transaction. */
function moveHeldStock(
  kind: "online_hold" | "online_release",
  order: Pick<OnlineOrder, "id" | "orderNumber">,
  hold: Pick<OnlineOrderStockHold, "locationId" | "items">,
  tenantId: string,
  employeeId: string
): void {
  for (const item of hold.items) {
    applyValidatedStockMovement(
      {
        productId: item.productId,
        locationId: hold.locationId,
        movementType: kind,
        quantityChange: kind === "online_hold" ? -item.qty : item.qty,
        referenceType: "online_order",
        referenceId: order.id,
        performedBy: employeeId,
        notes: `Web order ${order.orderNumber}`
      },
      tenantId
    );
  }
}

/** Gives held stock back — unless this order already became a sale here (its hold was released in
 * that sale's transaction; only the cloud link was missing). */
function releaseHeldStock(order: OnlineOrder, hold: OnlineOrderStockHold, tenantId: string, employeeId: string): void {
  if (saleRepository.findSaleByNoteMarkerRow(tenantId, `[Web order ${order.orderNumber}]`)) return;
  runInTransaction(() => moveHeldStock("online_release", order, hold, tenantId, employeeId));
}

/** One step forward/back, cancel or reopen — SERVER refuses anything out of order. Moving past
 * pending holds the order's stock (refused, with the product and what's available, if the branch
 * doesn't have it); going back to pending or cancelling gives it back. */
export async function setOnlineOrderStatus(input: OnlineOrderStatusChange): Promise<OnlineOrder> {
  requirePermission("online_store", "edit");
  const { tenantId } = getCurrentTenant();
  const who = actor();
  let riderName: string | null = null;
  if (input.status === "SHIPPED" && input.riderId) {
    const rider = riderRepository.findRiderRowById(input.riderId);
    if (!rider || rider.tenant_id !== tenantId) throw new Error("Rider not found");
    riderName = rider.name;
  }

  const current = await getOnlineOrder(input.id);
  let hold: Pick<OnlineOrderStockHold, "locationId" | "items"> | null = null;
  if (HOLDING_STATUSES.has(input.status) && !current.stockHold && current.status !== input.status && isOpenOrder(current)) {
    const { locationId } = requireActiveSession(input.storefrontId ?? current.fulfilmentLocationId);
    hold = { locationId, items: holdItemsFor(current, tenantId) };
    const taken = hold;
    runInTransaction(() => moveHeldStock("online_hold", current, taken, tenantId, who.id));
  }

  let result: OnlineOrder & { holdAccepted?: boolean; releasedHold?: OnlineOrderStockHold | null };
  try {
    result = await postShopAdmin("/shop-admin/orders/status", {
      id: input.id,
      status: input.status,
      riderId: input.status === "SHIPPED" ? (input.riderId ?? null) : null,
      riderName,
      stockHold: hold,
      actorName: who.name
    });
  } catch (err) {
    // The step didn't happen — put back what we just held.
    if (hold) {
      const taken = hold;
      runInTransaction(() => moveHeldStock("online_release", current, taken, tenantId, who.id));
    }
    throw err;
  }

  // Another till got there first and already holds this order's stock — ours is surplus.
  if (hold && !result.holdAccepted) {
    const taken = hold;
    runInTransaction(() => moveHeldStock("online_release", current, taken, tenantId, who.id));
  }
  if (result.releasedHold) releaseHeldStock(current, result.releasedHold, tenantId, who.id);

  const { holdAccepted: _accepted, releasedHold: _released, ...order } = result;
  return withLocalProductInfo(order);
}

function isOpenOrder(order: OnlineOrder): boolean {
  return order.status !== "COMPLETED" && order.status !== "CANCELLED" && !order.linkedSaleId;
}

/** Validates the payment method locally (this POS owns them), then records the payment on the cloud
 * order — SERVER refuses anything above what's still owed. */
export async function recordOnlineOrderPayment(input: RecordOnlineOrderPaymentInput): Promise<OnlineOrder> {
  requirePermission("online_store", "edit");
  const { tenantId } = getCurrentTenant();
  const method = paymentMethodRepository.findPaymentMethodRowById(input.paymentMethodId);
  if (!method || method.tenant_id !== tenantId) throw new Error("Payment method not found");
  if (!method.is_active) throw new Error(`"${method.name}" is not active`);
  const reference = input.reference?.trim() || null;
  if (method.requires_reference && !reference) throw new Error(`${method.name} needs a reference (e.g. the M-Pesa code).`);
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Enter the amount received.");

  const who = actor();
  const order = await postShopAdmin<OnlineOrder>("/shop-admin/orders/payment/add", {
    id: input.orderId,
    paymentMethodId: method.id,
    paymentMethodName: method.name,
    amountCents: input.amountCents,
    reference,
    notes: input.notes?.trim() || null,
    receivedBy: who.id,
    receivedByName: who.name
  });
  return withLocalProductInfo(order);
}

export async function removeOnlineOrderPayment(orderId: string, paymentId: string): Promise<OnlineOrder> {
  requirePermission("online_store", "edit");
  const order = await postShopAdmin<OnlineOrder>("/shop-admin/orders/payment/remove", {
    id: orderId,
    paymentId,
    actorName: actor().name
  });
  return withLocalProductInfo(order);
}

export async function setOnlineOrderFulfilment(input: OnlineOrderFulfilmentInput): Promise<OnlineOrder> {
  requirePermission("online_store", "edit");
  const order = await postShopAdmin<OnlineOrder>("/shop-admin/orders/fulfilment", {
    id: input.orderId,
    deliveryType: input.deliveryType,
    deliveryAddress: input.deliveryAddress?.trim() || null,
    deliveryMethodId: input.deliveryMethodId || null,
    actorName: actor().name
  });
  return withLocalProductInfo(order);
}

/** No ids = mark every unseen order as seen. */
export function markOnlineOrdersSeen(ids?: string[]): Promise<{ marked: number }> {
  return postShopAdmin<{ marked: number }>("/shop-admin/orders/seen", ids ? { ids } : {});
}

export function getOnlineOrder(id: string): Promise<OnlineOrder> {
  return postShopAdmin<OnlineOrder>("/shop-admin/orders/get", { id });
}

const HANDED_OVER: ReadonlySet<OnlineOrderStatus> = new Set(["PICKED_UP", "DELIVERED"]);

function amount(currency: string, cents: number): string {
  return `${currency} ${(cents / 100).toFixed(2)}`.trim();
}

function linkSale(orderId: string, saleId: string, receiptNumber: string | null): Promise<OnlineOrder> {
  return postShopAdmin<OnlineOrder>("/shop-admin/orders/link-sale", {
    id: orderId,
    saleId,
    receiptNumber,
    actorName: actor().name
  });
}

/**
 * "Complete": turns a picked-up / delivered web order into a normal completed POS sale — same cart
 * math, tax, stock validation and receipt numbering as Checkout (prepareCart +
 * insertCompletedSaleFromCart), so it syncs, reports and prints like any other sale. Then completes +
 * links the cloud order.
 *
 * - Prices: the website's own unit prices, VAT treated as INCLUSIVE — the customer pays exactly what
 *   the website showed (tax extracted, still reported), never the website price plus VAT on top. So
 *   the sale's grand total is the order total, and the payments taken on the order add up to it.
 * - Payments: every payment recorded on the order (plus `finalPayment`, recorded on the order first)
 *   becomes the sale's payments, with its original method, reference, who took it and when. They
 *   must add up to exactly the total — a balance still owed is refused.
 * - Delivery order → a real delivery note on the sale (DN-…: customer, address, the rider it shipped
 *   with, the delivery fee), already marked delivered. The fee is part of the total like at Checkout.
 * - Customer: a walk-in labelled "Jane Doe · Web order WEB-0012" — never matched to (or creating) a
 *   customer record, so a web order can't land on the wrong account.
 * - Never twice: refused if the cloud order is already linked, or if a local sale already carries
 *   this order's marker (covers "sale saved, cloud link failed offline").
 */
export async function convertOnlineOrderToSale(input: ConvertOnlineOrderInput): Promise<ConvertOnlineOrderResult> {
  requirePermission("online_store", "edit");
  requirePermission("sales", "create");

  let order = await getOnlineOrder(input.orderId);
  if (order.linkedSaleId) {
    throw new Error(`${order.orderNumber} was already completed as receipt ${order.linkedReceiptNumber ?? order.linkedSaleId}.`);
  }
  if (!HANDED_OVER.has(order.status)) {
    const route = order.deliveryType === "pickup" ? "picked up" : "delivered";
    throw new Error(`Mark ${order.orderNumber} ${route} before completing it.`);
  }

  const { tenantId, employeeId, locationId } = requireActiveSession(
    input.storefrontId ?? order.stockHold?.locationId ?? order.fulfilmentLocationId
  );

  // Sale already saved here on an earlier try whose cloud link failed (offline) — just link it now.
  const marker = `[Web order ${order.orderNumber}]`;
  const previous = saleRepository.findSaleByNoteMarkerRow(tenantId, marker);
  if (previous) {
    await linkSale(order.id, previous.id, previous.receipt_number);
    const previousSale = saleRepository.findSaleRowById(previous.id);
    return {
      saleId: previous.id,
      receiptNumber: previous.receipt_number,
      grandTotalCents: previousSale?.grand_total_cents ?? order.totalCents,
      customerLabel: `Walk-in: ${order.customerName}`,
      deliveryNoteNumber: deliveryNoteRepository.findDeliveryNoteRowBySaleId(previous.id)?.delivery_note_number ?? null,
      linkWarning: null
    };
  }

  // A product published online but not yet pulled to THIS computer can't be sold from here.
  for (const item of order.items) {
    const row = productRepository.findProductRowById(item.productId);
    if (!row || row.tenant_id !== tenantId) {
      throw new Error(`"${item.name}" isn't on this computer yet — run Cloud Sync, then try again.`);
    }
  }

  const isDelivery = order.deliveryType !== "pickup";
  // Validate everything that can fail locally (prices, totals) BEFORE taking a final payment online,
  // so a doomed completion doesn't leave a stray payment on the order.
  const cart = prepareCart(
      tenantId,
      order.items.map((item) => ({
        productId: item.productId,
        quantity: item.qty,
        discountAmountCents: 0,
        unitPriceCents: item.unitPriceCents,
        taxInclusiveOverride: true,
        // The shopper's variant, when it's still a live variant on this computer — a variant switched
        // off/removed since the order still rings up (as the plain product, at the web price).
        variantKey: liveVariantKey(item.productId, item.variantKey)
      })),
      {
        serviceCharges: [],
        delivery: isDelivery
          ? {
              riderId: order.riderId && riderRepository.findRiderRowById(order.riderId) ? order.riderId : null,
              recipientName: order.customerName.slice(0, 150),
              country: null,
              town: null,
              physicalAddress: (order.deliveryAddress?.trim() || "—").slice(0, 500),
              notes: [order.deliveryMethodName, order.customerPhone].filter(Boolean).join(" · ").slice(0, 500) || null,
              feeCents: order.deliveryFeeCents,
              costCents: 0
            }
          : null
      }
    );

  if (cart.grandTotalCents !== order.totalCents) {
    const website = amount(order.currency, order.totalCents);
    const here = amount(order.currency, cart.grandTotalCents);
    throw new Error(`${order.orderNumber} totals ${website} on the website but ${here} here — check the products' prices, then try again.`);
  }

  if (input.finalPayment && input.finalPayment.amountCents > 0) {
    order = await recordOnlineOrderPayment({
      orderId: order.id,
      paymentMethodId: input.finalPayment.paymentMethodId,
      amountCents: input.finalPayment.amountCents,
      reference: input.finalPayment.reference,
      notes: null
    });
  }

  const payments: SalePayment[] = [...order.payments].sort((a, b) => b.amountCents - a.amountCents);
  const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
  if (paidCents !== cart.grandTotalCents) {
    throw new Error(
      paidCents < cart.grandTotalCents
        ? `${amount(order.currency, cart.grandTotalCents - paidCents)} is still owed on ${order.orderNumber} — record it before completing.`
        : `${order.orderNumber} has ${amount(order.currency, paidCents - cart.grandTotalCents)} more in payments than its total — remove the extra payment first.`
    );
  }
  for (const p of payments) {
    const method = paymentMethodRepository.findPaymentMethodRowById(p.paymentMethodId);
    if (!method || method.tenant_id !== tenantId) {
      throw new Error(`The payment method "${p.paymentMethodName}" isn't on this computer — run Cloud Sync, then try again.`);
    }
  }
  const primary = payments[0]!;
  const heldStock = order.stockHold;

  const noteParts = [marker, `${order.customerName} ${order.customerPhone}`];
  if (order.notes) noteParts.push(order.notes);

  const sale = insertCompletedSaleFromCart({
    tenantId,
    employeeId,
    locationId,
    customerId: null,
    walkInName: `${order.customerName} · Web order ${order.orderNumber}`.slice(0, 150),
    cart,
    paymentMethodId: primary.paymentMethodId,
    paymentReference: primary.reference,
    amountReceivedCents: cart.grandTotalCents,
    notes: noteParts.join(" · "),
    // A single payment is fully described by the sale's own method columns (same as Checkout);
    // two or more keep each one, which reports then split by method.
    ...(payments.length > 1 ? { payments } : {}),
    // The confirmed order's held stock goes back first, then the sale takes it — one transaction, so
    // stock history shows a proper sale and nothing is ever double-counted.
    ...(heldStock ? { beforeStockMovements: () => moveHeldStock("online_release", order, heldStock, tenantId, employeeId) } : {})
  });

  // The goods already reached the customer — the delivery note starts life delivered.
  let deliveryNoteNumber: string | null = null;
  if (isDelivery) {
    const note = deliveryNoteRepository.findDeliveryNoteRowBySaleId(sale.id);
    if (note) {
      deliveryNoteNumber = deliveryNoteRepository.setDeliveryNoteDeliveredRow(note.id, true).delivery_note_number;
    }
  }

  let linkWarning: string | null = null;
  try {
    await linkSale(order.id, sale.id, sale.receiptNumber);
  } catch (err) {
    linkWarning = `Sale recorded, but ${order.orderNumber} couldn't be marked completed online (${
      err instanceof Error ? err.message : "no connection"
    }). Open it again once you're back online.`;
  }

  return {
    saleId: sale.id,
    receiptNumber: sale.receiptNumber,
    grandTotalCents: cart.grandTotalCents,
    customerLabel: `Walk-in: ${order.customerName}`,
    deliveryNoteNumber,
    linkWarning
  };
}
