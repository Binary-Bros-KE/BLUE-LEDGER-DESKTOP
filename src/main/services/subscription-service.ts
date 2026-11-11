import { runInTransaction } from "@main/database/connection";
import * as customerRepository from "@main/database/repositories/customer-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as subscriptionRepository from "@main/database/repositories/subscription-repository";
import type { SubscriptionNoticeRow, SubscriptionRow } from "@main/database/repositories/subscription-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import {
  SUBSCRIPTION_NOTICE_LABELS,
  SUBSCRIPTION_NOTICE_STAGES,
  daysRemaining,
  defaultRenewalStart,
  endDateFor,
  localTodayIso,
  pendingNotice,
  stageFor,
  type SubscriptionNoticeStage
} from "@shared/lib/subscription-schedule";
import { subscriptionInputSchema, subscriptionNoticeSchema, subscriptionRenewSchema } from "@shared/schemas/subscription";
import type { Subscription, SubscriptionNotice, SubscriptionServiceSuggestion } from "@shared/types/subscription";

/**
 * Subscriptions the shop sells on a customer's behalf (DStv, GOtv...): tracking and manual reminders
 * only, no money moves (client spec — payments are rung up at Checkout as usual). Every date rule lives
 * in shared/lib/subscription-schedule.ts. Branch-scoped employees only ever see and touch their own
 * storefront's subscriptions, same as recurring bills.
 */

function mapNotice(row: SubscriptionNoticeRow): SubscriptionNotice {
  return {
    id: row.id,
    stage: row.stage,
    channel: row.channel,
    recipient: row.recipient,
    sentAt: row.sent_at,
    sentByName: row.sent_by_name
  };
}

function mapRow(row: SubscriptionRow, noticeRows: SubscriptionNoticeRow[], today: string): Subscription {
  const notices = noticeRows.map(mapNotice);
  const daysLeft = daysRemaining(row.end_date, today);
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name ?? "Unknown customer",
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    locationId: row.location_id,
    locationName: row.location_name,
    serviceName: row.service_name,
    accountNumber: row.account_number,
    startDate: row.start_date,
    periodDays: row.period_days,
    endDate: row.end_date,
    amountCents: row.amount_cents,
    status: row.status,
    renewedFromId: row.renewed_from_id,
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    daysLeft,
    stage: stageFor(daysLeft),
    pendingNotice: pendingNotice(
      row.status,
      daysLeft,
      notices.map((notice) => notice.stage)
    ),
    notices
  };
}

function mapOne(row: SubscriptionRow): Subscription {
  return mapRow(row, subscriptionRepository.findNoticeRowsForSubscription(row.id), localTodayIso());
}

/** Loads a subscription this employee may act on. Another storefront's reads as not existing. */
function requireRow(id: string): SubscriptionRow {
  const row = subscriptionRepository.findSubscriptionRowById(id);
  const { tenantId } = getCurrentTenant();
  const branch = getCurrentBranchScope();
  if (!row || row.tenant_id !== tenantId || (branch && row.location_id !== branch)) {
    throw new Error("Subscription not found");
  }
  return row;
}

function requireCustomer(customerId: string): void {
  const customer = customerRepository.findCustomerRowById(customerId);
  if (!customer || customer.tenant_id !== getCurrentTenant().tenantId) {
    throw new Error("Customer not found");
  }
}

/** A branch-scoped employee's subscriptions always belong to their storefront. */
function resolveLocation(requested: string | null): string | null {
  const branch = getCurrentBranchScope();
  if (branch) return branch;
  if (!requested) return null;
  const location = locationRepository.findLocationRowById(requested);
  if (!location || location.tenant_id !== getCurrentTenant().tenantId) {
    throw new Error("Storefront not found");
  }
  return requested;
}

function stageIndex(stage: SubscriptionNoticeStage): number {
  return SUBSCRIPTION_NOTICE_STAGES.indexOf(stage);
}

