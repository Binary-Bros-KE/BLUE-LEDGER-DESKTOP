import {
  ONLINE_ORDER_FLOWS,
  type OnlineOrder,
  type OnlineOrderDeliveryType,
  type OnlineOrderPayment,
  type OnlineOrderStatus
} from "@shared/types/online-store";

/**
 * Step logic + customer messages for web orders. The SERVER enforces the same step order
 * (shop-order-service.ts ORDER_FLOWS) — this file only decides what the screen offers.
 */

export const STATUS_LABEL: Record<OnlineOrderStatus, string> = {
  NEW: "Pending",
  CONFIRMED: "Confirmed",
  READY: "Ready for pickup",
  PICKED_UP: "Picked up",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled"
};

export const STATUS_PILL: Record<OnlineOrderStatus, string> = {
  NEW: "bg-primary text-white",
  CONFIRMED: "bg-accent text-white",
  READY: "bg-teal text-white",
  PICKED_UP: "bg-warning text-white",
  SHIPPED: "bg-teal text-white",
  DELIVERED: "bg-warning text-white",
  COMPLETED: "bg-success text-white",
  CANCELLED: "bg-white text-muted border border-line"
};

export function routeOf(order: OnlineOrder): OnlineOrderDeliveryType {
  return order.deliveryType === "pickup" ? "pickup" : "delivery";
}

export function flowOf(order: OnlineOrder): readonly OnlineOrderStatus[] {
  return ONLINE_ORDER_FLOWS[routeOf(order)];
}

/** The status one step on, or null at the hand-over (next is completing the sale) / when closed. */
export function nextStatus(order: OnlineOrder): OnlineOrderStatus | null {
  const flow = flowOf(order);
  const at = flow.indexOf(order.status);
  return at === -1 ? null : (flow[at + 1] ?? null);
}

export function previousStatus(order: OnlineOrder): OnlineOrderStatus | null {
  const flow = flowOf(order);
  const at = flow.indexOf(order.status);
  return at > 0 ? (flow[at - 1] ?? null) : null;
}

export function isHandedOver(order: OnlineOrder): boolean {
  return order.status === "PICKED_UP" || order.status === "DELIVERED";
}

export function isOpen(order: OnlineOrder): boolean {
  return order.status !== "COMPLETED" && order.status !== "CANCELLED" && !order.linkedSaleId;
}

export function canCancel(order: OnlineOrder): boolean {
  return isOpen(order) && !isHandedOver(order);
}

/** Pick-up ↔ delivery only before anything was prepared for the current route. */
export function canSwitchRoute(order: OnlineOrder): boolean {
  return isOpen(order) && (order.status === "NEW" || order.status === "CONFIRMED");
}

/** Button text for moving TO a status. */
export const ADVANCE_LABEL: Partial<Record<OnlineOrderStatus, string>> = {
  CONFIRMED: "Confirm order",
  READY: "Mark ready for pickup",
  PICKED_UP: "Mark picked up",
  SHIPPED: "Mark shipped",
  DELIVERED: "Mark delivered"
};

/** One-line explanation of where the order is and what comes next. */
export function stageHint(order: OnlineOrder): string {
  if (order.status === "CANCELLED") return "This order was cancelled. Reopen it if the customer still wants it.";
  if (order.status === "COMPLETED" || order.linkedSaleId) return "Completed and recorded as a sale.";
  if (isHandedOver(order)) {
    return order.balanceCents > 0
      ? "Handed over. Record the balance, then complete the order to turn it into a sale."
      : "Handed over and fully paid. Complete the order to turn it into a sale.";
  }
  const next = nextStatus(order);
  if (order.status === "NEW") {
    return "Call or WhatsApp the customer, then confirm the order — confirming holds its items out of stock so nobody sells them at the till.";
  }
  return next ? `Next: ${STATUS_LABEL[next].toLowerCase()}.` : "";
}

export type PaymentState = "unpaid" | "partial" | "paid";

export function paymentState(order: OnlineOrder): PaymentState {
  if (order.paidCents <= 0) return "unpaid";
  return order.balanceCents > 0 ? "partial" : "paid";
}

export const PAYMENT_LABEL: Record<PaymentState, string> = {
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid"
};

export const PAYMENT_PILL: Record<PaymentState, string> = {
  unpaid: "border border-dashed border-danger/50 text-danger bg-white",
  partial: "border border-warning/40 bg-warning/10 text-warning",
  paid: "border border-success/40 bg-success/10 text-success"
};

// --- Customer messages ---------------------------------------------------------------------------

export type OrderMessageKind = OnlineOrderStatus | "PAYMENT" | "UPDATED";

type MessageContext = {
  businessName: string;
  money: (cents: number) => string;
  /** for "PAYMENT": the payment just recorded */
  payment?: OnlineOrderPayment | null;
  /** for "UPDATED": what changed, e.g. "10UF Capacitor: 50 → 12" */
  changes?: string[] | null;
  /** for "COMPLETED": the receipt it became */
  receiptNumber?: string | null;
};

