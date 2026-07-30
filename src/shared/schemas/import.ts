import { z } from "zod";

export const importEntityTypeSchema = z.enum(["products", "customers", "suppliers"]);

export const importColumnMappingSchema = z.record(z.string(), z.string().nullable());

export const importFieldDefaultsSchema = z.record(z.string(), z.string());

export const importRowSchema = z.record(z.string(), z.string());

export const importPreviewRequestSchema = z.object({
  entityType: importEntityTypeSchema,
  rows: z.array(importRowSchema),
  columnMapping: importColumnMappingSchema,
  fieldDefaults: importFieldDefaultsSchema.default({}),
  moneyInCents: z.boolean()
});

/** Identical shape to the preview request — commit re-resolves against the live DB on the same
 * code path as preview, so it never trusts a client-supplied "this row is valid" flag. */
export const importCommitRequestSchema = importPreviewRequestSchema;

export type ImportPreviewRequestInput = z.infer<typeof importPreviewRequestSchema>;
