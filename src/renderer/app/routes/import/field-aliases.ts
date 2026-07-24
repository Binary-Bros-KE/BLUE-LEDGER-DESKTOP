import type { ImportColumnMapping, ImportFieldDefinition } from "@shared/types/import";

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Seeds a best-guess column mapping from the file's own headers, matching each field's alias list
 * (case/punctuation-insensitively) — the user reviews/adjusts from here rather than mapping from a
 * blank slate every time. First alias match wins per field. */
export function autoMatchColumnMapping(fields: ImportFieldDefinition[], headers: string[]): ImportColumnMapping {
  const normalizedHeaders = headers.map((header) => ({ header, normalized: normalizeHeader(header) }));
  const mapping: ImportColumnMapping = {};

  for (const field of fields) {
    const normalizedAliases = field.aliases.map(normalizeHeader);
    const match = normalizedHeaders.find((entry) => normalizedAliases.includes(entry.normalized));
    mapping[field.key] = match?.header ?? null;
  }

  return mapping;
}
