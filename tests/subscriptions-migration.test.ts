// Applies migration 111 ("customer_subscriptions") from migrate.ts to an in-memory SQLite database (the same
// node:sqlite the app uses) and checks its tables, constraints and sync triggers. The tables it
// references are stubbed with just the columns the migration touches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

function migrationSql(name: string): string {
  const source = readFileSync(new URL("../src/main/database/migrate.ts", import.meta.url), "utf8");
  const match = source.match(new RegExp(`name: "${name}",\\s*sql: \`([\\s\\S]*?)\``));
  assert.ok(match, `migration ${name} not found`);
  return match[1]!;
}

function freshDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE tenant (id TEXT PRIMARY KEY, client_id TEXT);
    CREATE TABLE customers (id TEXT PRIMARY KEY);
    CREATE TABLE sync_outbox (
      id TEXT PRIMARY KEY, tenant_id TEXT, client_id TEXT, entity TEXT, entity_id TEXT, operation TEXT,
      direction TEXT, status TEXT, attempt_count INTEGER, payload_json TEXT, idempotency_key TEXT,
      created_at TEXT, updated_at TEXT
    );
    INSERT INTO tenant VALUES ('t1', 'client-1');
    INSERT INTO customers VALUES ('c1');
  `);
  db.exec(migrationSql("customer_subscriptions"));
  return db;
}

function insertSubscription(db: DatabaseSync, id: string, overrides: Record<string, unknown> = {}): void {
  const row = {
    id,
    tenant_id: "t1",
    customer_id: "c1",
    service_name: "DStv Compact",
    start_date: "2026-11-01",
    period_days: 30,
    end_date: "2026-12-01",
    created_at: "2026-11-01T08:00:00Z",
    updated_at: "2026-11-01T08:00:00Z",
    ...overrides
  };
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO customer_subscriptions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(
    ...(Object.values(row) as Array<string | number | null>)
  );
}

function outbox(db: DatabaseSync): Array<{ entity: string; entity_id: string; operation: string; client_id: string }> {
  return db.prepare("SELECT entity, entity_id, operation, client_id FROM sync_outbox ORDER BY rowid").all() as never;
}

test("creates both tables with their defaults", () => {
  const db = freshDatabase();
  insertSubscription(db, "s1");
  const row = db.prepare("SELECT status, sync_status FROM customer_subscriptions WHERE id = 's1'").get() as { status: string; sync_status: string };
  assert.deepEqual({ ...row }, { status: "active", sync_status: "pending" });
});

test("every insert, real update and delete queues a sync push", () => {
  const db = freshDatabase();
  insertSubscription(db, "s1");
  db.prepare("UPDATE customer_subscriptions SET status = 'renewed', updated_at = '2026-11-02T08:00:00Z' WHERE id = 's1'").run();
  // A write that doesn't move updated_at (e.g. marking a row synced) must not queue another push.
  db.prepare("UPDATE customer_subscriptions SET sync_status = 'synced' WHERE id = 's1'").run();
  db.prepare(
    `INSERT INTO customer_subscription_notices (id, tenant_id, subscription_id, stage, channel, sent_at, created_at, updated_at)
     VALUES ('n1', 't1', 's1', 'week', 'whatsapp', '2026-11-24T09:00:00Z', '2026-11-24T09:00:00Z', '2026-11-24T09:00:00Z')`
  ).run();
  db.prepare("DELETE FROM customer_subscription_notices WHERE id = 'n1'").run();

  assert.deepEqual(
    outbox(db).map((r) => `${r.entity}:${r.entity_id}:${r.operation}`),
    ["customer_subscriptions:s1:upsert", "customer_subscriptions:s1:upsert", "customer_subscription_notices:n1:upsert", "customer_subscription_notices:n1:delete"]
  );
  assert.ok(outbox(db).every((r) => r.client_id === "client-1"));
});

test("constraints reject bad data", () => {
  const db = freshDatabase();
  assert.throws(() => insertSubscription(db, "bad-period", { period_days: 0 }));
  assert.throws(() => insertSubscription(db, "bad-status", { status: "paused" }));
  assert.throws(() => insertSubscription(db, "bad-customer", { customer_id: "nobody" }));
  insertSubscription(db, "s1");
  const notice = (stage: string, channel: string, subscriptionId = "s1") =>
    db
      .prepare(
        `INSERT INTO customer_subscription_notices (id, tenant_id, subscription_id, stage, channel, sent_at, created_at, updated_at)
         VALUES (?, 't1', ?, ?, ?, 'x', 'x', 'x')`
      )
      .run(`${stage}-${channel}-${subscriptionId}`, subscriptionId, stage, channel);
  assert.throws(() => notice("soon", "whatsapp"));
  assert.throws(() => notice("week", "sms"));
  assert.throws(() => notice("week", "whatsapp", "missing"));
  notice("expired", "other");
});
