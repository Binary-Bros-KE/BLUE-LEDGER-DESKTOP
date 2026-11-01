import { getDatabase, runInTransaction } from "@main/database/connection";
import type { DropshipSupplierInfo } from "@shared/types/dropship";

/** Which of this tenant's products currently follow a dropship supplier's stock. LOCAL-ONLY, replaced
 * wholesale from the server (license-service.ts's heartbeat) and never synced — empty for every tenant
 * without dropshipping, and an empty table is exactly today's stock behaviour. */

export type StoredDropshipState = { version: string; suppliers: DropshipSupplierInfo[] };

/**
 * Called on every stock movement, for every tenant, so it must never be able to break one: a failing
 * migration is non-fatal in this app (see migrateDatabase), so dropship_links can genuinely be missing
 * — and a missing table must mean "not dropshipping", not "no sale can be recorded".
 */
export function findDropshipSupplierName(productId: string): string | null {
  try {
    const row = getDatabase().prepare("SELECT supplier_name FROM dropship_links WHERE product_id = ?").get(productId) as
      | { supplier_name: string }
      | undefined;
    return row?.supplier_name ?? null;
  } catch {
    return null;
  }
}

export function listDropshipLinks(): Record<string, string> {
  const rows = getDatabase().prepare("SELECT product_id, supplier_name FROM dropship_links").all() as Array<{
    product_id: string;
    supplier_name: string;
  }>;
  return Object.fromEntries(rows.map((row) => [row.product_id, row.supplier_name]));
}

export function readDropshipState(): StoredDropshipState | null {
  const row = getDatabase().prepare("SELECT dropship_state_json FROM tenant ORDER BY created_at LIMIT 1").get() as
    | { dropship_state_json: string | null }
    | undefined;
  return row?.dropship_state_json ? (JSON.parse(row.dropship_state_json) as StoredDropshipState) : null;
}

export function writeDropshipState(state: StoredDropshipState | null): void {
  getDatabase()
    .prepare("UPDATE tenant SET dropship_state_json = ? WHERE id = (SELECT id FROM tenant ORDER BY created_at LIMIT 1)")
    .run(state ? JSON.stringify(state) : null);
}

export function replaceDropshipLinks(links: Array<{ productId: string; supplierName: string }>): void {
  runInTransaction(() => {
    const db = getDatabase();
    db.prepare("DELETE FROM dropship_links").run();
    const insert = db.prepare("INSERT INTO dropship_links (product_id, supplier_name) VALUES (?, ?)");
    for (const link of links) insert.run(link.productId, link.supplierName);
  });
}
