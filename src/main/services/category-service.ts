import { randomUUID } from "node:crypto";
import * as categoryRepository from "@main/database/repositories/category-repository";
import { getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { categoryCreateSchema, categoryUpdateSchema } from "@shared/schemas/category";
import type { Category, CategoryLevel, CategoryStatus } from "@shared/types/category";

const MAX_CATEGORY_LEVEL = 3;

export function listCategories(): Category[] {
  requirePermission("categories", "view");
  const { tenantId } = getCurrentTenant();
  return categoryRepository.findAllCategoryRows(tenantId).map(categoryRepository.mapCategoryRow);
}

export function getCategory(id: string): Category {
  requirePermission("categories", "view");
  const row = categoryRepository.findCategoryRowById(id);
  if (!row) {
    throw new Error("Category not found");
  }
  return categoryRepository.mapCategoryRow(row);
}

export function createCategory(input: unknown): Category {
  requirePermission("categories", "create");
  const parsed = categoryCreateSchema.parse(input);
  const { tenantId } = getCurrentTenant();

  let level: CategoryLevel = 1;
  if (parsed.parentId) {
    const parentRow = categoryRepository.findCategoryRowById(parsed.parentId);
    if (!parentRow || parentRow.tenant_id !== tenantId) {
      throw new Error("Parent category not found");
    }
    if (parentRow.level >= MAX_CATEGORY_LEVEL) {
      throw new Error("Categories only support 3 levels — this category can't hold subcategories");
    }
    level = (parentRow.level + 1) as CategoryLevel;
  }

  const duplicate = categoryRepository.findSiblingCategoryRow(tenantId, parsed.parentId, parsed.name);
  if (duplicate) {
    throw new Error(`A category named "${parsed.name}" already exists at this level`);
  }

  const row = categoryRepository.insertCategoryRow({
    ...parsed,
    id: `category_${randomUUID()}`,
    tenantId,
    level,
    createdBy: getCurrentEmployeeId()
  });
  return categoryRepository.mapCategoryRow(row);
}

export function updateCategory(id: string, input: unknown): Category {
  requirePermission("categories", "edit");
  const parsed = categoryUpdateSchema.parse(input);
  const existing = categoryRepository.findCategoryRowById(id);
  if (!existing) {
    throw new Error("Category not found");
  }

  const duplicate = categoryRepository.findSiblingCategoryRow(
    existing.tenant_id,
    existing.parent_id,
    parsed.name,
    id
  );
  if (duplicate) {
    throw new Error(`A category named "${parsed.name}" already exists at this level`);
  }

  const row = categoryRepository.updateCategoryRow(id, { ...parsed, updatedBy: getCurrentEmployeeId() });
  return categoryRepository.mapCategoryRow(row);
}

export function setCategoryStatus(id: string, status: CategoryStatus): Category {
  requirePermission("categories", "edit");
  const row = categoryRepository.setCategoryStatusRow(id, status);
  return categoryRepository.mapCategoryRow(row);
}

export function deleteCategory(id: string): { id: string } {
  requirePermission("categories", "delete");
  const childCount = categoryRepository.countChildCategoryRows(id);
  if (childCount > 0) {
    throw new Error("Delete or move its subcategories before deleting this category");
  }
  categoryRepository.deleteCategoryRow(id);
  return { id };
}
