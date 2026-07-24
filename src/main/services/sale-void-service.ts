import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as saleRepository from "@main/database/repositories/sale-repository";
import * as saleVoidRepository from "@main/database/repositories/sale-void-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { assertNotAlreadyDecidedRemotely } from "@main/services/sync-engine";
import { getCurrentTenant } from "@main/services/tenant-service";
import { approvalDecisionSchema, saleVoidRequestSchema } from "@shared/schemas/sale-void";
import type { SaleVoid } from "@shared/types/sale-void";

function requireEmployeeId(): string {
  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }
  return employeeId;
}

function getSaleVoidDetail(id: string): SaleVoid {
  const row = saleVoidRepository.findSaleVoidDetailRowById(id);
  if (!row) {
    throw new Error("Void request not found");
  }
  return saleVoidRepository.mapSaleVoidDetailRow(row);
}

export function listSaleVoids(): SaleVoid[] {
  requirePermission("sales", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return saleVoidRepository.findAllSaleVoidRows(tenantId, locationId).map(saleVoidRepository.mapSaleVoidDetailRow);
}

export function getSaleVoid(id: string): SaleVoid {
  requirePermission("sales", "view");
  return getSaleVoidDetail(id);
}

/** A cashier's request to invalidate a completed sale. Nothing changes until a manager approves it. */
export function requestSaleVoid(input: unknown): SaleVoid {
  requirePermission("sales", "edit");
  const parsed = saleVoidRequestSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = requireEmployeeId();

  const sale = saleRepository.findSaleRowById(parsed.saleId);
  if (!sale || sale.tenant_id !== tenantId) {
    throw new Error("Sale not found");
  }
  if (sale.sale_status !== "completed") {
    throw new Error("Only completed sales can be voided");
  }
  if (saleVoidRepository.findPendingSaleVoidForSaleRow(sale.id)) {
    throw new Error("This sale already has a void request awaiting approval");
  }

  const row = saleVoidRepository.insertSaleVoidRow({
    id: `sale_void_${randomUUID()}`,
    tenantId,
    saleId: sale.id,
    reason: parsed.reason,
    notes: parsed.notes,
    requestedBy: employeeId
  });
  return getSaleVoidDetail(row.id);
}

/** Manager approval: restocks every item on the sale (as a 'return' movement) and marks the request approved. */
export async function approveSaleVoid(id: string, input: unknown): Promise<SaleVoid> {
  requirePermission("approvals", "approve");
  const parsed = approvalDecisionSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const approverId = requireEmployeeId();

  const voidRow = saleVoidRepository.findSaleVoidRowById(id);
  if (!voidRow || voidRow.tenant_id !== tenantId) {
    throw new Error("Void request not found");
  }
  if (voidRow.status !== "pending_approval") {
    throw new Error("This request has already been decided");
  }
  await assertNotAlreadyDecidedRemotely("sale_voids", id, "pending_approval");

  const sale = saleRepository.findSaleRowById(voidRow.sale_id);
  if (!sale) {
    throw new Error("Sale not found");
  }
  const items = saleRepository.findSaleItemDetailRows(sale.id);

  runInTransaction(() => {
    for (const item of items) {
      applyValidatedStockMovement(
        {
          productId: item.product_id,
          locationId: sale.location_id,
          movementType: "return",
          quantityChange: item.quantity,
          referenceType: "sale_void",
          referenceId: id,
          performedBy: approverId,
          notes: null
        },
        tenantId
      );
    }
    saleVoidRepository.updateSaleVoidStatusRow(id, "approved", approverId, parsed.notes);
  });

  return getSaleVoidDetail(id);
}

export async function rejectSaleVoid(id: string, input: unknown): Promise<SaleVoid> {
  requirePermission("approvals", "approve");
  const parsed = approvalDecisionSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const approverId = requireEmployeeId();

  const voidRow = saleVoidRepository.findSaleVoidRowById(id);
  if (!voidRow || voidRow.tenant_id !== tenantId) {
    throw new Error("Void request not found");
  }
  if (voidRow.status !== "pending_approval") {
    throw new Error("This request has already been decided");
  }
  await assertNotAlreadyDecidedRemotely("sale_voids", id, "pending_approval");

  saleVoidRepository.updateSaleVoidStatusRow(id, "rejected", approverId, parsed.notes);
  return getSaleVoidDetail(id);
}
