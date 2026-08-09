import electron from "electron";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { API_BASE_URL } from "@main/services/license-service";
import type { BillingPesapalStatusResult, BillingPesapalSubmitOrderResult } from "@shared/types/billing-pesapal";

const { BrowserWindow } = electron;

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

/** Opens Pesapal's hosted checkout page in its own dedicated Electron BrowserWindow — a real,
 * separate OS-level window (own process-isolated webContents, no preload, no access to this app's
 * renderer/IPC), not an iframe embedded inside our own UI. Auto-closes once the page navigates to
 * OUR OWN /billing-pesapal/callback URL (Pesapal's own redirect target after checkout finishes) —
 * DESKTOP's own passive/active polling, not this window, is what actually determines the outcome. */
export function openPesapalCheckout(redirectUrl: string): void {
  const parent = BrowserWindow.getFocusedWindow() ?? undefined;
  const checkoutWindow = new BrowserWindow({
    width: 480,
    height: 720,
    ...(parent ? { parent, modal: true } : {}),
    title: "Blue Ledger POS — Secure Checkout",
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Without its own partition this window shares the app's default session — which has our OWN
      // renderer's restrictive CSP injected onto every response in that session (see
      // main-window.ts's session.webRequest.onHeadersReceived hook). That CSP was only ever meant
      // for our own UI, but a shared session applies it to every page loaded anywhere in that
      // session, including this one — silently breaking Pesapal's own cross-domain requests (their
      // M-Pesa option calls www.pesapal.com from within pay.pesapal.com) with ERR_BLOCKED_BY_CSP.
      // No "persist:" prefix — in-memory only, isolated per app run, nothing lingers after close.
      partition: "pesapal-checkout"
    }
  });

  void checkoutWindow.loadURL(redirectUrl);

  checkoutWindow.webContents.on("did-navigate", (_event, url) => {
    if (url.includes("/billing-pesapal/callback") && !checkoutWindow.isDestroyed()) {
      setTimeout(() => {
        if (!checkoutWindow.isDestroyed()) checkoutWindow.close();
      }, 1500);
    }
  });
}
