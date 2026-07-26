import { getCloudIdentity } from "@main/services/sync-engine";
import { API_BASE_URL } from "@main/services/license-service";
import type { ShareDocumentEntity } from "@shared/types/share";

export type ShareLinkResult = { url: string; message: string };

/** Mints a public share link for a receipt/invoice (Sale) or quotation — gated server-side by the
 * same {tenantId, deviceId} device identity every /sync/* call already sends (SERVER's
 * requireDevice). Mirrors the exact fetch shape license-service.ts's own activation calls use.
 * `message` is the fully formatted WhatsApp/email text (emoji, dashed section separators, bold
 * totals) built server-side from the SAME view model the public page renders from — this device
 * never has to reconstruct it. */
export async function createShareLink(
  entity: ShareDocumentEntity,
  entityId: string,
  includePreview: boolean
): Promise<ShareLinkResult> {
  const identity = getCloudIdentity();
  if (!identity) {
    throw new Error("Sharing needs cloud sync to be set up on this device first.");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/share/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: identity.tenantId, deviceId: identity.deviceId, entity, entityId, includePreview }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new Error("Couldn't reach Blue Ledger's servers. Check your internet connection and try again.");
  }

  const body = (await response.json().catch(() => null)) as Partial<ShareLinkResult> & { error?: string } | null;
  if (!response.ok || !body?.url || !body.message) {
    throw new Error(body?.error ?? "Couldn't create a share link — try again.");
  }
  return { url: body.url, message: body.message };
}

/** Mints a share link for the delivery note attached to a sale/quotation — SERVER resolves it via
 * the PARENT's own id (a delivery note has no standalone id of its own to share by, it travels
 * inside Sale.delivery/Quotation.delivery), so entityId here is the same sale/quotation id already
 * used for createShareLink, just tagged with a `_delivery` entity so SERVER knows to build the
 * delivery-note view instead of the priced document. */
export async function createDeliveryShareLink(
  entity: ShareDocumentEntity,
  entityId: string,
  includePreview: boolean
): Promise<ShareLinkResult> {
  const identity = getCloudIdentity();
  if (!identity) {
    throw new Error("Sharing needs cloud sync to be set up on this device first.");
  }

  const deliveryEntity = entity === "sale" ? "sale_delivery" : "quotation_delivery";
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/share/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: identity.tenantId, deviceId: identity.deviceId, entity: deliveryEntity, entityId, includePreview }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new Error("Couldn't reach Blue Ledger's servers. Check your internet connection and try again.");
  }

  const body = (await response.json().catch(() => null)) as Partial<ShareLinkResult> & { error?: string } | null;
  if (!response.ok || !body?.url || !body.message) {
    throw new Error(body?.error ?? "Couldn't create a delivery note link — try again.");
  }
  return { url: body.url, message: body.message };
}
