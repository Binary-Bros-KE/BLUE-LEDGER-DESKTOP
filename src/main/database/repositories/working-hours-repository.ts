import { randomUUID } from "node:crypto";
import { getDatabase } from "@main/database/connection";
import type { WorkingHoursInput } from "@shared/schemas/working-hours";
import type { WorkingHours, WorkingHoursSchedule, WorkingHoursSyncStatus } from "@shared/types/working-hours";

export type WorkingHoursRow = {
  id: string;
  tenant_id: string;
  location_id: string;
  lock_enabled: number;
  lock_mode: string;
  manually_locked: number;
  timezone_offset_minutes: number;
  schedule_json: string;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

export function findAllWorkingHoursRows(tenantId: string): WorkingHoursRow[] {
  return getDatabase().prepare("SELECT * FROM working_hours WHERE tenant_id = ?").all(tenantId) as WorkingHoursRow[];
}

export function findWorkingHoursRowById(id: string): WorkingHoursRow | undefined {
  return getDatabase().prepare("SELECT * FROM working_hours WHERE id = ?").get(id) as WorkingHoursRow | undefined;
}

export function findWorkingHoursRowByLocationId(tenantId: string, locationId: string): WorkingHoursRow | undefined {
  return getDatabase().prepare("SELECT * FROM working_hours WHERE tenant_id = ? AND location_id = ?").get(tenantId, locationId) as
    | WorkingHoursRow
    | undefined;
}

export function insertWorkingHoursRow(tenantId: string, locationId: string, input: WorkingHoursInput): WorkingHoursRow {
  const now = new Date().toISOString();
  const id = `working_hours_${randomUUID()}`;

  getDatabase()
    .prepare(
      `
      INSERT INTO working_hours (
        id, tenant_id, location_id, lock_enabled, lock_mode, manually_locked,
        timezone_offset_minutes, schedule_json, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      id,
      tenantId,
      locationId,
      input.lockEnabled ? 1 : 0,
      input.lockMode,
      input.manuallyLocked ? 1 : 0,
      input.timezoneOffsetMinutes,
      JSON.stringify(input.schedule),
      now,
      now
    );

  const row = findWorkingHoursRowByLocationId(tenantId, locationId);
  if (!row) {
    throw new Error("Failed to create working hours record");
  }
  return row;
}

export function updateWorkingHoursRow(id: string, input: WorkingHoursInput): WorkingHoursRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE working_hours SET
        lock_enabled = ?,
        lock_mode = ?,
        manually_locked = ?,
        timezone_offset_minutes = ?,
        schedule_json = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(input.lockEnabled ? 1 : 0, input.lockMode, input.manuallyLocked ? 1 : 0, input.timezoneOffsetMinutes, JSON.stringify(input.schedule), now, id);

  const row = findWorkingHoursRowById(id);
  if (!row) {
    throw new Error("Working hours record not found after update");
  }
  return row;
}

/** The one-tap emergency lock/unlock — a lightweight sibling to the full update above. */
export function setWorkingHoursManualLockRow(id: string, manuallyLocked: boolean): WorkingHoursRow {
  const now = new Date().toISOString();
  getDatabase()
    .prepare("UPDATE working_hours SET manually_locked = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(manuallyLocked ? 1 : 0, now, id);

  const row = findWorkingHoursRowById(id);
  if (!row) {
    throw new Error("Working hours record not found after update");
  }
  return row;
}

function parseSchedule(json: string): WorkingHoursSchedule {
  try {
    return JSON.parse(json) as WorkingHoursSchedule;
  } catch {
    return {};
  }
}

export function mapWorkingHoursRow(row: WorkingHoursRow): WorkingHours {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    locationId: row.location_id,
    lockEnabled: Boolean(row.lock_enabled),
    lockMode: row.lock_mode as WorkingHours["lockMode"],
    manuallyLocked: Boolean(row.manually_locked),
    timezoneOffsetMinutes: row.timezone_offset_minutes,
    schedule: parseSchedule(row.schedule_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as WorkingHoursSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}
