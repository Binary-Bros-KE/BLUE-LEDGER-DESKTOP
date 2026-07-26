/** Same East Africa country set already used for Timezone in the admin dashboard's
 * TenantFormModal.tsx — kept as its own small list here (not shared across packages, same
 * duplication convention already used for things like the BusinessType value list). "Custom" isn't
 * in this list — it's a distinct UI state (a free-text code field), not a country. */
export const EA_COUNTRY_CODES = [
  { code: "254", label: "Kenya" },
  { code: "256", label: "Uganda" },
  { code: "255", label: "Tanzania" },
  { code: "251", label: "Ethiopia" },
] as const;

/** WhatsApp's wa.me links need a bare countrycode+number, digits only, no leading zero. Users type
 * numbers in every shape imaginable ("0791880412", "791880412", "254791880412",
 * "+254791880412") — this normalizes any of them to the one WhatsApp actually accepts, given which
 * country code applies. Already-prefixed numbers pass through unchanged; anything else has its
 * local trunk "0" stripped and the code prepended. */
export function normalizePhoneForWhatsApp(rawNumber: string, countryCode: string): string {
  const digitsOnly = rawNumber.replace(/\D/g, "");
  const code = countryCode.replace(/\D/g, "");
  if (!code) return digitsOnly;
  if (digitsOnly.startsWith(code)) return digitsOnly;
  return `${code}${digitsOnly.replace(/^0+/, "")}`;
}
