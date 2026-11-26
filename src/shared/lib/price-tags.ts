import { displayPriceCents } from "@shared/lib/product-units";
import { formatReceiptCents } from "@shared/lib/receipt";
import type { ProductUnitConfig } from "@shared/lib/product-units";

/** Shelf price tags, printed on a thermal printer. Sticker sizes print one tag per label (one PDF page
 * each, sized to the sticker); "roll" stacks the tags down a receipt roll with cut lines, at the
 * receipt printer's own Paper Width. Used by the main process to print and by the renderer to preview,
 * so both show exactly the same tag. */
export const PRICE_TAG_SIZE_OPTIONS = [
  { value: "40x30", label: "Sticker 40 x 30 mm", widthMm: 40, heightMm: 30 },
  { value: "50x30", label: "Sticker 50 x 30 mm", widthMm: 50, heightMm: 30 },
  { value: "60x40", label: "Sticker 60 x 40 mm", widthMm: 60, heightMm: 40 },
  { value: "roll", label: "Receipt roll (cut apart)", widthMm: null, heightMm: 30 }
] as const;

export type PriceTagSize = (typeof PRICE_TAG_SIZE_OPTIONS)[number]["value"];

export type PriceTag = { name: string; price: string; unit: string | null };

export type PriceTagLayout = { widthMm: number; heightMm: number; roll: boolean };

export function priceTagFor(
  product: { name: string; sellingPriceCents: number; unitOfMeasure: string | null; unitConfig: ProductUnitConfig | null },
  currency: string
): PriceTag {
  const unit = product.unitConfig?.priceUnit ?? product.unitOfMeasure;
  return {
    name: product.name,
    price: `${currency} ${formatReceiptCents(displayPriceCents(product.sellingPriceCents, product.unitConfig))}`.trim(),
    unit: unit ? `per ${unit}` : null
  };
}

/** Sticker sizes are fixed; a roll tag is as wide as the roll's printable width. */
export function priceTagLayout(size: PriceTagSize, rollWidthMm: number): PriceTagLayout {
  const option = PRICE_TAG_SIZE_OPTIONS.find((entry) => entry.value === size) ?? PRICE_TAG_SIZE_OPTIONS[0];
  return { widthMm: option.widthMm ?? rollWidthMm, heightMm: option.heightMm, roll: option.widthMm === null };
}

const PT_TO_MM = 0.3528;
// Bold Arial digits run ~0.6em wide; sizing the price from its length keeps it on one line without
// measuring text (no script runs in the print window or the preview).
const CHAR_WIDTH_EM = 0.6;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function priceFontPt(price: string, layout: PriceTagLayout): number {
  const usableMm = layout.widthMm - 4;
  const fitPt = usableMm / (price.length * CHAR_WIDTH_EM * PT_TO_MM);
  return Math.max(8, Math.min(fitPt, layout.heightMm * 0.6));
}

/** Tag CSS (scoped under .bl-tags) and markup; buildPriceTagsHtml wraps them into a printable page. */
export function buildPriceTagsMarkup(tags: PriceTag[], layout: PriceTagLayout): { css: string; body: string } {
  const scale = layout.heightMm / 30;
  const css = `
  .bl-tags { font-family: Arial, Helvetica, sans-serif; color: #000; }
  .bl-tags .tag { box-sizing: border-box; width: ${layout.widthMm}mm; height: ${layout.heightMm}mm; padding: 1.5mm 2mm;
    display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; background: #fff; }
  .bl-tags .page { break-after: page; page-break-after: always; }
  .bl-tags .page:last-child { break-after: auto; page-break-after: auto; }
  .bl-tags .cut { border-bottom: 0.3mm dashed #000; }
  .bl-tags .cut:last-child { border-bottom: none; }
  .bl-tags .name { font-size: ${(9 * scale).toFixed(1)}pt; font-weight: bold; line-height: 1.15; overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
  .bl-tags .price { font-weight: 900; line-height: 1; white-space: nowrap; }
  .bl-tags .unit { font-size: ${(7 * scale).toFixed(1)}pt; font-weight: bold; }`;
  const tagClass = layout.roll ? "tag cut" : "tag page";
  const body = `<div class="bl-tags">${tags
    .map(
      (tag) => `<div class="${tagClass}">
      <div class="name">${escapeHtml(tag.name)}</div>
      <div>
        <div class="price" style="font-size:${priceFontPt(tag.price, layout).toFixed(1)}pt">${escapeHtml(tag.price)}</div>
        ${tag.unit ? `<div class="unit">${escapeHtml(tag.unit)}</div>` : ""}
      </div>
    </div>`
    )
    .join("")}</div>`;
  return { css, body };
}

export function buildPriceTagsHtml(tags: PriceTag[], layout: PriceTagLayout): string {
  const { css, body } = buildPriceTagsMarkup(tags, layout);
  const page = layout.roll ? "" : `@page { size: ${layout.widthMm}mm ${layout.heightMm}mm; margin: 0; }`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  ${page}
  html, body { margin: 0; padding: 0; }
  ${css}
</style>
</head>
<body>${body}</body>
</html>`;
}
