import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { STOCK_MOVEMENT_TYPE_OPTIONS, type StockMovementType } from "@shared/types/stock-movement";

const stockMovementTypeValues = STOCK_MOVEMENT_TYPE_OPTIONS.map((option) => option.value) as [
  StockMovementType,
  ...StockMovementType[]
];

export const stockMovementInputSchema = z.object({
  productId: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  movementType: z.enum(stockMovementTypeValues),
  quantityChange: z.coerce
    .number()
    .int()
    .refine((value) => value !== 0, "Quantity change can't be zero"),
  referenceType: optionalText(64),
  referenceId: optionalText(64),
  performedBy: optionalText(120),
  notes: optionalText(500)
});

export type StockMovementInput = z.infer<typeof stockMovementInputSchema>;

export const stockTransferInputSchema = z
  .object({
    productId: z.string().trim().min(1),
    fromLocationId: z.string().trim().min(1),
    toLocationId: z.string().trim().min(1),
    quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
    notes: optionalText(500)
  })
  .refine((data) => data.fromLocationId !== data.toLocationId, {
    message: "Choose two different locations",
    path: ["toLocationId"]
  });

export type StockTransferInput = z.infer<typeof stockTransferInputSchema>;

/** Several products, one From/To pair, in a single action — e.g. a storefront closing down and
 * everything on its shelf moving to another branch at once, instead of repeating the single-product
 * transfer one product at a time. */
export const bulkStockTransferInputSchema = z
  .object({
    fromLocationId: z.string().trim().min(1),
    toLocationId: z.string().trim().min(1),
    notes: optionalText(500),
    items: z
      .array(
        z.object({
          productId: z.string().trim().min(1),
          quantity: z.coerce.number().int().positive("Quantity must be greater than 0")
        })
      )
      .min(1, "Add at least one product")
  })
  .refine((data) => data.fromLocationId !== data.toLocationId, {
    message: "Choose two different locations",
    path: ["toLocationId"]
  });

export type BulkStockTransferInput = z.infer<typeof bulkStockTransferInputSchema>;