function itemLines(order: OnlineOrder, money: (cents: number) => string): string {
  return order.items.map((it) => `• ${it.name} × ${it.qty} — ${money(it.lineTotalCents)}`).join("\n");
}

function moneyLines(order: OnlineOrder, money: (cents: number) => string): string {
  const lines = [`*Total: ${money(order.totalCents)}*`];
  if (order.paidCents > 0) lines.push(`Paid: ${money(order.paidCents)}`);
  if (order.paidCents > 0 || order.status !== "NEW") {
    lines.push(order.balanceCents > 0 ? `Balance: ${money(order.balanceCents)}` : "Fully paid ✅");
  }
  return lines.join("\n");
}

/**
 * The WhatsApp/email text for an update to the customer. WhatsApp renders *bold*; email shows the
 * asterisks as-is, which reads fine. The user can still edit it before sending.
 */
export function buildOrderMessage(order: OnlineOrder, kind: OrderMessageKind, ctx: MessageContext): string {
  const firstName = order.customerName.trim().split(/\s+/)[0] || "there";
  const shop = ctx.businessName || "our shop";
  const ref = `*${order.orderNumber}*`;
  const hi = `Hi ${firstName},`;
  const sign = `— ${shop}`;
  const pickup = routeOf(order) === "pickup";
  const items = itemLines(order, ctx.money);
  const totals = moneyLines(order, ctx.money);

  switch (kind) {
    case "NEW":
      return [
        hi,
        `Thank you for your order ${ref} at ${shop}. We've received it and will confirm it shortly.`,
        items,
        totals,
        sign
      ].join("\n\n");
    case "CONFIRMED":
      return [
        hi,
        `Your order ${ref} is *confirmed* ✅`,
        items,
        totals,
        pickup
          ? "We'll let you know as soon as it's ready for pickup."
          : `We'll let you know when it's on the way to:\n${order.deliveryAddress ?? "your address"}`,
        sign
      ].join("\n\n");
    case "READY":
      return [
        hi,
        `Good news — your order ${ref} is *ready for pickup* at ${shop} 🛍️`,
        order.balanceCents > 0
          ? `Please bring ${ctx.money(order.balanceCents)} to pay the balance when you collect.`
          : "It's fully paid — just mention your order number when you collect.",
        sign
      ].join("\n\n");
    case "PICKED_UP":
      return [hi, `Thank you for collecting your order ${ref}. We hope you enjoy it!`, sign].join("\n\n");
    case "SHIPPED":
      return [
        hi,
        `Your order ${ref} is *on the way* 🚚`,
        order.riderName ? `Rider: ${order.riderName}` : null,
        `Delivering to:\n${order.deliveryAddress ?? "your address"}`,
        order.balanceCents > 0 ? `Balance to pay on delivery: *${ctx.money(order.balanceCents)}*` : "It's fully paid.",
        sign
      ]
        .filter(Boolean)
        .join("\n\n");
    case "DELIVERED":
      return [hi, `Your order ${ref} has been *delivered* 📦. Thank you for shopping with us!`, sign].join("\n\n");
    case "COMPLETED":
      return [
        hi,
        `Your order ${ref} is complete${ctx.receiptNumber ? ` — receipt *${ctx.receiptNumber}*` : ""}.`,
        totals,
        `Thank you for shopping with ${shop}! 🙏`
      ].join("\n\n");
    case "CANCELLED":
      return [
        hi,
        `Your order ${ref} has been *cancelled*.`,
        order.paidCents > 0
          ? `We'll get in touch about refunding the ${ctx.money(order.paidCents)} you paid.`
          : "If this is unexpected, just reply to this message.",
        sign
      ].join("\n\n");
    case "UPDATED":
      return [
        hi,
        `We've updated your order ${ref}:`,
        (ctx.changes ?? []).map((c) => `• ${c}`).join("\n"),
        `Your order now:\n${items}`,
        `*New total: ${ctx.money(order.totalCents)}*`,
        "Reply to this message if you have any questions.",
        sign
      ].join("\n\n");
    case "PAYMENT": {
      const p = ctx.payment;
      return [
        hi,
        p
          ? `We've received your payment of *${ctx.money(p.amountCents)}* via ${p.paymentMethodName}${
              p.reference ? ` (ref ${p.reference})` : ""
            } for order ${ref}. Thank you!`
          : `Here's the payment status of your order ${ref}.`,
        totals,
        sign
      ].join("\n\n");
    }
  }
}

export const MESSAGE_SUBJECT: Record<OrderMessageKind, string> = {
  NEW: "We've received your order",
  CONFIRMED: "Your order is confirmed",
  READY: "Your order is ready for pickup",
  PICKED_UP: "Thanks for collecting your order",
  SHIPPED: "Your order is on the way",
  DELIVERED: "Your order has been delivered",
  COMPLETED: "Your order is complete",
  CANCELLED: "Your order has been cancelled",
  PAYMENT: "Payment received",
  UPDATED: "Your order has been updated"
};
