import * as customerRepository from "@main/database/repositories/customer-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import { requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { statementFiltersSchema } from "@shared/schemas/statement";
import type { CustomerStatementViewModel } from "@shared/types/statement";

/** Ported from report-service.ts's own identical helper — ties a plain YYYY-MM-DD to THIS device's
 * local midnight (never UTC midnight, which would silently shift a boundary invoice into the wrong
 * side of the filter for any timezone ahead of UTC). */
function startOfDayIso(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toISOString();
}

function addDaysIso(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/** Statement of Account — by default, every invoice this customer hasn't fully paid off yet, across
 * every storefront, with running totals. Client request: also needs to show paid/historical invoices
 * on demand (filters.status) and an optional date range — see statementFiltersSchema. Nothing new to
 * persist either way: this is a pure read/aggregate over the existing sales+customers rows, same
 * query the credit-limit check already uses (findCustomerOutstandingBalanceRow) when filters is left
 * at its "pending" default. */
export function getCustomerStatement(customerId: string, filtersInput: unknown = {}): CustomerStatementViewModel {
  requirePermission("sales", "view");
  const filters = statementFiltersSchema.parse(filtersInput);
  const tenant = getCurrentTenant();

  const customer = customerRepository.findCustomerRowById(customerId);
  if (!customer || customer.tenant_id !== tenant.tenantId) {
    throw new Error("Customer not found");
  }

  const invoices = saleRepository
    .findInvoiceRowsForCustomer(tenant.tenantId, customerId, {
      status: filters.status,
      dateFromIso: filters.dateFrom ? startOfDayIso(filters.dateFrom) : null,
      dateToExclusiveIso: filters.dateTo ? addDaysIso(filters.dateTo, 1) : null
    })
    .map(saleRepository.mapInvoiceListRow);

  const totalInvoicedCents = invoices.reduce((sum, invoice) => sum + invoice.grandTotalCents, 0);
  const totalPaidCents = invoices.reduce((sum, invoice) => sum + invoice.amountPaidCents, 0);
  const totalOutstandingCents = invoices.reduce((sum, invoice) => sum + invoice.balanceDueCents, 0);

  return {
    businessName: tenant.businessName,
    physicalAddress: tenant.physicalAddress,
    primaryPhone: tenant.primaryPhone,
    currency: tenant.currency,
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone,
    customerEmail: customer.email,
    creditLimitCents: customer.credit_limit_cents,
    generatedAt: new Date().toISOString(),
    filters: { status: filters.status, dateFrom: filters.dateFrom ?? null, dateTo: filters.dateTo ?? null },
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      grandTotalCents: invoice.grandTotalCents,
      amountPaidCents: invoice.amountPaidCents,
      balanceDueCents: invoice.balanceDueCents,
      paymentStatus: invoice.paymentStatus
    })),
    totalInvoicedCents,
    totalPaidCents,
    totalOutstandingCents
  };
}
