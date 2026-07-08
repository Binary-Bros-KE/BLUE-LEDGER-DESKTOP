import type { PaymentStatus } from "@shared/types/sale";

/**
 * Derives the correct payment status from the numbers, rather than trusting a stored value that
 * can go stale as the calendar moves past a due date. Used both when persisting a best-effort
 * snapshot (writes) and when displaying the live status (reads).
 */
export function computePaymentStatus(params: {
  balanceDueCents: number;
  amountPaidCents: number;
  dueDate: string | null;
  cancelled: boolean;
  now?: Date;
}): PaymentStatus {
  if (params.cancelled) return "cancelled";
  if (params.balanceDueCents <= 0) return "paid";

  const now = params.now ?? new Date();
  if (params.dueDate && new Date(params.dueDate).getTime() < now.getTime()) {
    return "overdue";
  }
  if (params.amountPaidCents > 0) return "partially_paid";
  return "unpaid";
}
