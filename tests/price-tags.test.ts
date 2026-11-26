import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPriceTagsHtml, priceTagFor, priceTagLayout } from "../src/shared/lib/price-tags.ts";

test("a tag shows the price per the product's price unit", () => {
  const rice = priceTagFor(
    { name: "Rice", sellingPriceCents: 17.5, unitOfMeasure: "g", unitConfig: { priceUnit: "kg", units: [{ code: "kg", factor: 1000 }] } as never },
    "KES"
  );
  assert.deepEqual(rice, { name: "Rice", price: "KES 175.00", unit: "per kg" });
  assert.equal(priceTagFor({ name: "TV", sellingPriceCents: 5000, unitOfMeasure: null, unitConfig: null }, "KES").unit, null);
});

test("stickers get one page each; the roll takes the receipt width and cut lines", () => {
  const tags = [priceTagFor({ name: "Milk <500ml>", sellingPriceCents: 6500, unitOfMeasure: "piece", unitConfig: null }, "KES")];
  const sticker = buildPriceTagsHtml(tags, priceTagLayout("50x30", 72));
  assert.match(sticker, /@page \{ size: 50mm 30mm/);
  assert.match(sticker, /class="tag page"/);
  assert.match(sticker, /Milk &lt;500ml&gt;/);

  const rollLayout = priceTagLayout("roll", 72);
  assert.deepEqual(rollLayout, { widthMm: 72, heightMm: 30, roll: true });
  const roll = buildPriceTagsHtml(tags, rollLayout);
  assert.doesNotMatch(roll, /@page/);
  assert.match(roll, /class="tag cut"/);
});
