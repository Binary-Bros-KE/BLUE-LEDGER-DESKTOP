import { randomUUID } from "node:crypto";
import * as riderRepository from "@main/database/repositories/rider-repository";
import { requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { riderInputSchema } from "@shared/schemas/rider";
import type { Rider, RiderStatus } from "@shared/types/rider";

/** Every tenant-wide rider, master-data style — not branch-scoped, since a rider can deliver for any
 * storefront. Callers building a selection dropdown should filter to status === "active" themselves
 * unless they're deliberately letting the user pick from inactive riders too. */
export function listRiders(): Rider[] {
  requirePermission("riders", "view");
  const { tenantId } = getCurrentTenant();
  return riderRepository.findAllRiderRows(tenantId).map(riderRepository.mapRiderRow);
}

export function getRider(id: string): Rider {
  requirePermission("riders", "view");
  const row = riderRepository.findRiderRowById(id);
  if (!row) {
    throw new Error("Rider not found");
  }
  return riderRepository.mapRiderRow(row);
}

export function createRider(input: unknown): Rider {
  requirePermission("riders", "create");
  const parsed = riderInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();

  const row = riderRepository.insertRiderRow({
    ...parsed,
    id: `rider_${randomUUID()}`,
    tenantId
  });
  return riderRepository.mapRiderRow(row);
}

export function updateRider(id: string, input: unknown): Rider {
  requirePermission("riders", "edit");
  const parsed = riderInputSchema.parse(input);
  const existing = riderRepository.findRiderRowById(id);
  if (!existing) {
    throw new Error("Rider not found");
  }

  const row = riderRepository.updateRiderRow(id, parsed);
  return riderRepository.mapRiderRow(row);
}

/** Riders are never permanently deleted — delivery notes will reference them by id, so only their
 * visibility toggles. */
export function setRiderStatus(id: string, status: RiderStatus): Rider {
  requirePermission("riders", "edit");
  const row = riderRepository.setRiderStatusRow(id, status);
  return riderRepository.mapRiderRow(row);
}
