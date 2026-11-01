import { API_BASE_URL } from "@main/services/license-service";
import { getSession, requirePermission } from "@main/services/auth-service";
import { getCloudIdentity, resolveCloudRef } from "@main/services/sync-engine";
import * as saleRepository from "@main/database/repositories/sale-repository";
import { cacheVerificationMode, findLocalSaleUsingCode } from "@main/services/mpesa-verification-local";
import { mpesaCodeKey, parseMpesaVerifications } from "@shared/lib/mpesa-verification";
import type {
  MpesaPaymentMatch,
  MpesaVerificationMode,
  MpesaVerificationState,
  MpesaVerifications,
  MpesaVerifyResult
} from "@shared/types/mpesa";

/**
 * Thin proxy to SERVER's own /mpesa/* routes — nothing M-Pesa-related is computed or stored
 * locally. The Till credentials never touch this device's SQLite at all (see SERVER's
 * MpesaTillSettings model comment): the settings screen fetches them fresh over HTTPS only when
 * explicitly opened, and the actual STK push/status calls are made entirely server-side, where the
 * secret is looked up and used in the same request. This device only ever sends/receives the
 * non-secret bits (phone, amount, checkoutRequestId, status).
 */

/** "locations" is one of the five naturalKey-reconciled entities (see resolveCloudRef's own
 * comment) — this device's local location id is only usually the same as the cloud's id for that
 * same real storefront. M-Pesa's endpoints sit outside the generic sync push pipeline (which would
 * otherwise translate this for free via resolvePayloadRefsForPush), so every call here must resolve
 * explicitly or two devices could key the same storefront's Till settings under different ids. */
function resolveLocationId(locationId: string): string {
  return resolveCloudRef("locations", locationId) as string;
}

function requireCloudIdentity(): { tenantId: string; deviceId: string } {
  const identity = getCloudIdentity();
  if (!identity) {
    throw new Error("This device hasn't finished activating yet — can't reach the cloud for M-Pesa.");
  }
  return identity;
}

async function callServer<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const identity = requireCloudIdentity();
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...identity }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Could not reach the server — check your internet connection.");
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error((data as { error?: string }).error ?? "The server rejected this request");
  }
  return data;
}

export type MpesaTillSettingsInput = {
  environment: "sandbox" | "production";
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  tillNumber: string;
  accountReference: string;
};

/** Fetched fresh every time — never cached to disk. Returns null if this storefront has no Till
 * configured yet. */
export async function getMpesaTillSettings(locationId: string): Promise<MpesaTillSettingsInput | null> {
  requirePermission("locations", "edit");
  return callServer<MpesaTillSettingsInput | null>("/mpesa/settings/get", { locationId: resolveLocationId(locationId) });
}

export async function saveMpesaTillSettings(locationId: string, input: unknown): Promise<{ ok: true }> {
  requirePermission("locations", "edit");
  const settings = input as MpesaTillSettingsInput;
  return callServer<{ ok: true }>("/mpesa/settings/save", { locationId: resolveLocationId(locationId), ...settings });
}

export async function isMpesaConfigured(locationId: string): Promise<{ configured: boolean }> {
  requirePermission("sales", "create");
  return callServer<{ configured: boolean }>("/mpesa/configured", { locationId: resolveLocationId(locationId) });
}

// ---- verification (see SERVER's mpesa-verification-service.ts) ---------------------------------

/** Readable by anyone selling; also what keeps this till's cached mode current for offline strict. */
export async function getVerificationState(locationId: string): Promise<MpesaVerificationState> {
  requirePermission("sales", "view");
  const state = await callServer<MpesaVerificationState>("/mpesa/verification/state", { locationId: resolveLocationId(locationId) });
  cacheVerificationMode(locationId, state.available ? state.mode : "off");
  return state;
}

export async function saveVerificationMode(locationId: string, mode: MpesaVerificationMode): Promise<MpesaVerificationState> {
  requirePermission("locations", "edit");
  const state = await callServer<MpesaVerificationState>("/mpesa/verification/mode", { locationId: resolveLocationId(locationId), mode });
  cacheVerificationMode(locationId, state.mode);
  return state;
}

export async function connectVerification(locationId: string): Promise<MpesaVerificationState> {
  requirePermission("locations", "edit");
  return callServer<MpesaVerificationState>("/mpesa/verification/connect", { locationId: resolveLocationId(locationId) });
}

export async function checkPayment(input: { locationId: string; amountCents: number; claimKey: string }): Promise<MpesaPaymentMatch[]> {
  requirePermission("sales", "create");
  return callServer<MpesaPaymentMatch[]>("/mpesa/verification/check-payment", { ...input, locationId: resolveLocationId(input.locationId) });
}

