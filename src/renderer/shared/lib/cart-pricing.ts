import { computeLineTax, resolveProductTaxConfig, type TenantTaxConfig } from "@shared/lib/tax-calculation";
import type { ProductListItem } from "@shared/types/product";

export type LinePricing = {
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountAmountCents: number;
  taxCents: number;
  lineTotalCents: number;
};

/** Prices a single cart/invoice line, applying the product's wholesale price break when the
 * quantity qualifies. Mirrors the server-side pricing in sale-service.ts's prepareCart —
 * including `priceOverrideCents`, a cashier-entered markup/override for this line only, which
 * (like on the server) replaces the derived price outright rather than needing special-casing
 * downstream, and resolveProductTaxConfig, which resolves THIS product's own inclusive/exclusive
 * override (falling back to the tenant default). lineTotalCents is computeLineTax's grossCents —
 * the amount actually charged for this line, which equals the taxable amount when inclusive but
 * adds tax on top when exclusive (see tax-calculation.ts); taxCents is purely a reporting figure
 * either way. */
/** Used by Checkout/Invoices/Quotations to warn inline the moment a cashier-typed price override
 * dips below the product's own floor — server-side prepareCart rejects this outright at submit
 * time (sale-service.ts), but catching it here means the user sees why immediately instead of
 * only after the whole form fails to submit. */
export function isPriceBelowMinimum(priceCents: number, minimumPriceCents: number | null): boolean {
  return minimumPriceCents !== null && priceCents < minimumPriceCents;
}

export function computeLinePricing(
  product: ProductListItem,
  quantity: number,
  discountAmountCents: number,
  tenantTaxConfig: TenantTaxConfig,
  priceOverrideCents?: number | null,
  /** Client request: lets a specific cart line be switched between VAT-inclusive and VAT-exclusive
   * pricing for this document only — null (the default) means "use this product's own effective
   * setting" exactly as before; see prepareCart's own taxInclusiveOverride doc comment in
   * sale-service.ts (the server-side twin of this same override, applied identically). */
  taxInclusiveOverride?: boolean | null
): LinePricing {
  const useWholesale =
    product.wholesalePriceCents !== null &&
    product.wholesaleMinQuantity > 0 &&
    quantity >= product.wholesaleMinQuantity;
  const unitPriceCents =
    priceOverrideCents ?? (useWholesale ? (product.wholesalePriceCents as number) : product.sellingPriceCents);
  const lineSubtotalCents = unitPriceCents * quantity;
  // A discount can never push the line below the product's own minimum price (if one is set) —
  // the floor a discount is allowed to reach, in total across this line's quantity.
  const floorCents = product.minimumPriceCents !== null ? product.minimumPriceCents * quantity : 0;
  const maxDiscountCents = Math.max(0, lineSubtotalCents - floorCents);
  const clampedDiscountCents = Math.max(0, Math.min(discountAmountCents, lineSubtotalCents, maxDiscountCents));
  const taxableCents = lineSubtotalCents - clampedDiscountCents;
  const productTaxConfig = resolveProductTaxConfig(product, tenantTaxConfig);
  const effectiveTaxConfig =
    taxInclusiveOverride === undefined || taxInclusiveOverride === null
      ? productTaxConfig
      : { ...productTaxConfig, pricesTaxInclusive: taxInclusiveOverride };
  const { grossCents, taxCents } = computeLineTax(taxableCents, product.taxType, effectiveTaxConfig);
  return {
    unitPriceCents,
    lineSubtotalCents,
    discountAmountCents: clampedDiscountCents,
    taxCents,
    lineTotalCents: grossCents
  };
}
