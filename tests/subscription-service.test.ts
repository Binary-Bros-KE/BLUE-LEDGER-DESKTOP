// The real subscription service against a database built by the app's real migrations (all of them,
// 1 → 111), with only Electron-bound modules stubbed (see tests/stubs). Dates are relative to the real
// today, the same "today" the service itself uses.
import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDatabase } from "../src/main/database/connection.ts";
import { migrateDatabase } from "../src/main/database/migrate.ts";
import { setTestSession } from "../src/main/services/auth-service.ts";
import {
  countPendingSubscriptionNotices,
  createSubscription,
  deleteSubscription,
  getSubscription,
  getSubscriptionRenewalDefaults,
  listCustomerSubscriptions,
  listSubscriptionServiceSuggestions,
  listSubscriptions,
  recordSubscriptionNotice,
  renewSubscription,
  setSubscriptionStatus,
  updateSubscription
} from "../src/main/services/subscription-service.ts";
import { addDays, localTodayIso } from "../src/shared/lib/subscription-schedule.ts";

const ALL = ["view", "create", "edit", "delete", "export"];
const today = localTodayIso();

/** Inserts a row, filling every NOT NULL column without a default, so the test only names what matters. */
function insertRow(table: string, values: Record<string, string | number | null>): void {
  const db = getDatabase();
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number; dflt_value: unknown; type: string }>;
  const row: Record<string, string | number | null> = { ...values };
  for (const column of columns) {
    if (column.name in row || !column.notnull || column.dflt_value !== null) continue;
    // Unique per row, so a UNIQUE column (e.g. a location code) never collides between fixtures.
    row[column.name] = /INT|REAL/i.test(column.type) ? 0 : `${table}-${column.name}-${String(values.id ?? "")}`;
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...Object.values(row));
}

function signIn(overrides: Partial<{ branchId: string | null; permissions: Record<string, string[]> }> = {}): void {
  setTestSession({ employeeId: "emp-1", branchId: null, permissions: { subscriptions: ALL }, ...overrides });
}

function add(daysLeft: number, extra: Record<string, unknown> = {}) {
  return createSubscription({
    customerId: "cust-1",
    serviceName: "DStv Compact",
    accountNumber: "1234567890",
    startDate: addDays(today, daysLeft - 30),
    periodDays: 30,
    ...extra
  });
}

