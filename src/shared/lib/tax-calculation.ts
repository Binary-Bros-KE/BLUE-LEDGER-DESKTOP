import { TAX_TYPE_OPTIONS, type ProductTaxType } from "@shared/types/product";

/** Tenant's own tax regime — see shared/types/tenant.ts's TenantRecord. Never hardcoded to Kenya's
 * 16%: this app is headed for other East African markets with their own VAT rates. */
export type TenantTaxConfig = {
  vatRatePercent: number;
  /** Only the inclusive (divide) path below is actually implemented — this flag is stored and
   * carried through the schema for a future market that prices exclusive-of-tax, but there is
   * deliberately no exclusive (add-on) branch yet. Wiring it up is its own fast-follow. */
  pricesTaxInclusive: boolean;
};

export type LineTaxResult = {
  /** The line's price with tax extracted out — for "vat" this is strictly less than the gross
   * amount passed in; for "exempted"/"zero_rated" it equals the gross amount exactly (nothing to
   * extract). */
  netCents: number;
  /** Reporting-only — see this module's own header comment. Never added back to any total; the
   * gross amount passed in is already what the customer pays. */
  taxCents: number;
};

/**
 * Extracts tax from an already tax-inclusive gross amount — the marked/selling price already
 * contains VAT (Kenya's norm, and this app's only implemented pricing model today), so tax is
 * DIVIDED out for reporting, never added on top. A gross line of 400 at 16% VAT nets to 344.83
 * (tax 55.17) — not 400 + 64 = 464. Computing tax as `gross - net` (rather than `gross * rate /
 * (100 + rate)` independently) guarantees `net + tax === gross` exactly, no rounding drift between
 * the two figures.
 *
 * Every call site (sale-service.ts, quotation-service.ts, purchase-service.ts, cart-pricing.ts)
 * must use this instead of its own copy of the formula — this replaces three (soon four)
 * independently-duplicated versions of the same math.
 */
export function computeLineTax(
  grossAmountCents: number,
  taxType: ProductTaxType,
  tenantTaxConfig: TenantTaxConfig
): LineTaxResult {
  if (taxType !== "vat") {
    return { netCents: grossAmountCents, taxCents: 0 };
  }

  const netCents = Math.round(grossAmountCents / (1 + tenantTaxConfig.vatRatePercent / 100));
  return { netCents, taxCents: grossAmountCents - netCents };
}

export type TaxBreakdownEntry = {
  taxType: ProductTaxType;
  netCents: number;
  taxCents: number;
  grossCents: number;
};

/** Human label for one breakdown row — "Standard (16%)" uses the tenant's own configured rate,
 * never a hardcoded percentage. Shared by every document template (receipt/invoice/quotation,
 * on-screen and printed) so the wording never drifts between them. */
export function taxBreakdownLabel(taxType: ProductTaxType, tenantTaxConfig: TenantTaxConfig): string {
  if (taxType === "vat") return `Standard (${tenantTaxConfig.vatRatePercent}%)`;
  return TAX_TYPE_OPTIONS.find((option) => option.value === taxType)?.label ?? taxType;
}

/**
 * Groups a document's own line items (sale/quotation/purchase items — each already carries its own
 * frozen taxType + taxAmountCents + lineTotalCents from creation time) into one row per category
 * that actually has qualifying lines, in a stable category order (Standard, Exempted, Zero-Rated).
 * This is what every document's "tax breakdown" section (below the totals, never contributing to
 * them) renders from — see this module's own header comment for why tax is reporting-only.
 */
export function computeTaxBreakdown(
  lines: Array<{ taxType: ProductTaxType; taxAmountCents: number; lineTotalCents: number }>
): TaxBreakdownEntry[] {
  const byType = new Map<ProductTaxType, { netCents: number; taxCents: number; grossCents: number }>();
  for (const line of lines) {
    const entry = byType.get(line.taxType) ?? { netCents: 0, taxCents: 0, grossCents: 0 };
    entry.taxCents += line.taxAmountCents;
    entry.grossCents += line.lineTotalCents;
    entry.netCents += line.lineTotalCents - line.taxAmountCents;
    byType.set(line.taxType, entry);
  }

  return TAX_TYPE_OPTIONS.map((option) => option.value)
    .filter((type) => byType.has(type))
    .map((type) => ({ taxType: type, ...byType.get(type)! }));
}
