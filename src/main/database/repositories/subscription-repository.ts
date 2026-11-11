import { randomUUID } from "node:crypto";
import { getDatabase } from "@main/database/connection";

export type SubscriptionRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  location_id: string | null;
  location_name: string | null;
  service_name: string;
  account_number: string | null;
  start_date: string;
  period_days: number;
  end_date: string;
  amount_cents: number | null;
  status: "active" | "renewed" | "cancelled";
  renewed_from_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  synced_updated_at: string | null;
};

export type SubscriptionNoticeRow = {
  id: string;
  tenant_id: string;
  subscription_id: string;
  stage: "week" | "three_days" | "due" | "expired";
  channel: "whatsapp" | "email" | "other";
  recipient: string | null;
  sent_by: string | null;
  sent_by_name: string | null;
  sent_at: string;
  created_at: string;
  updated_at: string;
};

const SELECT_WITH_JOINS = `
  SELECT s.*,
    c.name AS customer_name,
    c.phone AS customer_phone,
    c.email AS customer_email,
    l.location_name AS location_name,
    CASE WHEN s.created_by IS NOT NULL THEN (e.first_name || ' ' || e.last_name) ELSE NULL END AS created_by_name
  FROM customer_subscriptions s
  LEFT JOIN customers c ON c.id = s.customer_id
  LEFT JOIN locations l ON l.id = s.location_id
  LEFT JOIN employees e ON e.id = s.created_by
`;

/** Current periods (active and cancelled; a renewed one is history, reached through its customer).
 * locationId narrows to one storefront (a branch-scoped employee); null sees every storefront. */
export function findCurrentSubscriptionRows(tenantId: string, locationId: string | null): SubscriptionRow[] {
  return getDatabase()
    .prepare(
      `${SELECT_WITH_JOINS}
       WHERE s.tenant_id = ? AND s.status != 'renewed' AND (? IS NULL OR s.location_id = ?)
       ORDER BY s.end_date ASC`
    )
    .all(tenantId, locationId, locationId) as SubscriptionRow[];
}

export function findSubscriptionRowsForCustomer(customerId: string, locationId: string | null): SubscriptionRow[] {
  return getDatabase()
    .prepare(`${SELECT_WITH_JOINS} WHERE s.customer_id = ? AND (? IS NULL OR s.location_id = ?) ORDER BY s.start_date DESC, s.created_at DESC`)
    .all(customerId, locationId, locationId) as SubscriptionRow[];
}

export function findSubscriptionRowById(id: string): SubscriptionRow | undefined {
  return getDatabase().prepare(`${SELECT_WITH_JOINS} WHERE s.id = ?`).get(id) as SubscriptionRow | undefined;
}

export function findRenewalOf(id: string): { id: string } | undefined {
  return getDatabase().prepare("SELECT id FROM customer_subscriptions WHERE renewed_from_id = ? LIMIT 1").get(id) as { id: string } | undefined;
}

