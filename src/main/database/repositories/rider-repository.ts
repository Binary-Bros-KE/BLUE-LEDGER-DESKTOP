import { getDatabase } from "@main/database/connection";
import type { RiderInput } from "@shared/schemas/rider";
import type { Rider, RiderStatus, RiderSyncStatus } from "@shared/types/rider";

export type RiderRow = {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  alt_phone: string | null;
  company: string | null;
  vehicle_description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

/** Active riders first, inactive ones sorted to the bottom — then alphabetical within each group. */
export function findAllRiderRows(tenantId: string): RiderRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT * FROM riders
      WHERE tenant_id = ?
      ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, name COLLATE NOCASE ASC
    `
    )
    .all(tenantId) as RiderRow[];
}

export function findRiderRowById(id: string): RiderRow | undefined {
  return getDatabase().prepare("SELECT * FROM riders WHERE id = ?").get(id) as RiderRow | undefined;
}

export function insertRiderRow(input: RiderInput & { id: string; tenantId: string }): RiderRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO riders (
        id, tenant_id, name, phone, alt_phone, company, vehicle_description,
        status, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.name,
      input.phone,
      input.altPhone,
      input.company,
      input.vehicleDescription,
      now,
      now
    );

  const row = findRiderRowById(input.id);
  if (!row) {
    throw new Error("Failed to create rider record");
  }
  return row;
}

export function updateRiderRow(id: string, input: RiderInput): RiderRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE riders SET
        name = ?,
        phone = ?,
        alt_phone = ?,
        company = ?,
        vehicle_description = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(input.name, input.phone, input.altPhone, input.company, input.vehicleDescription, now, id);

  const row = findRiderRowById(id);
  if (!row) {
    throw new Error("Rider not found after update");
  }
  return row;
}

export function setRiderStatusRow(id: string, status: RiderStatus): RiderRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE riders SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(status, now, id);

  const row = findRiderRowById(id);
  if (!row) {
    throw new Error("Rider not found after status update");
  }
  return row;
}

export function mapRiderRow(row: RiderRow): Rider {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    phone: row.phone,
    altPhone: row.alt_phone,
    company: row.company,
    vehicleDescription: row.vehicle_description,
    status: row.status as RiderStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as RiderSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}
