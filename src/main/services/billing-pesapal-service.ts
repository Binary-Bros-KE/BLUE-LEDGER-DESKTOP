import electron from "electron";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { API_BASE_URL } from "@main/services/license-service";
import type { BillingPesapalStatusResult, BillingPesapalSubmitOrderResult } from "@shared/types/billing-pesapal";

const { shell } = electron;

/**
 * Thin proxy to SERVER's own /billing-pesapal/* routes — a tenant paying Blue Ledger for their OWN
 * software subscription via Card/PayPal (Pesapal's hosted checkout), the Card/PayPal counterpart to
 * main/services/billing-mpesa-service.ts. Same license-key auth model, same deliberate lack of
 * `requirePermission` checks (this can be reached from the lockout screen before any employee is
 * logged in).
 */

function requireLicenseKey(): string {
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow?.license_key) {
    throw new Error("This installation hasn't been activated yet.");
  }
  return tenantRow.license_key;
}

async function callServer<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const licenseKey = requireLicenseKey();
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, licenseKey }),
      signal: AbortSignal.timeout(30_000)
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

export async function submitBillingPesapalOrder(input: {
  periodCount: number;
  enrollAutoBilling: boolean;
}): Promise<BillingPesapalSubmitOrderResult> {
  // deviceId is audit context only (see PesapalTransaction.initiatedByDeviceId) — never required for
  // authorization here, same as the M-Pesa flow.
  const deviceId = tenantRepository.findTenantRow()?.server_id ?? undefined;
  return callServer<BillingPesapalSubmitOrderResult>("/billing-pesapal/submit-order", { ...input, deviceId });
}

/** Passive — polled automatically. Never triggers a real Pesapal query server-side. */
export async function getPesapalStatus(orderTrackingId: string): Promise<BillingPesapalStatusResult> {
  return callServer<BillingPesapalStatusResult>("/billing-pesapal/status", { orderTrackingId });
}

/** Manual only — call ONLY in response to an explicit user "Check Status Now" click. */
export async function checkPesapalStatus(orderTrackingId: string): Promise<BillingPesapalStatusResult> {
  return callServer<BillingPesapalStatusResult>("/billing-pesapal/status/check", { orderTrackingId });
}

/** Opens Pesapal's hosted checkout page in the user's default system browser, never embedded in
 * Electron — this is a third-party PCI-scoped payment page, same reasoning every payment provider
 * recommends against iframing a checkout flow. */
export function openPesapalCheckout(redirectUrl: string): void {
  void shell.openExternal(redirectUrl);
}
