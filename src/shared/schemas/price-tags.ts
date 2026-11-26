import { z } from "zod";
import { PRICE_TAG_SIZE_OPTIONS, type PriceTagSize } from "@shared/lib/price-tags";

const sizeValues = PRICE_TAG_SIZE_OPTIONS.map((option) => option.value) as [PriceTagSize, ...PriceTagSize[]];

export const priceTagPrintSchema = z.object({
  size: z.enum(sizeValues),
  /** Empty = the receipt printer from Settings. */
  printerName: z.string().trim().max(200).default(""),
  items: z
    .array(z.object({ productId: z.string().min(1), copies: z.coerce.number().int().min(1).max(500) }))
    .min(1, "Pick at least one product")
    .max(5000)
});