function outboxCount(entity: string): number {
  return (getDatabase().prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE entity = ?").get(entity) as { n: number }).n;
}

before(() => {
  const failures = migrateDatabase();
  assert.deepEqual(failures, [], "every migration applies cleanly to a fresh database");
  insertRow("tenant", { id: "tenant-1", business_name: "Test Shop", client_id: "client-1" });
  insertRow("locations", { id: "loc-a", tenant_id: "tenant-1", location_name: "Branch A" });
  insertRow("locations", { id: "loc-b", tenant_id: "tenant-1", location_name: "Branch B" });
  insertRow("employees", { id: "emp-1", tenant_id: "tenant-1", first_name: "Jane", last_name: "Cashier" });
  insertRow("customers", { id: "cust-1", tenant_id: "tenant-1", name: "Mary Wanjiru", phone: "0712345678", email: "mary@example.com", status: "active" });
});

beforeEach(() => {
  const db = getDatabase();
  db.exec("DELETE FROM customer_subscription_notices; DELETE FROM customer_subscriptions; DELETE FROM sync_outbox;");
  signIn();
});

test("migration 111 is recorded as applied", () => {
  const row = getDatabase().prepare("SELECT name FROM migrations WHERE version = 111").get() as { name: string } | undefined;
  assert.equal(row?.name, "customer_subscriptions");
});

test("creating works out the end date, days left, stage and customer details", () => {
  const created = add(20);
  assert.equal(created.endDate, addDays(today, 20));
  assert.equal(created.daysLeft, 20);
  assert.equal(created.stage, "active");
  assert.equal(created.pendingNotice, null);
  assert.equal(created.customerName, "Mary Wanjiru");
  assert.equal(created.customerPhone, "0712345678");
  assert.equal(created.createdByName, "Jane Cashier");
  assert.equal(outboxCount("customer_subscriptions"), 1, "queued for sync");
});

test("rejects bad input before touching the database", () => {
  assert.throws(() => add(5, { serviceName: "  " }), /service/i);
  assert.throws(() => add(5, { periodDays: 0 }), /at least 1 day/);
  assert.throws(() => createSubscription({ customerId: "nobody", serviceName: "GOtv", startDate: today, periodDays: 30 }), /Customer not found/);
  assert.throws(() => add(5, { startDate: "2026-02-30" }), /valid date/);
  assert.equal(listSubscriptions().length, 0);
});

test("the reminder walk: week → 3 days → expiry day → after expiry, each once", () => {
  const sub = add(6);
  assert.equal(sub.pendingNotice, "week");
  assert.throws(() => recordSubscriptionNotice(sub.id, { stage: "three_days", channel: "whatsapp" }), /too early/);

  const afterWeek = recordSubscriptionNotice(sub.id, { stage: "week", channel: "whatsapp", recipient: "0712345678" });
  assert.equal(afterWeek.pendingNotice, null);
  assert.equal(afterWeek.notices[0]?.sentByName, "Jane Cashier");
  assert.throws(() => recordSubscriptionNotice(sub.id, { stage: "week", channel: "email" }), /already sent by Jane Cashier/);
  assert.equal(outboxCount("customer_subscription_notices"), 1);

  // Move the period so it's now 2 days from the end: the 3-day reminder comes due.
  const nearer = updateSubscription(sub.id, { customerId: "cust-1", serviceName: "DStv Compact", startDate: addDays(today, -28), periodDays: 30 });
  assert.equal(nearer.pendingNotice, "three_days");
  assert.equal(countPendingSubscriptionNotices(), 1);
  recordSubscriptionNotice(sub.id, { stage: "three_days", channel: "other" });
  assert.equal(countPendingSubscriptionNotices(), 0);
});

test("a late start skips straight to the most urgent reminder", () => {
  const expired = add(-3);
  assert.equal(expired.stage, "expired");
  assert.equal(expired.pendingNotice, "expired");
  const done = recordSubscriptionNotice(expired.id, { stage: "expired", channel: "whatsapp" });
  assert.equal(done.pendingNotice, null);
  assert.throws(() => recordSubscriptionNotice(expired.id, { stage: "due", channel: "whatsapp" }), /already sent/);
});

test("renewing early continues from the old end date; the old period goes quiet", () => {
  const sub = add(2);
  const defaults = getSubscriptionRenewalDefaults(sub.id);
  assert.equal(defaults.startDate, sub.endDate);
  assert.equal(defaults.periodDays, 30);

  const renewed = renewSubscription(sub.id, { startDate: defaults.startDate, periodDays: 30, amountCents: 230000 });
  assert.equal(renewed.endDate, addDays(sub.endDate, 30));
  assert.equal(renewed.renewedFromId, sub.id);
  assert.equal(renewed.accountNumber, "1234567890");
  assert.equal(renewed.pendingNotice, null);
  assert.equal(getSubscription(sub.id).status, "renewed");
  assert.equal(getSubscription(sub.id).pendingNotice, null);
  assert.deepEqual(listSubscriptions().map((s) => s.id), [renewed.id], "the list shows only the current period");
  assert.equal(listCustomerSubscriptions("cust-1").length, 2, "history keeps both");
  assert.throws(() => renewSubscription(sub.id, defaults), /already been renewed/);
});

test("renewing after expiry starts today", () => {
  const sub = add(-5);
  assert.equal(getSubscriptionRenewalDefaults(sub.id).startDate, today);
});

test("deleting an unsynced renewal puts the previous period back", () => {
  const sub = add(1);
  const renewed = renewSubscription(sub.id, { startDate: sub.endDate, periodDays: 30 });
  assert.throws(() => deleteSubscription(sub.id), /delete the newer one first|already been renewed|renewed/);
  deleteSubscription(renewed.id);
  assert.equal(getSubscription(sub.id).status, "active");
  assert.equal(getSubscription(sub.id).pendingNotice, "three_days");
});

test("synced, or already reminded, can't be deleted — only cancelled", () => {
  const reminded = add(5);
  recordSubscriptionNotice(reminded.id, { stage: "week", channel: "whatsapp" });
  assert.throws(() => deleteSubscription(reminded.id), /reminder was already sent/);

  const synced = add(20);
  getDatabase().prepare("UPDATE customer_subscriptions SET sync_status = 'synced' WHERE id = ?").run(synced.id);
  assert.throws(() => deleteSubscription(synced.id), /already synced/);

  const cancelled = setSubscriptionStatus(reminded.id, "cancelled");
  assert.equal(cancelled.pendingNotice, null);
  assert.throws(() => recordSubscriptionNotice(reminded.id, { stage: "three_days", channel: "whatsapp" }), /active subscription/);
  assert.equal(setSubscriptionStatus(reminded.id, "active").status, "active");
});

test("a branch employee only sees and changes their own storefront's subscriptions", () => {
  signIn({ branchId: "loc-a" });
  const mine = add(10, { locationId: "loc-b" });
  assert.equal(mine.locationId, "loc-a", "a branch employee's subscription is always theirs");

  signIn({ branchId: null });
  const other = add(10, { locationId: "loc-b" });
  assert.equal(other.locationName, "Branch B");

  signIn({ branchId: "loc-a" });
  assert.deepEqual(listSubscriptions().map((s) => s.id), [mine.id]);
  assert.throws(() => getSubscription(other.id), /not found/);
  assert.throws(() => recordSubscriptionNotice(other.id, { stage: "week", channel: "whatsapp" }), /not found/);
});

test("permissions are enforced by the service, not just hidden buttons", () => {
  const sub = add(5);
  signIn({ permissions: { subscriptions: ["view"] } });
  assert.equal(listSubscriptions().length, 1);
  assert.throws(() => recordSubscriptionNotice(sub.id, { stage: "week", channel: "whatsapp" }), /permission/);
  assert.throws(() => add(10), /permission/);
  signIn({ permissions: {} });
  assert.throws(() => listSubscriptions(), /permission/);
});

test("service suggestions remember the latest period and price per service", () => {
  add(20, { serviceName: "GOtv Max", periodDays: 30, amountCents: 100000 });
  add(20, { serviceName: "GOtv Max", periodDays: 60, amountCents: 190000, startDate: addDays(today, -10) });
  add(20, { serviceName: "DStv Premium" });
  const suggestions = listSubscriptionServiceSuggestions();
  assert.equal(suggestions[0]?.serviceName, "GOtv Max");
  assert.equal(suggestions[0]?.timesUsed, 2);
  assert.equal(suggestions[0]?.periodDays, 60);
  assert.equal(suggestions[0]?.amountCents, 190000);
});
