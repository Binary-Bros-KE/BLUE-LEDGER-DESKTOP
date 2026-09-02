import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

export const borrowItemInputSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive("Quantity must be greater than 0")
});

export type BorrowItemInput = z.infer<typeof borrowItemInputSchema>;

export const borrowCreateSchema = z.object({
  direction: z.enum(["borrowed", "lent"]),
  supplierId: z.string().trim().min(1, "Select a shop"),
  locationId: z.string().trim().min(1, "Select a location"),
  notes: optionalText(1000),
  items: z.array(borrowItemInputSchema).min(1, "Add at least one product")
});

export type BorrowCreateInput = z.infer<typeof borrowCreateSchema>;

const recordBorrowReturnItemSchema = z.object({
  borrowItemId: z.string().trim().min(1),
  returnQuantity: z.coerce.number().int().positive("Enter a quantity greater than 0")
});

export const recordBorrowReturnSchema = z.object({
  items: z.array(recordBorrowReturnItemSchema).min(1, "Enter at least one quantity to return")
});

export type RecordBorrowReturnInput = z.infer<typeof recordBorrowReturnSchema>;
