/** What a dropshipping tenant's device knows about its supplier-linked products. Empty for every
 * other tenant. See SERVER's lib/dropship-links.ts. */
export type DropshipSupplierInfo = {
  name: string;
  /** When this supplier's devices last reached the server — how fresh its stock figure is. */
  asOf: string | null;
};

export type DropshipState = {
  /** productId -> supplier name */
  links: Record<string, string>;
  suppliers: DropshipSupplierInfo[];
};
