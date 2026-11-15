import { runInTransaction } from "@main/database/connection";
import * as productRepository from "@main/database/repositories/product-repository";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { activeMarkPoint, planMarkPoint, strictMarkPoint, type MarkPointSettings } from "@shared/lib/mark-point";
import { parseUnitConfig, unitFactor } from "@shared/lib/product-units";
import { markPointApplySchema } from "@shared/schemas/product";
import type { MarkPointPreview } from "@shared/types/product";

/** This business's Mark Point settings (Business Profile). */
export function getMarkPointSettings(): MarkPointSettings {
  const row = tenantRepository.findTenantRow();
  return {
    markPointEnabled: Boolean(row?.mark_point_enabled),
    markPoint: row?.mark_point ?? null,
    markPointStrict: Boolean(row?.mark_point_strict)
  };
}

/** The mark point to price a purchase line with when strict mode is on, else null. */
export function getStrictMarkPoint(): number | null {
  return strictMarkPoint(getMarkPointSettings());
}

/** Base units per price unit (1000 for a product priced per kg, stocked in grams). */
export function priceFactorOf(unitConfigJson: string | null): number {
  if (!unitConfigJson) return 1;
  let raw: unknown = null;
  try {
    raw = JSON.parse(unitConfigJson);
  } catch {
    return 1;
  }
  const config = parseUnitConfig(raw);
  return unitFactor(config, config?.priceUnit);
}

function plan(input: unknown) {
  requirePermission("products", "edit");
  const markPoint = activeMarkPoint(getMarkPointSettings());
  if (markPoint === null) throw new Error("Turn on Mark Point in Business Profile first");
  const parsed = markPointApplySchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const wanted = parsed.scope === "selected" ? new Set(parsed.productIds) : null;
  const rows = productRepository
    .findAllProductRows(tenantId, null)
    .filter((row) => (wanted ? wanted.has(row.id) : parsed.scope === "category" ? row.category_id === parsed.categoryId : true));

  const changes: Array<{ row: (typeof rows)[number]; buyingPriceCents: number; sellingPriceCents: number; changed: "selling" | "buying" }> = [];
  const skipped = { noPrices: 0, hasBoth: 0, unchanged: 0 };
  for (const row of rows) {
    const result = planMarkPoint(
      { buyingPriceCents: row.buying_price_cents, sellingPriceCents: row.selling_price_cents, priceFactor: priceFactorOf(row.unit_config_json) },
      markPoint,
      parsed.bothPrices
    );
    if (result.action === "update") changes.push({ row, ...result });
    else if (result.reason === "no_prices") skipped.noPrices += 1;
    else if (result.reason === "has_both") skipped.hasBoth += 1;
    else skipped.unchanged += 1;
  }

  const preview: MarkPointPreview = {
    markPoint,
    considered: rows.length,
    toUpdate: changes.length,
    sellingFilled: changes.filter((change) => change.changed === "selling").length,
    buyingFilled: changes.filter((change) => change.changed === "buying").length,
    skipped,
    sample: changes.slice(0, 8).map((change) => ({
      productId: change.row.id,
      name: change.row.name,
      priceFactor: priceFactorOf(change.row.unit_config_json),
      before: { buyingPriceCents: change.row.buying_price_cents, sellingPriceCents: change.row.selling_price_cents },
      after: { buyingPriceCents: change.buyingPriceCents, sellingPriceCents: change.sellingPriceCents }
    }))
  };
  return { preview, changes };
}

/** What Apply Mark Point would change — nothing is written. */
export function previewMarkPoint(input: unknown): MarkPointPreview {
  return plan(input).preview;
}

/** Applies it: each changed product gets its new prices (its minimum price is lowered to the new
 * selling price if it was above it, so it can still be sold) and queues for sync like any edit. */
export function applyMarkPoint(input: unknown): MarkPointPreview {
  const { preview, changes } = plan(input);
  runInTransaction(() => {
    for (const change of changes) {
      const minimum = change.row.minimum_price_cents;
      productRepository.updateMarkPointPricesRow(change.row.id, {
        buyingPriceCents: change.buyingPriceCents,
        sellingPriceCents: change.sellingPriceCents,
        minimumPriceCents: minimum !== null && minimum > change.sellingPriceCents ? change.sellingPriceCents : minimum
      });
    }
  });
  return preview;
}
