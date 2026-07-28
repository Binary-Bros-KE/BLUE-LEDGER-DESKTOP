import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { API_BASE_URL } from "@main/services/license-service";

/**
 * Thin proxy to SERVER's own /billing-mpesa/* routes — a tenant paying Blue Ledger for their OWN
 * software subscription/maintenance, license-key-authenticated (like activation.ts), NOT device-
 * session-authenticated like the sales mpesa-service.ts. Deliberately doesn't require an employee
 * to be logged in at all — this can be called from the lockout screen itself (Pay Now), before any
 * session exists. No `requirePermission` checks here for that reason; whoever can physically reach
 * a Pay Now button on this machine is allowed to pay off this installation's own bill.
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

export type BillingStkPushResult = {
  checkoutRequestId: string;
  merchantRequestId: string;
  amountCents: number;
  periods: string[];
};

export async function sendBillingStkPush(input: { phone: string; periodCount: number }): Promise<BillingStkPushResult> {
  // deviceId is audit context only (see BillingMpesaTransaction.initiatedByDeviceId) — never
  // required for authorization here, unlike the sales STK flow.
  const deviceId = tenantRepository.findTenantRow()?.server_id ?? undefined;
  return callServer<BillingStkPushResult>("/billing-mpesa/stk-push", { ...input, deviceId });
}

export type BillingMpesaStatusResult = {
  status: string;
  message: string;
  mpesaReceiptNumber: string | null;
  amountCents: number;
  phone: string;
};

/** Passive — polled automatically. Never triggers a real Safaricom query server-side. */
export async function getBillingStkStatus(checkoutRequestId: string): Promise<BillingMpesaStatusResult> {
  return callServer<BillingMpesaStatusResult>("/billing-mpesa/status", { checkoutRequestId });
}

/** Manual only — call ONLY in response to an explicit user "Check Status Now" click. */
export async function checkBillingStkStatus(checkoutRequestId: string): Promise<BillingMpesaStatusResult> {
  return callServer<BillingMpesaStatusResult>("/billing-mpesa/status/check", { checkoutRequestId });
}
