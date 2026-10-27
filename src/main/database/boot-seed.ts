import { getDatabase } from "@main/database/connection";

/**
 * The version date given to every boot-seeded default (default roles, the SYSTEM employee, default
 * payment methods/expense categories, the Main Store) — the oldest possible, so it always loses to
 * the cloud's copy of the same row.
 *
 * Why: a tenant can now be fully set up in the cloud before any desktop exists (SERVER's
 * tenant-defaults-service.ts — mobile-only businesses), and the owner may already have changed it
 * from the phone (a new PIN, an assigned storefront). This install seeds its own copies at first
 * launch, before activation; sync links them to the cloud rows by name/code (sync-engine.ts
 * naturalKey). Dated "now", the local seed looked newer than the cloud row, so the first pull kept
 * it and the first push overwrote the cloud — silently resetting the owner's PIN. Dated as the
 * oldest possible, the pull replaces it with the cloud's version instead (and SERVER refuses an
 * older copy too). On a tenant with nothing in the cloud yet, these simply sync up as before.
 */
export const BOOT_SEED_UPDATED_AT = "1970-01-01T00:00:00.000Z";

type SeededTable = "roles" | "employees" | "locations" | "payment_methods" | "expense_categories";

/** Dates every row of `table` for this tenant as a boot seed — only call right after seeding a
 * table that was empty, so every row in it is a seed. */
export function dateTableAsBootSeed(table: SeededTable, tenantId: string): void {
  getDatabase().prepare(`UPDATE ${table} SET updated_at = ? WHERE tenant_id = ?`).run(BOOT_SEED_UPDATED_AT, tenantId);
}

/** Dates one seeded row as a boot seed. */
export function dateRowAsBootSeed(table: SeededTable, id: string): void {
  getDatabase().prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(BOOT_SEED_UPDATED_AT, id);
}
