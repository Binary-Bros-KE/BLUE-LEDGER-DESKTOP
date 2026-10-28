import { getDatabase } from "@main/database/connection";
import { requirePermission } from "@main/services/auth-service";
import { CHECKOUT_LAYOUT_STORAGE_KEY } from "@shared/constants/app";
import { DEFAULT_CHECKOUT_LAYOUT, isCheckoutLayout, type CheckoutLayout } from "@shared/types/checkout-layout";

/**
 * Device-level UI preferences, stored in the local SQLite app_settings table (same home as the
 * printer settings and theme). That table lives in userData, which app updates never touch, and
 * nothing in sync, migrations, or bootstrap writes these keys — so a choice made here survives every
 * future update untouched. The ONLY writer is saveCheckoutLayout(), i.e. someone deliberately
 * changing it in Settings. Never "migrate" or default-write this key from an every-boot path: an
 * absent row is what means "never chosen", and reads already resolve that to the default.
 */

export function getCheckoutLayout(): CheckoutLayout {
  // No permission check: every signed-in role that can open Checkout needs this to render it.
  const row = getDatabase()
    .prepare("SELECT value_json FROM app_settings WHERE key = ?")
    .get(CHECKOUT_LAYOUT_STORAGE_KEY) as { value_json: string } | undefined;
  if (!row) return DEFAULT_CHECKOUT_LAYOUT;

  try {
    const stored: unknown = JSON.parse(row.value_json);
    // An unrecognised value (e.g. written by a newer build, then the app was rolled back) falls back
    // to the default for display only — the row itself is left alone, never overwritten here.
    return isCheckoutLayout(stored) ? stored : DEFAULT_CHECKOUT_LAYOUT;
  } catch {
    return DEFAULT_CHECKOUT_LAYOUT;
  }
}

export function saveCheckoutLayout(input: unknown): CheckoutLayout {
  requirePermission("settings", "edit");
  if (!isCheckoutLayout(input)) {
    throw new Error("Unknown checkout layout");
  }

  getDatabase()
    .prepare(
      `
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `
    )
    .run(CHECKOUT_LAYOUT_STORAGE_KEY, JSON.stringify(input), new Date().toISOString());

  return input;
}
