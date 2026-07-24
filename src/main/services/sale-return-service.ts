import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as saleRepository from "@main/database/repositories/sale-repository";
import * as saleReturnRepository from "@main/database/repositories/sale-return-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { assertNotAlreadyDecidedRemotely } from "@main/services/sync-engine";
import { getCurrentTenant } from "@main/services/tenant-service";
import { approvalDecisionSchema } from "@shared/schemas/sale-void";
import { saleReturnRequestSchema } from "@shared/schemas/sale-return";
import type { SaleReturn } from "@shared/types/sale-return";

function requireEmployeeId(): string {
  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }
  return employeeId;
}

function getSaleReturnDetail(id: string): SaleReturn {
  const row = saleReturnRepository.findSaleReturnDetailRowById(id);
  if (!row) {
    throw new Error("Return request not found");
  }
  const items = saleReturnRepository
    .findSaleReturnItemDetailRows(id)
    .map(saleReturnRepository.mapSaleReturnItemDetailRow);
  return saleReturnRepository.mapSaleReturnDetailRow(row, items);
}

export function listSaleReturns(): SaleReturn[] {
  requirePermission("sales", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return saleReturnRepository.findAllSaleReturnRows(tenantId, locationId).map((row) => {
    const items = saleReturnRepository
      .findSaleReturnItemDetailRows(row.id)
      .map(saleReturnRepository.mapSaleReturnItemDetailRow);
    return saleReturnRepository.mapSaleReturnDetailRow(row, items);
  });
}

export function getSaleReturn(id: string): SaleReturn {
  requirePermission("sales", "view");
  return getSaleReturnDetail(id);
}

/**
 * A cashier's request to return some or all items on a completed sale. The sale itself is never
 * modified — inventory is only restocked once a manager approves the request.
 */
export function requestSaleReturn(input: unknown): SaleReturn {
  requirePermission("sales", "edit");
  const parsed = saleReturnRequestSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = requireEmployeeId();

  const sale = saleRepository.findSaleRowById(parsed.saleId);
  if (!sale || sale.tenant_id !== tenantId) {
    throw new Error("Sale not found");
  }
  if (sale.sale_status !== "completed") {
    throw new Error("Only completed sales can have returns");
  }

  const preparedItems = parsed.items.map((item) => {
    const saleItem = saleRepository.findSaleItemRowById(item.saleItemId);
    if (!saleItem || saleItem.sale_id !== sale.id) {
      throw new Error("One of the selected items does not belong to this sale");
    }
    const alreadyReturned = saleReturnRepository.findApprovedReturnedQuantityForSaleItem(saleItem.id);
    const remaining = saleItem.quantity - alreadyReturned;
    if (item.quantity > remaining) {
      throw new Error(`Only ${remaining} unit(s) of this item remain eligible for return`);
    }
    return {
      saleItemId: saleItem.id,
      productId: saleItem.product_id,
      quantity: item.quantity,
      unitPriceCents: saleItem.unit_price_cents,
      lineTotalCents: saleItem.unit_price_cents * item.quantity
    };
  });

  const saleReturnId = `sale_return_${randomUUID()}`;

  return runInTransaction(() => {
    saleReturnRepository.insertSaleReturnRow({
      id: saleReturnId,
      tenantId,
      saleId: sale.id,
      reason: parsed.reason,
      notes: parsed.notes,
      requestedBy: employeeId
    });

    for (const item of preparedItems) {
      saleReturnRepository.insertSaleReturnItemRow({
        id: `sale_return_item_${randomUUID()}`,
        saleReturnId,
        saleItemId: item.saleItemId,
        productId: item.productId,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.lineTotalCents
      });
    }

    return getSaleReturnDetail(saleReturnId);
  });
}

/** Manager approval: restocks the returned quantities (as a 'return' movement) and marks the request approved. */
export async function approveSaleReturn(id: string, input: unknown): Promise<SaleReturn> {
  requirePermission("approvals", "approve");
  const parsed = approvalDecisionSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const approverId = requireEmployeeId();

  const returnRow = saleReturnRepository.findSaleReturnRowById(id);
  if (!returnRow || returnRow.tenant_id !== tenantId) {
    throw new Error("Return request not found");
  }
  if (returnRow.status !== "pending_approval") {
    throw new Error("This request has already been decided");
  }
  await assertNotAlreadyDecidedRemotely("sale_returns", id, "pending_approval");

  const sale = saleRepository.findSaleRowById(returnRow.sale_id);
  if (!sale) {
    throw new Error("Sale not found");
  }
  const items = saleReturnRepository.findSaleReturnItemDetailRows(id);

  runInTransaction(() => {
    for (const item of items) {
      applyValidatedStockMovement(
        {
          productId: item.product_id,
          locationId: sale.location_id,
          movementType: "return",
          quantityChange: item.quantity,
          referenceType: "sale_return",
          referenceId: id,
          performedBy: approverId,
          notes: null
        },
        tenantId
      );
    }
    saleReturnRepository.updateSaleReturnStatusRow(id, "approved", approverId, parsed.notes);
  });

  return getSaleReturnDetail(id);
}

export async function rejectSaleReturn(id: string, input: unknown): Promise<SaleReturn> {
  requirePermission("approvals", "approve");
  const parsed = approvalDecisionSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const approverId = requireEmployeeId();

  const returnRow = saleReturnRepository.findSaleReturnRowById(id);
  if (!returnRow || returnRow.tenant_id !== tenantId) {
    throw new Error("Return request not found");
  }
  if (returnRow.status !== "pending_approval") {
    throw new Error("This request has already been decided");
  }
  await assertNotAlreadyDecidedRemotely("sale_returns", id, "pending_approval");

  saleReturnRepository.updateSaleReturnStatusRow(id, "rejected", approverId, parsed.notes);
  return getSaleReturnDetail(id);
}
