import { test } from "node:test";
import assert from "node:assert/strict";
import { activeMarkPoint, buyingFromSelling, planMarkPoint, sellingFromBuying, strictMarkPoint } from "../src/shared/lib/mark-point.ts";

test("selling rounds up to the whole shilling, buying rounds down", () => {
  assert.equal(sellingFromBuying(25_000, 1.33), 33_300); // 332.50 -> 333
  assert.equal(sellingFromBuying(30_000, 1.33), 39_900); // 399.00000000000006 stays 399
  assert.equal(sellingFromBuying(10_000, 1.5), 15_000);
  assert.equal(buyingFromSelling(40_000, 1.33), 30_000); // 300.75 -> 300
  assert.equal(buyingFromSelling(39_900, 1.33), 30_000);
});

test("a product priced per kg (stocked in grams) rounds per kg", () => {
  // KES 175/kg buying = 17.5 cents per gram; x 1.33 = 232.75/kg -> 233/kg = 23.3 cents per gram.
  assert.equal(sellingFromBuying(17.5, 1.33, 1000), 23.3);
  assert.equal(buyingFromSelling(23.3, 1.33, 1000), 17.5);
});

test("off, unset or 1 and below means no mark point", () => {
  assert.equal(activeMarkPoint({ markPointEnabled: false, markPoint: 1.33, markPointStrict: true }), null);
  assert.equal(activeMarkPoint({ markPointEnabled: true, markPoint: null, markPointStrict: false }), null);
  assert.equal(activeMarkPoint({ markPointEnabled: true, markPoint: 1, markPointStrict: false }), null);
  assert.equal(activeMarkPoint({ markPointEnabled: true, markPoint: 1.33, markPointStrict: false }), 1.33);
  assert.equal(strictMarkPoint({ markPointEnabled: true, markPoint: 1.33, markPointStrict: false }), null);
  assert.equal(strictMarkPoint({ markPointEnabled: true, markPoint: 1.33, markPointStrict: true }), 1.33);
});

test("apply fills whichever price is missing", () => {
  assert.deepEqual(planMarkPoint({ buyingPriceCents: 25_000, sellingPriceCents: 0 }, 1.33, "skip"), {
    action: "update",
    buyingPriceCents: 25_000,
    sellingPriceCents: 33_300,
    changed: "selling"
  });
  assert.deepEqual(planMarkPoint({ buyingPriceCents: 0, sellingPriceCents: 40_000 }, 1.33, "skip"), {
    action: "update",
    buyingPriceCents: 30_000,
    sellingPriceCents: 40_000,
    changed: "buying"
  });
  assert.deepEqual(planMarkPoint({ buyingPriceCents: 0, sellingPriceCents: 0 }, 1.33, "selling_from_buying"), { action: "skip", reason: "no_prices" });
});

test("with both prices the chosen mode decides", () => {
  const product = { buyingPriceCents: 25_000, sellingPriceCents: 30_000 };
  assert.deepEqual(planMarkPoint(product, 1.33, "skip"), { action: "skip", reason: "has_both" });
  assert.equal((planMarkPoint(product, 1.33, "selling_from_buying") as { sellingPriceCents: number }).sellingPriceCents, 33_300);
  assert.equal((planMarkPoint(product, 1.33, "buying_from_selling") as { buyingPriceCents: number }).buyingPriceCents, 22_500);
  assert.deepEqual(planMarkPoint({ buyingPriceCents: 25_000, sellingPriceCents: 33_300 }, 1.33, "selling_from_buying"), { action: "skip", reason: "unchanged" });
});
