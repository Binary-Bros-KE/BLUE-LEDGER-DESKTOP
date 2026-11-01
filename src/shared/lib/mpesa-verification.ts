import type { MpesaVerificationSummary, MpesaVerifications } from "@shared/types/mpesa";

/** Codes are stored and compared uppercase and trimmed, however they were typed. */
export function mpesaCodeKey(code: string): string {
  return code.trim().toUpperCase();
}

/** One code's indicator: null means no verification in play, so nothing is shown at all. */
export function mpesaStatusForCode(verifications: MpesaVerifications | null | undefined, code: string | null | undefined): MpesaVerificationSummary {
  if (!verifications || !code) return null;
  return verifications[mpesaCodeKey(code)]?.status ?? null;
}

/** A whole sale's indicator (receipts list): any unverified code makes the sale unverified. */
export function mpesaStatusForSale(verifications: MpesaVerifications | null | undefined): MpesaVerificationSummary {
  const records = Object.values(verifications ?? {});
  if (records.length === 0) return null;
  return records.every((record) => record.status === "verified") ? "verified" : "unverified";
}

export function parseMpesaVerifications(json: string | null | undefined): MpesaVerifications | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as MpesaVerifications;
  } catch {
    return null;
  }
}
