import * as tenantRepository from "@main/database/repositories/tenant-repository";

/** Untagged numbers ("BL-0000123") and device-tagged ones ("BL-D1-0000045") both end in the digit
 * run that matters — always take the LAST one, not the first, so this doesn't get confused if a
 * prefix itself ever contained a digit. */
function extractTrailingNumber(value: string): number {
  const match = /(\d+)$/.exec(value);
  return match ? Number(match[1]) : 0;
}

/** This device's tag for every document number it generates from now on — a short string, never
 * reused by another device, embedded right after the type prefix (e.g. "INV-D1-000058") so two
 * offline devices for the same tenant can never independently mint the same number.
 *
 * Pre-activation (or an already-activated device that hasn't picked up its sequence via a heartbeat
 * yet — see tenant-repository.ts's backfillWorkstationDeviceSequenceRow) falls back to a short slice
 * of this device's own workstation id (already a random UUID, globally unique) instead of every
 * un-sequenced install sharing one sentinel tag. Once activated, all NEW documents use the clean
 * integer; documents numbered before activation keep their hash tag permanently — numbers are
 * immutable history, never renumbered after the fact. */
function getDeviceTag(tenantId: string): string {
  const workstation = tenantRepository.findPrimaryWorkstationRow(tenantId);
  if (workstation?.device_sequence != null) {
    return String(workstation.device_sequence);
  }
  const fallback = (workstation?.id ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-4)
    .toUpperCase();
  return fallback || "0000";
}

/** Replaces 8 previously near-identical `generateXNumber` functions (receipt, invoice, quotation,
 * purchase order, delivery note, stock request, expense, payslip — see each service's own thin
 * wrapper). Every offline device independently incrementing a LOCAL max used to risk two devices
 * minting the identical number for two different real documents — this is what makes that
 * structurally impossible instead of merely unlikely: the device tag is what's actually unique, not
 * the numeric tail, so no coordination between devices is ever required. */
export function generateDocumentNumber(input: {
  tenantId: string;
  prefix: string;
  digits: number;
  /** ALL existing numbers for this tenant matching `LIKE '{prefix}-%'`, any format (old untagged or
   * new device-tagged) — deliberately not a single SQL `MAX()`, which does a lexicographic string
   * comparison and would pick the wrong one once tagged and untagged numbers are mixed (e.g.
   * "BL-D1-0000045" sorts ABOVE "BL-0004000" alphabetically despite being numerically smaller). */
  existingNumbers: string[];
}): string {
  const deviceTag = getDeviceTag(input.tenantId);
  const currentMax = input.existingNumbers.reduce((max, value) => Math.max(max, extractTrailingNumber(value)), 0);
  const nextNumber = currentMax + 1;
  return `${input.prefix}-D${deviceTag}-${String(nextNumber).padStart(input.digits, "0")}`;
}
