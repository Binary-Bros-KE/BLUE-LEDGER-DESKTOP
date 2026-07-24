import { getCloudIdentity } from "@main/services/sync-engine";
import { API_BASE_URL } from "@main/services/license-service";
import type { ShareDocumentEntity } from "@shared/types/share";

/** Mints a public share link for a receipt/invoice (Sale) or quotation — gated server-side by the
 * same {tenantId, deviceId} device identity every /sync/* call already sends (SERVER's
 * requireDevice). Mirrors the exact fetch shape license-service.ts's own activation calls use. */
export async function createShareLink(entity: ShareDocumentEntity, entityId: string): Promise<string> {
  const identity = getCloudIdentity();
  if (!identity) {
    throw new Error("Sharing needs cloud sync to be set up on this device first.");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/share/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: identity.tenantId, deviceId: identity.deviceId, entity, entityId }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new Error("Couldn't reach Blue Ledger's servers. Check your internet connection and try again.");
  }

  const body = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!response.ok || !body?.url) {
    throw new Error(body?.error ?? "Couldn't create a share link — try again.");
  }
  return body.url;
}
