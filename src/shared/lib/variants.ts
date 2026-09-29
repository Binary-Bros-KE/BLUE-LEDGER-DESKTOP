import type { VariantOption } from "@shared/types/product";

/** A variant's option values as one human label, in the product's option order: "XL / Red". Used on
 * the variants editor, checkout picker, receipts and documents, so every surface reads the same. */
export function variantLabel(options: VariantOption[], values: Record<string, string>): string {
  const ordered = options.map((o) => values[o.name]).filter((v): v is string => Boolean(v));
  // values for an option that was since removed still show, after the known ones
  const extra = Object.entries(values)
    .filter(([name]) => !options.some((o) => o.name === name))
    .map(([, v]) => v);
  return [...ordered, ...extra].join(" / ");
}

/** Same set of option values (order-insensitive), e.g. to match a regenerated combination back to
 * the variant row it already was. */
export function sameVariantValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => b[k] === a[k]);
}

/** Every combination of the options' values (cartesian product), in option order. */
export function variantCombinations(options: VariantOption[]): Record<string, string>[] {
  return options.reduce<Record<string, string>[]>(
    (acc, option) => acc.flatMap((combo) => option.values.map((value) => ({ ...combo, [option.name]: value }))),
    [{}]
  ).filter((combo) => Object.keys(combo).length > 0);
}
