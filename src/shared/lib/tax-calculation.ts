import { TAX_TYPE_OPTIONS, type ProductTaxType } from "@shared/types/product";

/** Tenant's own tax regime — see shared/types/tenant.ts's TenantRecord. Never hardcoded to Kenya's
 * 16%: this app is headed for other East African markets with their own VAT rates, and even within
 * Kenya a tenant can change their own rate in Business Profile settings. */
export type TenantTaxConfig = {
  vatRatePercent: number;
  /** Which of the two branches below applies. Both are real, fully wired paths — see
   * computeLineTax's own comment for the two formulas. */
  pricesTaxInclusive: boolean;
};

export type LineTaxResult = {
  /** The amount actually charged for this line — equals the input amount when pricesTaxInclusive
   * (tax was already embedded in the entered price), or input + taxCents when exclusive (tax gets
   * added on top). Every caller uses THIS for lineTotalCents — never its own input amount — so an
   * exclusive-priced line's total reflects the tax that was actually added. */
  grossCents: number;
  /** The line's price with tax excluded — for "vat" this is strictly less than grossCents; for
   * "exempted"/"zero_rated" it equals grossCents exactly (nothing to extract or add). */
  netCents: number;
  /** Reporting-only — see this module's own header comment. Always satisfies
   * netCents + taxCents === grossCents exactly, in both modes, no rounding drift between them. */
  taxCents: number;
};

/**
 * Two real, distinct pricing models. The tenant's own Business Profile setting is only the DEFAULT —
 * any individual product can override it via its own `pricesTaxInclusive` (see resolveProductTaxConfig
 * below), since a real catalog is rarely uniform. Callers always resolve through
 * resolveProductTaxConfig before reaching this function; `tenantTaxConfig` here is already the
 * per-product-resolved effective config, not necessarily the tenant's raw default:
 *
 * - Inclusive (Kenya's norm): the entered/marked price already CONTAINS VAT, so tax is DIVIDED out
 *   of it for reporting, never added on top. A gross line of 400 at 16% VAT nets to 344.83 (tax
 *   55.17) — not 400 + 64 = 464. The customer pays exactly the entered amount either way.
 * - Exclusive: the entered price is the PRE-TAX (net) amount, so tax is ADDED on top to get what's
 *   actually charged. A net line of 400 at 16% VAT charges 464 (tax 64) — the customer pays MORE
 *   than the entered amount, unlike the inclusive case.
 *
 * Computing tax as `gross - net` (inclusive) or `net * rate` then `net + tax` (exclusive) — rather
 * than deriving all three independently — guarantees `net + tax === gross` exactly in both modes,
 * no rounding drift between the three figures.
 *
 * Every call site (sale-service.ts, quotation-service.ts, purchase-service.ts, cart-pricing.ts)
 * must use this instead of its own copy of the formula — one shared implementation, not four
 * independently-duplicated (and previously inclusive-only) versions of the same math.
 */
export function computeLineTax(
  amountCents: number,
  taxType: ProductTaxType,
  tenantTaxConfig: TenantTaxConfig
): LineTaxResult {
  if (taxType !== "vat") {
    return { grossCents: amountCents, netCents: amountCents, taxCents: 0 };
  }

  if (tenantTaxConfig.pricesTaxInclusive) {
    const netCents = Math.round(amountCents / (1 + tenantTaxConfig.vatRatePercent / 100));
    return { grossCents: amountCents, netCents, taxCents: amountCents - netCents };
  }

  const taxCents = Math.round(amountCents * (tenantTaxConfig.vatRatePercent / 100));
  return { grossCents: amountCents + taxCents, netCents: amountCents, taxCents };
}

/** Resolves the EFFECTIVE tax config for one product: its own `pricesTaxInclusive` override when
 * set, otherwise the tenant's Business Profile default. Every checkout/invoice/quotation/purchase
 * call site must resolve through this before calling computeLineTax — a product's own setting is
 * always the source of truth over the tenant-wide default. */
export function resolveProductTaxConfig(
  product: { pricesTaxInclusive: boolean | null },
  tenantTaxConfig: TenantTaxConfig
): TenantTaxConfig {
  return {
    vatRatePercent: tenantTaxConfig.vatRatePercent,
    pricesTaxInclusive: product.pricesTaxInclusive ?? tenantTaxConfig.pricesTaxInclusive
  };
}

/** Compact per-line badge text for cart/invoice/quotation UI — lets a cashier/clerk see at a glance
 * whether THIS line's tax was added on top or was already baked into the price shown, without
 * opening the product's own edit screen. Only "vat" products have an inclusive/exclusive distinction
 * to show at all — exempted/zero-rated lines just say so instead, since "Incl./+ VAT" would be
 * misleading (there's no VAT to include or add). */
export function taxModeBadgeLabel(
  product: { taxType: ProductTaxType; pricesTaxInclusive: boolean | null },
  tenantTaxConfig: TenantTaxConfig
): { label: string; tone: "neutral" | "accent" } {
  if (product.taxType === "exempted") return { label: "Exempt", tone: "neutral" };
  if (product.taxType === "zero_rated") return { label: "Zero-Rated", tone: "neutral" };
  const inclusive = resolveProductTaxConfig(product, tenantTaxConfig).pricesTaxInclusive;
  return inclusive ? { label: "Incl. VAT", tone: "neutral" } : { label: "Excl. VAT", tone: "accent" };
}

