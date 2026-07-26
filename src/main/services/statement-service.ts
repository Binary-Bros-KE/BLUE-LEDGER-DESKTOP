import * as customerRepository from "@main/database/repositories/customer-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import { requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import type { CustomerStatementViewModel } from "@shared/types/statement";

/** Statement of Account — every invoice this customer hasn't fully paid off yet, across every
 * storefront, with running totals. Nothing new to persist: this is a pure read/aggregate over the
 * existing sales+customers rows, same query the credit-limit check already uses
 * (findCustomerOutstandingBalanceRow), just returning the invoice-by-invoice detail behind that
 * number instead of only the sum. */
export function getCustomerStatement(customerId: string): CustomerStatementViewModel {
  requirePermission("sales", "view");
  const tenant = getCurrentTenant();

  const customer = customerRepository.findCustomerRowById(customerId);
  if (!customer || customer.tenant_id !== tenant.tenantId) {
    throw new Error("Customer not found");
  }

  const invoices = saleRepository
    .findOutstandingInvoiceRowsForCustomer(tenant.tenantId, customerId)
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