export function insertSubscriptionRow(input: {
  tenantId: string;
  customerId: string;
  locationId: string | null;
  serviceName: string;
  accountNumber: string | null;
  startDate: string;
  periodDays: number;
  endDate: string;
  amountCents: number | null;
  renewedFromId: string | null;
  notes: string | null;
  createdBy: string | null;
}): string {
  const id = `sub_${randomUUID()}`;
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `
      INSERT INTO customer_subscriptions (
        id, tenant_id, customer_id, location_id, service_name, account_number, start_date, period_days,
        end_date, amount_cents, status, renewed_from_id, notes, created_by, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      id,
      input.tenantId,
      input.customerId,
      input.locationId,
      input.serviceName,
      input.accountNumber,
      input.startDate,
      input.periodDays,
      input.endDate,
      input.amountCents,
      input.renewedFromId,
      input.notes,
      input.createdBy,
      now,
      now
    );
  return id;
}

export function updateSubscriptionRow(
  id: string,
  input: {
    customerId: string;
    locationId: string | null;
    serviceName: string;
    accountNumber: string | null;
    startDate: string;
    periodDays: number;
    endDate: string;
    amountCents: number | null;
    notes: string | null;
  }
): void {
  getDatabase()
    .prepare(
      `
      UPDATE customer_subscriptions
      SET customer_id = ?, location_id = ?, service_name = ?, account_number = ?, start_date = ?, period_days = ?,
        end_date = ?, amount_cents = ?, notes = ?, updated_at = ?, sync_status = 'pending'
      WHERE id = ?
    `
    )
    .run(
      input.customerId,
      input.locationId,
      input.serviceName,
      input.accountNumber,
      input.startDate,
      input.periodDays,
      input.endDate,
      input.amountCents,
      input.notes,
      new Date().toISOString(),
      id
    );
}

export function updateSubscriptionStatusRow(id: string, status: "active" | "renewed" | "cancelled"): void {
  getDatabase()
    .prepare("UPDATE customer_subscriptions SET status = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?")
    .run(status, new Date().toISOString(), id);
}

export function deleteSubscriptionRow(id: string): void {
  getDatabase().prepare("DELETE FROM customer_subscriptions WHERE id = ?").run(id);
}

/** Every reminder for this tenant's customer_subscriptions: one read for the whole list instead of one per row.
 * Small by nature (at most four per period). */
export function findAllNoticeRows(tenantId: string): SubscriptionNoticeRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT n.*, CASE WHEN n.sent_by IS NOT NULL THEN (e.first_name || ' ' || e.last_name) ELSE NULL END AS sent_by_name
      FROM customer_subscription_notices n
      LEFT JOIN employees e ON e.id = n.sent_by
      WHERE n.tenant_id = ?
      ORDER BY n.sent_at ASC
    `
    )
    .all(tenantId) as SubscriptionNoticeRow[];
}

export function findNoticeRowsForSubscription(subscriptionId: string): SubscriptionNoticeRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT n.*, CASE WHEN n.sent_by IS NOT NULL THEN (e.first_name || ' ' || e.last_name) ELSE NULL END AS sent_by_name
      FROM customer_subscription_notices n
      LEFT JOIN employees e ON e.id = n.sent_by
      WHERE n.subscription_id = ?
      ORDER BY n.sent_at ASC
    `
    )
    .all(subscriptionId) as SubscriptionNoticeRow[];
}

export function findNoticeRowById(id: string): SubscriptionNoticeRow | undefined {
  return getDatabase().prepare("SELECT n.*, NULL AS sent_by_name FROM customer_subscription_notices n WHERE n.id = ?").get(id) as
    | SubscriptionNoticeRow
    | undefined;
}

export function insertNoticeRow(input: {
  tenantId: string;
  subscriptionId: string;
  stage: string;
  channel: string;
  recipient: string | null;
  sentBy: string | null;
}): string {
  const id = `subn_${randomUUID()}`;
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `
      INSERT INTO customer_subscription_notices (id, tenant_id, subscription_id, stage, channel, recipient, sent_by, sent_at, created_at, updated_at, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(id, input.tenantId, input.subscriptionId, input.stage, input.channel, input.recipient, input.sentBy, now, now, now);
  return id;
}

/** Service names used before, most used first, each with its most recent period and price. */
export function findServiceSuggestionRows(
  tenantId: string
): Array<{ service_name: string; period_days: number; amount_cents: number | null; times_used: number }> {
  return getDatabase()
    .prepare(
      `
      SELECT s.service_name, s.period_days, s.amount_cents, counts.times_used
      FROM customer_subscriptions s
      JOIN (
        SELECT service_name, COUNT(*) AS times_used, MAX(created_at) AS latest
        FROM customer_subscriptions WHERE tenant_id = ? GROUP BY service_name
      ) counts ON counts.service_name = s.service_name AND counts.latest = s.created_at
      WHERE s.tenant_id = ?
      GROUP BY s.service_name
      ORDER BY counts.times_used DESC, s.service_name ASC
      LIMIT 50
    `
    )
    .all(tenantId, tenantId) as Array<{ service_name: string; period_days: number; amount_cents: number | null; times_used: number }>;
}