export async function verifyCode(input: { locationId: string; code: string; amountCents: number | null; claimKey: string }): Promise<MpesaVerifyResult> {
  requirePermission("sales", "create");
  return callServer<MpesaVerifyResult>("/mpesa/verification/verify", {
    ...input,
    locationId: resolveLocationId(input.locationId),
    employeeId: getSession()?.employee.id
  });
}

/** Best effort after a sale is saved: if it fails, the reservation lapses, but the code is on the
 * synced sale by then, which the server also checks before letting it be used again. */
export async function attachClaim(input: { claimKey: string; saleId: string }): Promise<void> {
  requirePermission("sales", "create");
  await callServer("/mpesa/verification/attach", input);
}

/** Verify a sale's recorded code, or (admin only) try a different one. The sale changes only after
 * the server confirms the code is a real, unused payment on this till; on any failure the old code
 * stays exactly as it was. */
export async function verifySaleCode(input: { saleId: string; code: string; replacesCode: string | null }): Promise<MpesaVerifyResult> {
  requirePermission("sales", "view");
  const code = mpesaCodeKey(input.code);
  const replacesCode = input.replacesCode ? mpesaCodeKey(input.replacesCode) : null;
  const isCorrection = replacesCode !== null && replacesCode !== code;
  if (isCorrection) requirePermission("approvals", "approve");

  const row = saleRepository.findSaleRowById(input.saleId);
  if (!row) throw new Error("Sale not found");
  const payments = JSON.parse(row.payments) as Array<{ reference?: string | null; amountCents?: number }>;
  const entry = payments.find((p) => p.reference && mpesaCodeKey(p.reference) === replacesCode);

  if (findLocalSaleUsingCode(code, input.saleId)) {
    return { outcome: "already_used", code, message: `${code} is already recorded on another sale.`, record: null };
  }

  const result = await callServer<MpesaVerifyResult>("/mpesa/verification/verify-sale", {
    saleId: input.saleId,
    locationId: resolveLocationId(row.location_id),
    code,
    replacesCode: isCorrection ? replacesCode : null,
    amountCents: entry?.amountCents ?? (payments.length === 0 ? row.grand_total_cents : null),
    employeeId: getSession()?.employee.id
  });
  if (result.outcome !== "verified" || !result.record) return result;

  const verifications: MpesaVerifications = { ...(parseMpesaVerifications(row.mpesa_verifications) ?? {}) };
  if (isCorrection && replacesCode) delete verifications[replacesCode];
  verifications[code] = result.record;
  if (isCorrection) {
    saleRepository.replaceSaleMpesaCodeRow(input.saleId, {
      paymentReference: row.payment_reference && mpesaCodeKey(row.payment_reference) === replacesCode ? code : row.payment_reference,
      paymentsJson: JSON.stringify(payments.map((p) => (p.reference && mpesaCodeKey(p.reference) === replacesCode ? { ...p, reference: code } : p))),
      verifications
    });
  } else {
    saleRepository.updateSaleMpesaVerificationsRow(input.saleId, verifications);
  }
  return result;
}

export type StkPushResult = { checkoutRequestId: string; merchantRequestId: string };

export async function sendStkPush(input: { locationId: string; phone: string; amountCents: number }): Promise<StkPushResult> {
  requirePermission("sales", "create");
  // Who initiated it is audit context, sourced from the session itself — never taken from
  // renderer input, same discipline as requireActiveSession's own locationId/employeeId handling.
  const employeeId = getSession()?.employee.id;
  return callServer<StkPushResult>("/mpesa/stk-push", {
    ...input,
    locationId: resolveLocationId(input.locationId),
    employeeId
  });
}

export type MpesaStatusResult = {
  status: string;
  message: string;
  mpesaReceiptNumber: string | null;
  amountCents: number;
  phone: string;
};

/** Passive — polled automatically while showing "waiting for customer to enter PIN." Never triggers
 * a real Safaricom query server-side, just reads the transaction's own current status. */
export async function getStkStatus(checkoutRequestId: string): Promise<MpesaStatusResult> {
  requirePermission("sales", "create");
  return callServer<MpesaStatusResult>("/mpesa/status", { checkoutRequestId });
}

/** Manual only — call ONLY in response to an explicit cashier "Check Status Now" click (the STK is
 * taking a while recovery case). Actively re-queries Safaricom server-side, throttled there. */
export async function checkStkStatus(checkoutRequestId: string): Promise<MpesaStatusResult> {
  requirePermission("sales", "create");
  return callServer<MpesaStatusResult>("/mpesa/status/check", { checkoutRequestId });
}
