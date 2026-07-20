import * as customerReportRepository from "@main/database/repositories/customer-report-repository";
import { getCurrentBranchScope, requirePermission, requirePermissionAnyOf } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { dateRangeInputSchema } from "@shared/schemas/report";
import { customerPurchaseHistoryInputSchema } from "@shared/schemas/customer-report";
import type {
  CustomerPurchaseHistoryEntry,
  OutstandingInvoiceRow,
  OutstandingInvoicesSummary,
  TopCustomerRow,
} from "@shared/types/customer-report";
import type { SalesTransactionKind } from "@shared/types/report";

const PURCHASE_HISTORY_LIMIT = 200;

function startOfDayIso(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`;
}

function addDaysIso(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Every customer with an attributed sale in the period, ranked by revenue, plus a synthetic
 * "Walk-in Customer" row aggregating every sale with no customer attached — real revenue that
 * shouldn't be silently dropped just because it's not tied to a customer record. */
export function getTopCustomers(input: unknown): TopCustomerRow[] {
  requirePermission("reports", "view");
  const { startDate, endDate } = dateRangeInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const startIso = startOfDayIso(startDate);
  const endIsoExclusive = startOfDayIso(addDaysIso(endDate, 1));

  const rows = customerReportRepository.findTopCustomersInRange(tenantId, locationId, startIso, endIsoExclusive);
  const walkIn = customerReportRepository.findWalkInRevenueInRange(tenantId, locationId, startIso, endIsoExclusive);

  const customers: Array<{ customerId: string | null; customerName: string; phone: string | null; transactionCount: number; revenueCents: number }> =
    rows.map((row) => ({
      customerId: row.customer_id,
      customerName: row.customer_name,
      phone: row.phone,
      transactionCount: row.transaction_count,
      revenueCents: row.revenue_cents,
    }));

  if (walkIn && walkIn.transaction_count > 0) {
    customers.push({
      customerId: null,
      customerName: "Walk-in Customer",
      phone: null,
      transactionCount: walkIn.transaction_count,
      revenueCents: walkIn.revenue_cents,
    });
  }

  const totalRevenueCents = customers.reduce((sum, customer) => sum + customer.revenueCents, 0);

  return customers
    .map((customer) => ({
      ...customer,
      averageSaleCents: customer.transactionCount > 0 ? Math.round(customer.revenueCents / customer.transactionCount) : 0,
      percentOfTotal: totalRevenueCents > 0 ? Math.round((customer.revenueCents / totalRevenueCents) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

/** Every completed sale/invoice for one customer, newest first — not
 * period-scoped, since a "history" is the whole story, not a slice of it. */
export function getCustomerPurchaseHistory(input: unknown): CustomerPurchaseHistoryEntry[] {
  requirePermissionAnyOf([
    ["reports", "view"],
    ["customers", "view"]
  ]);
  const { customerId } = customerPurchaseHistoryInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const rows = customerReportRepository.findCustomerPurchaseHistory(tenantId, locationId, customerId, PURCHASE_HISTORY_LIMIT);

  return rows.map((row) => ({
    saleId: row.sale_id,
    occurredAt: row.completed_at,
    documentNumber: row.document_number,
    kind: row.transaction_type as SalesTransactionKind,
    locationName: row.location_name,
    employeeName: row.employee_name,
    itemCount: row.item_count,
    grandTotalCents: row.grand_total_cents,
    amountPaidCents: row.amount_paid_cents,
    paymentStatus: row.payment_status,
  }));
}

/** Every currently-outstanding invoice — a live balance-sheet snapshot,
 * deliberately not scoped to any selected period (see the same reasoning
 * behind Sales Report's Debtors section). */
export function getOutstandingInvoices(): OutstandingInvoicesSummary {
  requirePermission("reports", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();

  const today = new Date().toISOString().slice(0, 10);
  const rows = customerReportRepository.findOutstandingInvoices(tenantId, locationId);

  const invoices: OutstandingInvoiceRow[] = rows
    .map((row) => {
      const balanceCents = Math.max(0, row.grand_total_cents - row.amount_paid_cents - row.returned_value_cents);
      return {
        saleId: row.sale_id,
        customerId: row.customer_id,
        customerName: row.customer_name,
        phone: row.phone,
        documentNumber: row.document_number,
        completedAt: row.completed_at,
        dueDate: row.due_date,
        grandTotalCents: row.grand_total_cents,
        amountPaidCents: row.amount_paid_cents,
        balanceCents,
        isOverdue: row.due_date !== null && row.due_date < today && balanceCents > 0,
      };
    })
    .filter((invoice) => invoice.balanceCents > 0);

  return {
    totalOutstandingCents: invoices.reduce((sum, invoice) => sum + invoice.balanceCents, 0),
    debtorCount: new Set(invoices.map((invoice) => invoice.customerId)).size,
    overdueCount: invoices.filter((invoice) => invoice.isOverdue).length,
    invoices,
  };
}
