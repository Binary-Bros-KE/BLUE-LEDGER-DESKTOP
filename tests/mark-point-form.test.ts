import { test } from "node:test";
import assert from "node:assert/strict";
import { initialPriceFollowing, markPointPriceChange } from "../src/renderer/shared/lib/mark-point-form.ts";

const empty = { buying: "0.00", selling: "0.00", following: null } as const;

test("typing buying on a new product fills selling, and keeps following it", () => {
  const first = markPointPriceChange(empty, "buying", "250", 1.33);
  assert.deepEqual(first, { buying: "250", selling: "333.00", following: "selling" });
  const second = markPointPriceChange(first, "buying", "300", 1.33);
  assert.equal(second.selling, "399.00");
});

test("typing over a filled price makes it the user's: nothing overwrites it after", () => {
  const filled = markPointPriceChange(empty, "buying", "250", 1.33);
  const own = markPointPriceChange(filled, "selling", "350", 1.33);
  assert.deepEqual(own, { buying: "250", selling: "350", following: null });
  assert.equal(markPointPriceChange(own, "buying", "260", 1.33).selling, "350");
});

test("selling first fills buying (rounded down)", () => {
  assert.deepEqual(markPointPriceChange(empty, "selling", "400", 1.33), { buying: "300.00", selling: "400", following: "buying" });
});

test("off, or a cleared price, changes nothing else", () => {
  assert.deepEqual(markPointPriceChange(empty, "buying", "250", null), { buying: "250", selling: "0.00", following: null });
  const filled = markPointPriceChange(empty, "buying", "250", 1.33);
  assert.equal(markPointPriceChange(filled, "buying", "", 1.33).selling, "333.00");
});

test("an existing product priced by the mark point keeps following it", () => {
  assert.equal(initialPriceFollowing("250.00", "333.00", 1.33), "selling");
  assert.equal(initialPriceFollowing("250.00", "350.00", 1.33), null);
  assert.equal(initialPriceFollowing("250.00", "333.00", null), null);
});
