import { z } from "zod";

/** Trimmed optional string that normalizes "" and undefined to null for storage. */
export function optionalText(max = 255) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
}
