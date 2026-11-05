import { z } from "zod";
import { getDatabase } from "@main/database/connection";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import { mpesaCodeKey } from "@shared/lib/mpesa-verification";
import type { MpesaVerificationMode, MpesaVerificationRecord, MpesaVerifications } from "@shared/types/mpesa";
import type { Sale } from "@shared/types/sale";

/**
 * The till's own half of M-Pesa verification, which must work with no connection: the last known
 * mode per storefront, strict-mode enforcement before a sale is written, and stamping each M-Pesa code
 * onto the sale as verified or unverified. Everything that talks to SERVER is in mpesa-service.ts.
 */

const modeKey = (locationId: string): string => `mpesa_verification_mode:${locationId}`;

/** Refreshed whenever a screen fetches the storefront's state, so strict still holds offline. */
export function cacheVerificationMode(locationId: string, mode: MpesaVerificationMode): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(modeKey(locationId), JSON.stringify(mode), new Date().toISOString());
}

/** "off" until this till has learned otherwise: a shop with no till credentials never sees any of this. */
export function getCachedVerificationMode(locationId: string): MpesaVerificationMode {
  const row = getDatabase().prepare("SELECT value_json FROM app_settings WHERE key = ?").get(modeKey(locationId)) as
    | { value_json: string }
    | undefined;
  if (!row) return "off";
  try {
    const mode: unknown = JSON.parse(row.value_json);
    return mode === "loose" || mode === "strict" ? mode : "off";
  } catch {
    return "off";
  }
}

const providedSchema = z.object({
  mpesaVerifications: z
    .record(
      z.string(),
      z.object({
        status: z.enum(["verified", "unverified"]),
        verifiedAt: z.string().nullable(),
        payerName: z.string().nullable(),
        amountCents: z.number().nullable()
      })
    )
    .nullable()
    .optional()
});

/** What the renderer verified for this document, read off any sale/invoice/payment input. */
export function readProvidedVerifications(input: unknown): MpesaVerifications {
  const parsed = providedSchema.safeParse(input);
  const provided = parsed.success ? (parsed.data.mpesaVerifications ?? {}) : {};
  const normalized: MpesaVerifications = {};
  for (const [code, record] of Object.entries(provided)) normalized[mpesaCodeKey(code)] = record;
  return normalized;
}

type PaymentEntry = { paymentMethodId: string | null; reference: string | null };

function isMpesaMethod(paymentMethodId: string | null): boolean {
  if (!paymentMethodId) return false;
  return paymentMethodRepository.findPaymentMethodRowById(paymentMethodId)?.code === "MPESA";
}

/** Every payment on any of the inputs that take one: checkout (single or split), a converted quotation,
 * an invoice's initial payment, a recorded invoice payment. */
function paymentEntriesOf(input: unknown): PaymentEntry[] {
  const source = (input ?? {}) as {
    paymentMethodId?: string | null;
    paymentReference?: string | null;
    reference?: string | null;
    payments?: Array<{ paymentMethodId?: string | null; reference?: string | null }> | null;
    initialPayment?: { paymentMethodId?: string | null; reference?: string | null } | null;
  };
  if (source.payments && source.payments.length > 1) {
    return source.payments.map((p) => ({ paymentMethodId: p.paymentMethodId ?? null, reference: p.reference ?? null }));
  }
  if (source.initialPayment) {
    return [{ paymentMethodId: source.initialPayment.paymentMethodId ?? null, reference: source.initialPayment.reference ?? null }];
  }
  return [{ paymentMethodId: source.paymentMethodId ?? null, reference: source.paymentReference ?? source.reference ?? null }];
}

/** Strict mode: every M-Pesa payment must carry a verified code before anything is written. Offline
 * this blocks M-Pesa on purpose (nothing can be verified), and the cashier takes another method. */
export function assertStrictVerification(locationId: string, input: unknown): void {
  if (getCachedVerificationMode(locationId) !== "strict") return;
  const provided = readProvidedVerifications(input);
  for (const entry of paymentEntriesOf(input)) {
    if (!isMpesaMethod(entry.paymentMethodId)) continue;
    const code = entry.reference ? mpesaCodeKey(entry.reference) : "";
    if (!code || provided[code]?.status !== "verified") {
      throw new Error("This storefront requires verified M-Pesa payments. Verify the M-Pesa code before completing.");
    }
  }
}

const UNVERIFIED: MpesaVerificationRecord = { status: "unverified", verifiedAt: null, payerName: null, amountCents: null };

/** Records each M-Pesa code on the sale. With verification off (or no credentials) nothing is written,
 * and no record is what hides the indicator everywhere for those shops. */
export function stampSaleVerifications(sale: Sale, input: unknown): Sale {
  const mode = getCachedVerificationMode(sale.locationId);
  if (mode === "off") return sale;

  const provided = readProvidedVerifications(input);
  const next: MpesaVerifications = { ...(sale.mpesaVerifications ?? {}) };
  const entries: PaymentEntry[] = [
    { paymentMethodId: sale.paymentMethodId, reference: sale.paymentReference },
    ...sale.payments.map((p) => ({ paymentMethodId: p.paymentMethodId, reference: p.reference }))
  ];
  for (const entry of entries) {
    if (!entry.reference || !isMpesaMethod(entry.paymentMethodId)) continue;
    const code = mpesaCodeKey(entry.reference);
    next[code] = provided[code] ?? next[code] ?? UNVERIFIED;
  }
  if (Object.keys(next).length === 0) return sale;

  saleRepository.updateSaleMpesaVerificationsRow(sale.id, next);
  return { ...sale, mpesaVerifications: next };
}

/** Another of THIS till's sales already carrying this code — the server can't see sales not yet synced. */
export function findLocalSaleUsingCode(code: string, exceptSaleId: string): string | null {
  const key = mpesaCodeKey(code);
  const row = getDatabase()
    .prepare(
      `SELECT id FROM sales
       WHERE id != ? AND sale_status != 'suspended'
         AND (UPPER(TRIM(payment_reference)) = ? OR UPPER(payments) LIKE ?)
       LIMIT 1`
    )
    .get(exceptSaleId, key, `%"REFERENCE":"${key}"%`) as { id: string } | undefined;
  return row?.id ?? null;
}
