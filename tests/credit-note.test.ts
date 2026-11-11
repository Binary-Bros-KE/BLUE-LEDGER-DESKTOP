import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceBalanceCents, splitCredit } from "../src/shared/lib/credit-note.ts";

test("unpaid invoice: the credit only reduces what's owed, nothing is refunded", () => {
  assert.deepEqual(splitCredit({ grandTotalCents: 10_000, amountPaidCents: 0, previouslyCreditedCents: 0, creditCents: 3_000 }), {
    balanceBeforeCents: 10_000,
    balanceAfterCents: 7_000,
    balanceReductionCents: 3_000,
    refundCents: 0
  });
});

test("fully paid invoice: the whole credit is refunded", () => {
  assert.deepEqual(splitCredit({ grandTotalCents: 10_000, amountPaidCents: 10_000, previouslyCreditedCents: 0, creditCents: 3_000 }), {
    balanceBeforeCents: 0,
    balanceAfterCents: 0,
    balanceReductionCents: 0,
    refundCents: 3_000
  });
});

test("partly paid invoice: reduce what's owed first, refund only the rest", () => {
  // Owed 6,000 of 10,000; a 7,000 credit clears the 6,000 and refunds 1,000.
  const split = splitCredit({ grandTotalCents: 10_000, amountPaidCents: 4_000, previouslyCreditedCents: 0, creditCents: 7_000 });
  assert.equal(split.balanceAfterCents, 0);
  assert.equal(split.balanceReductionCents, 6_000);
  assert.equal(split.refundCents, 1_000);
});

test("earlier credit notes count before this one", () => {
  // 10,000 invoice, 2,000 paid, 5,000 already credited: owed 3,000. A further 4,000 refunds 1,000.
  const split = splitCredit({ grandTotalCents: 10_000, amountPaidCents: 2_000, previouslyCreditedCents: 5_000, creditCents: 4_000 });
  assert.equal(split.balanceBeforeCents, 3_000);
  assert.equal(split.refundCents, 1_000);
  assert.equal(split.balanceAfterCents, 0);
});

test("reduction plus refund always equals the credit", () => {
  for (const paid of [0, 1, 2_500, 9_999, 10_000]) {
    for (const credit of [1, 2_500, 10_000]) {
      const split = splitCredit({ grandTotalCents: 10_000, amountPaidCents: paid, previouslyCreditedCents: 0, creditCents: credit });
      assert.equal(split.balanceReductionCents + split.refundCents, credit);
      assert.ok(split.refundCents >= 0 && split.balanceAfterCents >= 0);
    }
  }
});

test("balance never goes negative", () => {
  assert.equal(invoiceBalanceCents(10_000, 10_000, 3_000), 0);
  assert.equal(invoiceBalanceCents(10_000, 2_000, 3_000), 5_000);
});
