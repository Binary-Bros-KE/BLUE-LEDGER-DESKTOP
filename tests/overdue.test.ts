import { test } from "node:test";
import assert from "node:assert/strict";
import { daysOverdue, overdueLabel } from "../src/shared/lib/overdue.ts";

const now = new Date(2026, 10, 20, 10, 56); // 20 Nov 2026, 10:56 local

test("counts whole calendar days since the due date", () => {
  assert.equal(daysOverdue(new Date(2026, 9, 21).toISOString(), now), 30);
  assert.equal(daysOverdue(new Date(2026, 10, 10, 23, 59).toISOString(), now), 10);
  assert.equal(daysOverdue(new Date(2026, 10, 19, 23, 59).toISOString(), now), 1, "due late yesterday is still 1 day");
});

test("never less than 1 (an invoice flagged overdue today)", () => {
  assert.equal(daysOverdue(new Date(2026, 10, 20, 8).toISOString(), now), 1);
});

test("the pill text", () => {
  assert.equal(overdueLabel(new Date(2026, 10, 19).toISOString(), now), "1 day");
  assert.equal(overdueLabel(new Date(2026, 9, 21).toISOString(), now), "30 days");
});
