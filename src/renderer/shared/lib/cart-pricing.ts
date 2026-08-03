import { computeLineTax, type TenantTaxConfig } from "@shared/lib/tax-calculation";
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
 * downstream. Gross line price already includes tax (see tax-calculation.ts) — lineTotalCents is
 * just the taxable amount, never taxable + tax; taxCents is purely a reporting figure. */
export function computeLinePricing(
  product: ProductListItem,
  quantity: number,
  discountAmountCents: number,
  tenantTaxConfig: TenantTaxConfig,
  priceOverrideCents?: number | null
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
  const { taxCents } = computeLineTax(taxableCents, product.taxType, tenantTaxConfig);
  return {
    unitPriceCents,
    lineSubtotalCents,
    discountAmountCents: clampedDiscountCents,
    taxCents,
    lineTotalCents: taxableCents
  };
}