/**
 * The tax that was actually ADDED ON TOP of the subtotal to reach the grand total — i.e. tax from
 * exclusive-priced lines only, never inclusive (whose tax is already embedded in the line's own
 * price and contributes nothing to the subtotal→total gap). This is what a "Total Tax" summary line
 * should show: the reason the total is higher than subtotal-minus-discount, not the full tax
 * liability across every line (that's what the Tax Breakdown table below the totals is for).
 *
 * Deliberately NOT read from a stored field — there isn't one, and doesn't need to be. Every line
 * already carries unitPriceCents/quantity/discountAmountCents (the pre-tax taxable amount) and
 * lineTotalCents (computeLineTax's own grossCents, frozen at creation). For an exclusive line
 * grossCents = taxable + tax, so `lineTotalCents - taxable` recovers exactly the tax that line added;
 * for an inclusive or non-vat line grossCents === taxable, so the same subtraction is exactly zero.
 * Summing that across every line, no new persisted/synced field required anywhere downstream (every
 * receipt/invoice/quotation surface — on-screen, thermal, PDF, Share, Owner App — already carries
 * these four fields on every line item it renders).
 */
export function computeAddedTaxCents(
  lines: Array<{ unitPriceCents: number; quantity: number; discountAmountCents: number; lineTotalCents: number }>
): number {
  return lines.reduce((sum, line) => {
    const taxableCents = line.unitPriceCents * line.quantity - line.discountAmountCents;
    return sum + (line.lineTotalCents - taxableCents);
  }, 0);
}

export type TaxPricingMode = "inclusive" | "exclusive";

export type TaxBreakdownEntry = {
  taxType: ProductTaxType;
  /** Which pricing mode this row's lines used — "vat" splits into a separate row per mode present
   * (see computeTaxBreakdown), so a document mixing inclusive and exclusive VAT products never
   * silently blends their totals into one misleading row. Always null for exempted/zero-rated,
   * where the rate is 0 either way and the distinction is meaningless. */
  pricingMode: TaxPricingMode | null;
  netCents: number;
  taxCents: number;
  grossCents: number;
};

/** Human label for one breakdown row — "Standard (16%)" uses the tenant's own configured rate,
 * never a hardcoded percentage, with an " — Inclusive"/" — Exclusive" suffix when pricingMode is
 * given (omit it entirely for a caller — e.g. Tax Report's own aggregation — that has no per-mode
 * split of its own). Shared by every document template (receipt/invoice/quotation, on-screen and
 * printed) so the wording never drifts between them. */
export function taxBreakdownLabel(
  taxType: ProductTaxType,
  tenantTaxConfig: TenantTaxConfig,
  pricingMode?: TaxPricingMode | null
): string {
  if (taxType === "vat") {
    const base = `Standard (${tenantTaxConfig.vatRatePercent}%)`;
    if (pricingMode === "inclusive") return `${base} — Inclusive`;
    if (pricingMode === "exclusive") return `${base} — Exclusive`;
    return base;
  }
  return TAX_TYPE_OPTIONS.find((option) => option.value === taxType)?.label ?? taxType;
}

/**
 * Groups a document's own line items (sale/quotation/purchase items — each already carries its own
 * frozen unitPriceCents/quantity/discountAmountCents/taxType/taxAmountCents/lineTotalCents from
 * creation time) into one row per (category, pricing mode) that actually has qualifying lines, in a
 * stable order (Standard-Inclusive, Standard-Exclusive, Exempted, Zero-Rated). This is what every
 * document's "tax breakdown" section (below the totals, never contributing to them) renders from —
 * see this module's own header comment for why tax is reporting-only.
 *
 * Splitting Standard into inclusive/exclusive rows — rather than one blended "Standard (16%)" row —
 * is what keeps this table legible the moment a document mixes both pricing modes: see
 * computeAddedTaxCents' own doc comment for why the two modes can't be summed together meaningfully.
 * Pricing mode is derived per line exactly the way computeAddedTaxCents does (no stored field): a
 * line's own lineTotalCents equals its taxable amount when inclusive, or exceeds it when exclusive.
 */
export function computeTaxBreakdown(
  lines: Array<{
    unitPriceCents: number;
    quantity: number;
    discountAmountCents: number;
    taxType: ProductTaxType;
    taxAmountCents: number;
    lineTotalCents: number;
  }>
): TaxBreakdownEntry[] {
  const byKey = new Map<string, { taxType: ProductTaxType; pricingMode: TaxPricingMode | null; netCents: number; taxCents: number; grossCents: number }>();
  for (const line of lines) {
    const taxableCents = line.unitPriceCents * line.quantity - line.discountAmountCents;
    const pricingMode: TaxPricingMode | null =
      line.taxType === "vat" ? (line.lineTotalCents > taxableCents ? "exclusive" : "inclusive") : null;
    const key = `${line.taxType}:${pricingMode ?? ""}`;
    const entry = byKey.get(key) ?? { taxType: line.taxType, pricingMode, netCents: 0, taxCents: 0, grossCents: 0 };
    entry.taxCents += line.taxAmountCents;
    entry.grossCents += line.lineTotalCents;
    entry.netCents += line.lineTotalCents - line.taxAmountCents;
    byKey.set(key, entry);
  }

  const order: Array<{ taxType: ProductTaxType; pricingMode: TaxPricingMode | null }> = [
    { taxType: "vat", pricingMode: "inclusive" },
    { taxType: "vat", pricingMode: "exclusive" },
    { taxType: "exempted", pricingMode: null },
    { taxType: "zero_rated", pricingMode: null }
  ];
  return order
    .map(({ taxType, pricingMode }) => byKey.get(`${taxType}:${pricingMode ?? ""}`))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
}
