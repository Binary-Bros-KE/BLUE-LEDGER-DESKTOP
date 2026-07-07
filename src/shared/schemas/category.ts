import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Pick a color tag");

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, "Category name is required").max(150),
  description: optionalText(500),
  color: colorSchema,
  sortOrder: z.coerce.number().int().min(0).max(9999),
  parentId: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null))
});

export const categoryUpdateSchema = categoryCreateSchema.omit({ parentId: true });

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