export function listSubscriptions(): Subscription[] {
  requirePermission("subscriptions", "view");
  const { tenantId } = getCurrentTenant();
  const today = localTodayIso();
  const noticesBySubscription = new Map<string, SubscriptionNoticeRow[]>();
  for (const notice of subscriptionRepository.findAllNoticeRows(tenantId)) {
    const list = noticesBySubscription.get(notice.subscription_id) ?? [];
    list.push(notice);
    noticesBySubscription.set(notice.subscription_id, list);
  }
  return subscriptionRepository
    .findCurrentSubscriptionRows(tenantId, getCurrentBranchScope())
    .map((row) => mapRow(row, noticesBySubscription.get(row.id) ?? [], today));
}

/** Reminders waiting to be sent: the sidebar badge and the daily toast. */
export function countPendingSubscriptionNotices(): number {
  return listSubscriptions().filter((subscription) => subscription.pendingNotice !== null).length;
}

export function getSubscription(id: string): Subscription {
  requirePermission("subscriptions", "view");
  return mapOne(requireRow(id));
}

/** Every period a customer has had, newest first: the history in the detail panel. */
export function listCustomerSubscriptions(customerId: string): Subscription[] {
  requirePermission("subscriptions", "view");
  requireCustomer(customerId);
  return subscriptionRepository.findSubscriptionRowsForCustomer(customerId, getCurrentBranchScope()).map(mapOne);
}

export function listSubscriptionServiceSuggestions(): SubscriptionServiceSuggestion[] {
  requirePermission("subscriptions", "view");
  const { tenantId } = getCurrentTenant();
  return subscriptionRepository.findServiceSuggestionRows(tenantId).map((row) => ({
    serviceName: row.service_name,
    periodDays: row.period_days,
    amountCents: row.amount_cents,
    timesUsed: row.times_used
  }));
}

export function createSubscription(input: unknown): Subscription {
  requirePermission("subscriptions", "create");
  const parsed = subscriptionInputSchema.parse(input);
  requireCustomer(parsed.customerId);
  const id = subscriptionRepository.insertSubscriptionRow({
    tenantId: getCurrentTenant().tenantId,
    customerId: parsed.customerId,
    locationId: resolveLocation(parsed.locationId),
    serviceName: parsed.serviceName,
    accountNumber: parsed.accountNumber,
    startDate: parsed.startDate,
    periodDays: parsed.periodDays,
    endDate: endDateFor(parsed.startDate, parsed.periodDays),
    amountCents: parsed.amountCents,
    renewedFromId: null,
    notes: parsed.notes,
    createdBy: getCurrentEmployeeId()
  });
  return getSubscription(id);
}

/** Corrections to the current period. A renewed period is history and stays as it was. */
export function updateSubscription(id: string, input: unknown): Subscription {
  requirePermission("subscriptions", "edit");
  const existing = requireRow(id);
  if (existing.status === "renewed") throw new Error("This period has been renewed — edit the current one instead.");
  const parsed = subscriptionInputSchema.parse(input);
  requireCustomer(parsed.customerId);
  subscriptionRepository.updateSubscriptionRow(id, {
    customerId: parsed.customerId,
    locationId: getCurrentBranchScope() ? existing.location_id : resolveLocation(parsed.locationId),
    serviceName: parsed.serviceName,
    accountNumber: parsed.accountNumber,
    startDate: parsed.startDate,
    periodDays: parsed.periodDays,
    endDate: endDateFor(parsed.startDate, parsed.periodDays),
    amountCents: parsed.amountCents,
    notes: parsed.notes
  });
  return getSubscription(id);
}

/** Where the renew form starts: the old end date if renewed early, today if it had already run out. */
export function getSubscriptionRenewalDefaults(id: string): { startDate: string; periodDays: number; amountCents: number | null } {
  requirePermission("subscriptions", "view");
  const row = requireRow(id);
  return { startDate: defaultRenewalStart(row.end_date, localTodayIso()), periodDays: row.period_days, amountCents: row.amount_cents };
}

/** The next paid period: same customer, service, account and storefront. The old one becomes history
 * (no more reminders for it) and the new one's reminders start fresh. Both happen together or not at all. */
