/**
 * Which Checkout screen this machine shows. "classic" is the original two-column POS (banner on
 * top, product list + sale form side by side, page scrolls); "focus" is the full-bleed redesign
 * (products fill the screen, the sale is a pinned panel, payment happens in a Complete Sale modal).
 *
 * These `value` strings are PERSISTED (app_settings, see preferences-service.ts) — never rename or
 * reuse one. A future layout gets a NEW value; an unknown/missing stored value always falls back to
 * DEFAULT_CHECKOUT_LAYOUT, so an older build reading a newer value can't break Checkout either.
 */
export const CHECKOUT_LAYOUT_OPTIONS = [
  {
    value: "classic",
    label: "Classic",
    description: "The original checkout: products on the left, the full sale form on the right, page scrolls."
  },
  {
    value: "focus",
    label: "Full Screen",
    description:
      "Products fill the screen and the current sale is pinned on the right. Payment, charges and tax are done in a Complete Sale window."
  }
] as const;

export type CheckoutLayout = (typeof CHECKOUT_LAYOUT_OPTIONS)[number]["value"];

/** Client decision: existing shops keep the layout they know until someone deliberately switches. */
export const DEFAULT_CHECKOUT_LAYOUT: CheckoutLayout = "classic";

export function isCheckoutLayout(value: unknown): value is CheckoutLayout {
  return CHECKOUT_LAYOUT_OPTIONS.some((option) => option.value === value);
}
