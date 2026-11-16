import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBalanceReminder } from "../src/shared/lib/balance-reminder.ts";

const now = new Date("2026-11-26T10:00:00");
const due = "2026-12-01T00:00:00";
const base = { nextDueDate: due, walletBalanceCents: 50_000, pricePerPeriodCents: 150_000, licenseStatus: "active" as const };

test("a short balance is mentioned within a week of the due date", () => {
  assert.deepEqual(computeBalanceReminder(base, now), {
    dueDate: due,
    daysUntilDue: 5,
    balanceCents: 50_000,
    priceCents: 150_000,
    shortByCents: 100_000
  });
});

test("nothing when the balance covers it, or more than a week out", () => {
  assert.equal(computeBalanceReminder({ ...base, walletBalanceCents: 150_000 }, now), null);
  assert.equal(computeBalanceReminder(base, new Date("2026-11-20T10:00:00")), null);
});

test("a business that never topped up keeps its old warnings only", () => {
  assert.equal(computeBalanceReminder({ ...base, walletBalanceCents: 0 }, now), null);
  assert.equal(computeBalanceReminder({ ...base, walletBalanceCents: null }, now), null);
});

test("nothing during a trial, once overdue, or without a recurring price", () => {
  assert.equal(computeBalanceReminder({ ...base, licenseStatus: "trial" }, now), null);
  assert.equal(computeBalanceReminder(base, new Date("2026-12-02T10:00:00")), null);
  assert.equal(computeBalanceReminder({ ...base, pricePerPeriodCents: null }, now), null);
});