export function renewSubscription(id: string, input: unknown): Subscription {
  requirePermission("subscriptions", "create");
  const existing = requireRow(id);
  if (existing.status === "renewed") throw new Error("This period has already been renewed.");
  const parsed = subscriptionRenewSchema.parse(input);
  const newId = runInTransaction(() => {
    subscriptionRepository.updateSubscriptionStatusRow(id, "renewed");
    return subscriptionRepository.insertSubscriptionRow({
      tenantId: existing.tenant_id,
      customerId: existing.customer_id,
      locationId: existing.location_id,
      serviceName: existing.service_name,
      accountNumber: existing.account_number,
      startDate: parsed.startDate,
      periodDays: parsed.periodDays,
      endDate: endDateFor(parsed.startDate, parsed.periodDays),
      amountCents: parsed.amountCents,
      renewedFromId: id,
      notes: null,
      createdBy: getCurrentEmployeeId()
    });
  });
  return getSubscription(newId);
}

/** Cancel stops all reminders; reactivating brings them back. A renewed period can't change status. */
export function setSubscriptionStatus(id: string, status: "active" | "cancelled"): Subscription {
  requirePermission("subscriptions", "edit");
  const existing = requireRow(id);
  if (existing.status === "renewed") throw new Error("This period has been renewed — change the current one instead.");
  subscriptionRepository.updateSubscriptionStatusRow(id, status);
  return getSubscription(id);
}

/**
 * Only for a mistake caught before it synced: sync never deletes on the cloud (same as recurring bills),
 * so once synced, Cancel is the way. Deleting a renewal before it synced puts the previous period back
 * to active, which is exactly "undo that renewal".
 */
export function deleteSubscription(id: string): void {
  requirePermission("subscriptions", "delete");
  const existing = requireRow(id);
  if (existing.sync_status !== "pending") {
    throw new Error("This subscription has already synced — cancel it instead of deleting it.");
  }
  if (subscriptionRepository.findNoticeRowsForSubscription(id).length > 0) {
    throw new Error("A reminder was already sent for this subscription — cancel it instead of deleting it.");
  }
  if (subscriptionRepository.findRenewalOf(id)) {
    throw new Error("This period has been renewed — delete the newer one first.");
  }
  runInTransaction(() => {
    subscriptionRepository.deleteSubscriptionRow(id);
    if (existing.renewed_from_id) {
      const previous = subscriptionRepository.findSubscriptionRowById(existing.renewed_from_id);
      if (previous?.status === "renewed") subscriptionRepository.updateSubscriptionStatusRow(previous.id, "active");
    }
  });
}

/**
 * Records that a reminder went out (sent by hand through WhatsApp or email, or told another way). Only
 * a reminder the subscription has actually reached, and never one already covered: the same reminder,
 * or a later one, already recorded (possibly from another PC that synced first).
 */
export function recordSubscriptionNotice(id: string, input: unknown): Subscription {
  requirePermission("subscriptions", "edit");
  const existing = requireRow(id);
  if (existing.status !== "active") throw new Error("Reminders are only sent for a current, active subscription.");
  const parsed = subscriptionNoticeSchema.parse(input);
  const stage = parsed.stage as SubscriptionNoticeStage;
  const current = stageFor(daysRemaining(existing.end_date, localTodayIso()));
  if (current === "active" || stageIndex(current as SubscriptionNoticeStage) < stageIndex(stage)) {
    throw new Error(`It's too early for the "${SUBSCRIPTION_NOTICE_LABELS[stage]}" reminder.`);
  }
  const covering = subscriptionRepository.findNoticeRowsForSubscription(id).find((notice) => stageIndex(notice.stage) >= stageIndex(stage));
  if (covering) {
    const who = covering.sent_by_name ? ` by ${covering.sent_by_name}` : "";
    throw new Error(`The "${SUBSCRIPTION_NOTICE_LABELS[covering.stage]}" reminder was already sent${who}.`);
  }
  subscriptionRepository.insertNoticeRow({
    tenantId: existing.tenant_id,
    subscriptionId: id,
    stage,
    channel: parsed.channel,
    recipient: parsed.recipient,
    sentBy: getCurrentEmployeeId()
  });
  return getSubscription(id);
}
