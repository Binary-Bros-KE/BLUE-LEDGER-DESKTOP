import { getDatabase } from "@main/database/connection";
import type { PermissionsMap, Role, RoleListItem, RoleSyncStatus } from "@shared/types/role";

export type RoleRow = {
  id: string;
  tenant_id: string;
  role_name: string;
  description: string | null;
  permissions_json: string;
  is_system_role: number;
  is_super_admin: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

export type RoleListRow = RoleRow & {
  employee_count: number;
};

export function findAllRoleRows(tenantId: string): RoleRow[] {
  return getDatabase()
    .prepare("SELECT * FROM roles WHERE tenant_id = ? ORDER BY is_system_role DESC, role_name ASC")
    .all(tenantId) as RoleRow[];
}

export function findAllRoleListRows(tenantId: string): RoleListRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT r.*, COUNT(e.id) AS employee_count
      FROM roles r
      LEFT JOIN employees e ON e.role_id = r.id
      WHERE r.tenant_id = ?
      GROUP BY r.id
      ORDER BY r.is_system_role DESC, r.role_name ASC
    `
    )
    .all(tenantId) as RoleListRow[];
}

export function findRoleRowById(id: string): RoleRow | undefined {
  return getDatabase().prepare("SELECT * FROM roles WHERE id = ?").get(id) as RoleRow | undefined;
}

export function findRoleByNameRow(
  tenantId: string,
  roleName: string,
  excludeId?: string
): RoleRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId ? [tenantId, roleName, excludeId] : [tenantId, roleName];
  return getDatabase()
    .prepare(`SELECT * FROM roles WHERE tenant_id = ? AND lower(role_name) = lower(?) ${excludeClause}`)
    .get(...params) as RoleRow | undefined;
}

export function insertRoleRow(input: {
  id: string;
  tenantId: string;
  roleName: string;
  description: string | null;
  permissions: PermissionsMap;
  isSystemRole: boolean;
  isSuperAdmin?: boolean | undefined;
  createdBy: string | null;
}): RoleRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO roles (id, tenant_id, role_name, description, permissions_json, is_system_role, is_super_admin, created_at, updated_at, created_by, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.roleName,
      input.description,
      JSON.stringify(input.permissions),
      input.isSystemRole ? 1 : 0,
      input.isSuperAdmin ? 1 : 0,
      now,
      now,
      input.createdBy
    );

  const row = findRoleRowById(input.id);
  if (!row) {
    throw new Error("Failed to create role record");
  }
  return row;
}

/** Dedicated, narrow setter — deliberately NOT part of updateRoleRow's general input shape, since
 * this flag must never be reachable from the user-facing Roles & Permissions form (createRole/
 * updateRole). Only role-service.ts's ensureSuperAdminFlag calls this. */
export function setRoleSuperAdminFlagRow(id: string, isSuperAdmin: boolean): RoleRow {
  const now = new Date().toISOString();
  getDatabase()
    .prepare("UPDATE roles SET is_super_admin = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(isSuperAdmin ? 1 : 0, now, id);

  const row = findRoleRowById(id);
  if (!row) {
    throw new Error("Role not found after update");
  }
  return row;
}

export function updateRoleRow(
  id: string,
  input: {
    roleName: string;
    description: string | null;
    permissions: PermissionsMap;
    updatedBy: string | null;
  }
): RoleRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE roles SET
        role_name = ?,
        description = ?,
        permissions_json = ?,
        updated_by = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(input.roleName, input.description, JSON.stringify(input.permissions), input.updatedBy, now, id);

  const row = findRoleRowById(id);
  if (!row) {
    throw new Error("Role not found after update");
  }
  return row;
}

export function deleteRoleRow(id: string): void {
  getDatabase().prepare("DELETE FROM roles WHERE id = ?").run(id);
}

function parsePermissions(json: string): PermissionsMap {
  try {
    return JSON.parse(json) as PermissionsMap;
  } catch {
    return {};
  }
}

export function mapRoleRow(row: RoleRow): Role {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    roleName: row.role_name,
    description: row.description,
    permissions: parsePermissions(row.permissions_json),
    isSystemRole: Boolean(row.is_system_role),
    isSuperAdmin: Boolean(row.is_super_admin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    syncStatus: row.sync_status as RoleSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

export function mapRoleListRow(row: RoleListRow): RoleListItem {
  return {
    ...mapRoleRow(row),
    employeeCount: row.employee_count
  };
}
