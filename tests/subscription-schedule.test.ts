// Run: npm test (node's own test runner; Node strips the types itself, no extra dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  daysRemaining,
  defaultRenewalStart,
  endDateFor,
  fillNoticeTemplate,
  isValidDate,
  localTodayIso,
  pendingNotice,
  stageFor
} from "../src/shared/lib/subscription-schedule.ts";

test("end date is start + period, across month, year and leap-day boundaries", () => {
  assert.equal(endDateFor("2026-11-01", 30), "2026-12-01");
  assert.equal(endDateFor("2026-12-15", 30), "2027-01-14");
  assert.equal(endDateFor("2028-02-01", 30), "2028-03-02"); // 2028 is a leap year
  assert.equal(endDateFor("2027-02-01", 30), "2027-03-03");
  assert.equal(endDateFor("2026-01-31", 1), "2026-02-01");
  assert.equal(endDateFor("2026-11-11", 365), "2027-11-11");
});

test("days between is whole days, signed", () => {
  assert.equal(daysBetween("2026-11-01", "2026-12-01"), 30);
  assert.equal(daysBetween("2026-12-01", "2026-11-01"), -30);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2); // a DST weekend elsewhere changes nothing
  assert.equal(addDays("2026-11-30", -30), "2026-10-31");
});

test("rejects impossible dates instead of rolling them over", () => {
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(isValidDate("2026-13-01"), false);
  assert.equal(isValidDate("11/11/2026"), false);
  assert.equal(isValidDate("2028-02-29"), true);
  assert.throws(() => endDateFor("2026-02-30", 30));
});

test("today is the local calendar date, not UTC", () => {
  // 01:30 local on 12 Nov is still 11 Nov in UTC for any zone ahead of Greenwich (e.g. Nairobi).
  assert.equal(localTodayIso(new Date(2026, 10, 12, 1, 30)), "2026-11-12");
  assert.equal(localTodayIso(new Date(2026, 10, 11, 23, 59)), "2026-11-11");
});

test("days remaining counts down to 0 on the end date, then negative", () => {
  assert.equal(daysRemaining("2026-12-01", "2026-11-01"), 30);
  assert.equal(daysRemaining("2026-12-01", "2026-12-01"), 0);
  assert.equal(daysRemaining("2026-12-01", "2026-12-02"), -1);
});

test("stage boundaries", () => {
  const cases: Array<[number, string]> = [
    [30, "active"],
    [8, "active"],
    [7, "week"],
    [4, "week"],
    [3, "three_days"],
    [1, "three_days"],
    [0, "due"],
    [-1, "expired"],
    [-40, "expired"]
  ];
  for (const [days, stage] of cases) assert.equal(stageFor(days), stage, `${days} days left`);
});

test("offers only the most urgent unsent reminder", () => {
  assert.equal(pendingNotice("active", 10, []), null);
  assert.equal(pendingNotice("active", 7, []), "week");
  assert.equal(pendingNotice("active", 6, ["week"]), null);
  assert.equal(pendingNotice("active", 3, ["week"]), "three_days");
  // Added with 2 days left: straight to the 3-day reminder, the week one is never asked for.
  assert.equal(pendingNotice("active", 2, []), "three_days");
  assert.equal(pendingNotice("active", 0, ["week", "three_days"]), "due");
  assert.equal(pendingNotice("active", 0, []), "due");
  assert.equal(pendingNotice("active", -1, ["due"]), "expired");
  assert.equal(pendingNotice("active", -9, ["expired"]), null);
  // A later reminder already sent covers every earlier one (e.g. sent on another PC).
  assert.equal(pendingNotice("active", 2, ["due"]), null);
});

test("renewed or cancelled periods never ask for reminders", () => {
  assert.equal(pendingNotice("renewed", 0, []), null);
  assert.equal(pendingNotice("cancelled", -2, []), null);
});

test("renewal starts from the old end date if early, today if late", () => {
  assert.equal(defaultRenewalStart("2026-12-01", "2026-11-28"), "2026-12-01");
  assert.equal(defaultRenewalStart("2026-12-01", "2026-12-01"), "2026-12-01");
  assert.equal(defaultRenewalStart("2026-12-01", "2026-12-05"), "2026-12-05");
});

test("templates fill known placeholders and leave typos visible", () => {
  assert.equal(
    fillNoticeTemplate("Hi {customer}, {service} ends {end_date} ({days} days). {oops}", {
      customer: "Jane",
      service: "DStv Compact",
      end_date: "1 Dec 2026",
      days: "3"
    }),
    "Hi Jane, DStv Compact ends 1 Dec 2026 (3 days). {oops}"
  );
});
