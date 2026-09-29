import { variantLabel } from "@shared/lib/variants";
import type { ProductListItem, SharedVariant } from "@shared/types/product";

// Cart-side helpers for variants (docs/VARIANTS.md), shared by Checkout, Invoices and Quotations.
// A SHARED-stock variant is a line on its own product carrying a variantKey; a SEPARATE-stock
// variant is simply its own product, so it needs nothing here beyond the picker listing it.

/** What the variant picker hands back: the product to put on the line, and (shared stock only) the
 * variant it is. */
export type VariantPick = { product: ProductListItem; variantKey: string | null; variantLabel: string | null };

export function findSharedVariant(product: ProductListItem, variantKey: string | null | undefined): SharedVariant | null {
  if (!variantKey || product.variantConfig?.mode !== "shared") return null;
  return product.variantConfig.variants.find((v) => v.key === variantKey) ?? null;
}

export function sharedVariantLabel(product: ProductListItem, variantKey: string | null | undefined): string | null {
  const variant = findSharedVariant(product, variantKey);
  return variant && product.variantConfig ? variantLabel(product.variantConfig.options, variant.values) : null;
}

/** The product as a variant line prices it — the variant's own price (when it has one) stands in for
 * the selling price, exactly as prepareCart (sale-service.ts) does, so the on-screen total matches
 * what the server charges. Wholesale still applies the same way for both. */
export function pricedForVariant<T extends ProductListItem>(product: T, variantKey: string | null | undefined): T {
  const variant = findSharedVariant(product, variantKey);
  return variant && variant.priceCents !== null ? { ...product, sellingPriceCents: variant.priceCents } : product;
}

/** Line identity in a cart that keys lines by product: the same product in two colours is two lines. */
export function cartLineId(productId: string, variantKey: string | null | undefined): string {
  return variantKey ? `${productId}::${variantKey}` : productId;
}

export function lineName(product: { name: string }, label: string | null | undefined): string {
  return label ? `${product.name} — ${label}` : product.name;
}

/** Active products of the separate-stock group this product belongs to (itself included), ordered
 * by the group's option value order — empty when it isn't in a group. */
export function separateGroupMembers(product: ProductListItem, products: ProductListItem[]): ProductListItem[] {
  const groupId = product.variantGroupId;
  if (!groupId) return [];
  const members = products.filter((p) => p.variantGroupId === groupId && p.status === "active");
  const options = products.find((p) => p.id === groupId)?.variantConfig?.options ?? product.variantConfig?.options ?? [];
  const rank = (p: ProductListItem): number[] =>
    options.map((o) => {
      const i = o.values.indexOf(p.variantOptions[o.name] ?? "");
      return i < 0 ? 999 : i;
    });
  return [...members].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return (ra[i] ?? 0) - (rb[i] ?? 0);
    return a.name.localeCompare(b.name);
  });
}

/** Tapping this product should open the picker: it has sellable shared variants, or it's in a
 * separate-stock group with at least two sellable products. */
export function needsVariantPicker(product: ProductListItem, products: ProductListItem[]): boolean {
  if (product.variantConfig?.mode === "shared") return product.variantConfig.variants.some((v) => v.active);
  return separateGroupMembers(product, products).length >= 2;
}

/** A scanned/typed code that is exactly an active SHARED variant's barcode or SKU. (A separate-stock
 * variant's code is its own product's, which the normal product lookup already finds.) */
export function findVariantByCode(products: ProductListItem[], code: string): VariantPick | null {
  const wanted = code.trim().toLowerCase();
  if (!wanted) return null;
  for (const product of products) {
    if (product.status !== "active" || product.variantConfig?.mode !== "shared") continue;
    const variant = product.variantConfig.variants.find(
      (v) => v.active && ((v.barcode ?? "").toLowerCase() === wanted || (v.sku ?? "").toLowerCase() === wanted)
    );
    if (variant) {
      return { product, variantKey: variant.key, variantLabel: variantLabel(product.variantConfig.options, variant.values) };
    }
  }
  return null;
}

/** Extra text for a product search box, so typing a variant's SKU/barcode finds its product. */
export function variantSearchText(product: ProductListItem): string {
  return product.variantConfig?.variants.map((v) => `${v.sku ?? ""} ${v.barcode ?? ""}`).join(" ") ?? "";
}
