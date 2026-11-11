import type { SubscriptionNoticeStage, SubscriptionStage } from "@shared/lib/subscription-schedule";

export type SubscriptionStatus = "active" | "renewed" | "cancelled";

/** "other" = the customer was told some other way (a call, in person). */
export type SubscriptionNoticeChannel = "whatsapp" | "email" | "other";

export type SubscriptionNotice = {
  id: string;
  stage: SubscriptionNoticeStage;
  channel: SubscriptionNoticeChannel;
  recipient: string | null;
  sentAt: string;
  sentByName: string | null;
};

/** One paid period of a customer's subscription (DStv, GOtv...). Renewing creates the next period and
 * marks this one "renewed". daysLeft/stage/pendingNotice are worked out against today every time
 * it's read — see shared/lib/subscription-schedule.ts — never stored. */
export type Subscription = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  locationId: string | null;
  locationName: string | null;
  serviceName: string;
  /** Smartcard / IUC number: what the shop quotes when renewing with the provider. */
  accountNumber: string | null;
  startDate: string;
  periodDays: number;
  endDate: string;
  /** What the customer paid, for the record only: tracking, no money is recorded anywhere. */
  amountCents: number | null;
  status: SubscriptionStatus;
  renewedFromId: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  daysLeft: number;
  stage: SubscriptionStage;
  /** The reminder to send now, if any (the most urgent unsent one). */
  pendingNotice: SubscriptionNoticeStage | null;
  notices: SubscriptionNotice[];
};

/** "Remembered" services for the Service field: typing "DS" offers "DStv Compact" with its last
 * period and price. */
export type SubscriptionServiceSuggestion = {
  serviceName: string;
  periodDays: number;
  amountCents: number | null;
  timesUsed: number;
};
