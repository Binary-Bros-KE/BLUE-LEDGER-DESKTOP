import type { ProductTaxType } from "@shared/types/product";

/** One category's totals for the selected period — net/tax/gross across every qualifying sale
 * line, same category order every document's own tax breakdown uses (Standard, Exempted,
 * Zero-Rated). Only categories with at least one qualifying line appear. */
export type TaxCategoryTotal = {
  taxType: ProductTaxType;
  netCents: number;
  taxCents: number;
  grossCents: number;
  lineCount: number;
};

export type TaxTopProductRow = {
  productId: string;
  productName: string;
  sku: string;
  taxType: ProductTaxType;
  quantitySold: number;
  netCents: number;
  taxCents: number;
  grossCents: number;
};

export type TaxReport = {
  vatRatePercent: number;
  byCategory: TaxCategoryTotal[];
  totalNetCents: number;
  totalTaxCents: number;
  totalGrossCents: number;
  /** Top 10 products by tax collected — only "vat" (standard-rated) products can ever appear here,
   * since exempted/zero-rated always collect 0. */
  topTaxedProducts: TaxTopProductRow[];
  /** Top 10 exempted products by revenue (gross == net for this category, since exempted collects
   * no tax at all). */
  topExemptedProducts: TaxTopProductRow[];
  /** Top 10 zero-rated products by revenue — same reasoning as topExemptedProducts. */
  topZeroRatedProducts: TaxTopProductRow[];
};
