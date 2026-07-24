import { getDatabase } from "@main/database/connection";
import type { CategoryCreateInput, CategoryUpdateInput } from "@shared/schemas/category";
import type { Category, CategoryLevel, CategoryStatus, CategorySyncStatus } from "@shared/types/category";

export type CategoryRow = {
  id: string;
  tenant_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  color: string;
  level: number;
  sort_order: number;
  status: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

export function findAllCategoryRows(tenantId: string): CategoryRow[] {
  return getDatabase()
    .prepare("SELECT * FROM categories WHERE tenant_id = ? ORDER BY level ASC, sort_order ASC, name ASC")
    .all(tenantId) as CategoryRow[];
}

export function findCategoryRowById(id: string): CategoryRow | undefined {
  return getDatabase().prepare("SELECT * FROM categories WHERE id = ?").get(id) as
    | CategoryRow
    | undefined;
}

/** Every category (any level/parent) tenant-wide whose name matches case-insensitively — used by
 * bulk Import to resolve a plain category name typed in a spreadsheet cell. Deliberately NOT scoped
 * to one parent: names are only guaranteed unique among siblings (see findSiblingCategoryRow), so
 * the caller must handle 0/1/2+ matches itself rather than this function guessing for it. */
export function findCategoryRowsByName(tenantId: string, name: string): CategoryRow[] {
  return getDatabase()
    .prepare(
      "SELECT * FROM categories WHERE tenant_id = ? AND lower(name) = lower(?) ORDER BY level ASC, sort_order ASC"
    )
    .all(tenantId, name) as CategoryRow[];
}

export function findSiblingCategoryRow(
  tenantId: string,
  parentId: string | null,
  name: string,
  excludeId?: string
): CategoryRow | undefined {
  const db = getDatabase();
  const parentClause = parentId === null ? "parent_id IS NULL" : "parent_id = ?";
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params: (string | null)[] = [tenantId];
  if (parentId !== null) params.push(parentId);
  params.push(name);
  if (excludeId) params.push(excludeId);

  return db
    .prepare(
      `SELECT * FROM categories WHERE tenant_id = ? AND ${parentClause} AND lower(name) = lower(?) ${excludeClause}`
    )
    .get(...params) as CategoryRow | undefined;
}

export function countChildCategoryRows(id: string): number {
  const row = getDatabase()
    .prepare("SELECT COUNT(*) as count FROM categories WHERE parent_id = ?")
    .get(id) as { count: number };
  return row.count;
}

export function insertCategoryRow(
  input: CategoryCreateInput & {
    id: string;
    tenantId: string;
    level: CategoryLevel;
    createdBy: string | null;
  }
): CategoryRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO categories (
        id, tenant_id, parent_id, name, description, color, level,
        sort_order, status, created_at, updated_at, created_by, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.parentId,
      input.name,
      input.description,
      input.color,
      input.level,
      input.sortOrder,
      now,
      now,
      input.createdBy
    );

  const row = findCategoryRowById(input.id);
  if (!row) {
    throw new Error("Failed to create category record");
  }
  return row;
}

export function updateCategoryRow(
  id: string,
  input: CategoryUpdateInput & { updatedBy: string | null }
): CategoryRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE categories SET
        name = ?,
        description = ?,
        color = ?,
        sort_order = ?,
        updated_by = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(input.name, input.description, input.color, input.sortOrder, input.updatedBy, now, id);

  const row = findCategoryRowById(id);
  if (!row) {
    throw new Error("Category not found after update");
  }
  return row;
}

export function setCategoryStatusRow(id: string, status: CategoryStatus): CategoryRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE categories SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(status, now, id);

  const row = findCategoryRowById(id);
  if (!row) {
    throw new Error("Category not found after status update");
  }
  return row;
}

export function deleteCategoryRow(id: string): void {
  getDatabase().prepare("DELETE FROM categories WHERE id = ?").run(id);
}

export function mapCategoryRow(row: CategoryRow): Category {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    parentId: row.parent_id,
    name: row.name,
    description: row.description,
    color: row.color,
    level: row.level as CategoryLevel,
    sortOrder: row.sort_order,
    status: row.status as CategoryStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    syncStatus: row.sync_status as CategorySyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}
