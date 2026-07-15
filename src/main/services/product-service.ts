import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as categoryRepository from "@main/database/repositories/category-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { deleteManagedProductImage } from "@main/services/image-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { productCreateSchema, productUpdateSchema } from "@shared/schemas/product";
import type { Product, ProductListItem, ProductStatus } from "@shared/types/product";

function assertCategoryBelongsToTenant(categoryId: string | null, tenantId: string): void {
  if (!categoryId) return;
  const row = categoryRepository.findCategoryRowById(categoryId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Selected category was not found");
  }
}

/** null means "All Storefronts" — every storefront can see and sell this product. */
function assertStorefrontBelongsToTenant(storefrontId: string | null, tenantId: string): void {
  if (!storefrontId) return;
  const row = locationRepository.findLocationRowById(storefrontId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Selected storefront was not found");
  }
}

function assertUniqueFields(
  tenantId: string,
  fields: { name: string; sku: string; barcode: string | null },
  excludeId?: string
): void {
  if (productRepository.findProductByNameRow(tenantId, fields.name, excludeId)) {
    throw new Error(`A product named "${fields.name}" already exists`);
  }
  if (productRepository.findProductBySkuRow(tenantId, fields.sku, excludeId)) {
    throw new Error(`SKU "${fields.sku}" is already in use`);
  }
  if (fields.barcode && productRepository.findProductByBarcodeRow(tenantId, fields.barcode, excludeId)) {
    throw new Error(`Barcode "${fields.barcode}" is already in use`);
  }
}

export function listProducts(): ProductListItem[] {
  requirePermission("products", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return productRepository
    .findAllProductRows(tenantId, locationId)
    .map(productRepository.mapProductListRow);
}

/**
 * The Main Store's cross-storefront catalog view — unlike listProducts(), this ISN'T restricted to
 * the caller's own assigned branch, since managing stock across every storefront is exactly what the
 * Main Store is for. Pass a specific storefront id to see just its tagged products and its own
 * quantity, or null to see the whole tenant catalog (every storefront tag) with stock summed everywhere.
 */
export function listProductsForStorefront(locationId: string | null): ProductListItem[] {
  requirePermission("inventory", "view");
  const { tenantId } = getCurrentTenant();

  if (locationId) {
    const location = locationRepository.findLocationRowById(locationId);
    if (!location || location.tenant_id !== tenantId) {
      throw new Error("Storefront not found");
    }
  }

  return productRepository.findAllProductRows(tenantId, locationId).map(productRepository.mapProductListRow);
}

export function getProduct(id: string): Product {
  requirePermission("products", "view");
  const row = productRepository.findProductRowById(id);
  if (!row) {
    throw new Error("Product not found");
  }
  return productRepository.mapProductRow(row);
}

export function createProduct(input: unknown): Product {
  requirePermission("products", "create");
  const parsed = productCreateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const performedBy = getCurrentEmployeeId();

  assertCategoryBelongsToTenant(parsed.categoryId, tenantId);
  assertStorefrontBelongsToTenant(parsed.storefrontId, tenantId);
  assertUniqueFields(tenantId, parsed);

  const productId = `product_${randomUUID()}`;

  return runInTransaction(() => {
    const row = productRepository.insertProductRow({
      ...parsed,
      id: productId,
      tenantId,
      createdBy: performedBy
    });

    for (const entry of parsed.openingStock) {
      if (entry.quantity <= 0) continue;
      applyValidatedStockMovement(
        {
          productId,
          locationId: entry.locationId,
          movementType: "opening_stock",
          quantityChange: entry.quantity,
          referenceType: "product_creation",
          referenceId: productId,
          performedBy,
          notes: null
        },
        tenantId
      );
    }

    return productRepository.mapProductRow(row);
  });
}

export function updateProduct(id: string, input: unknown): Product {
  requirePermission("products", "edit");
  const parsed = productUpdateSchema.parse(input);
  const existing = productRepository.findProductRowById(id);
  if (!existing) {
    throw new Error("Product not found");
  }

  const { tenantId } = getCurrentTenant();
  assertCategoryBelongsToTenant(parsed.categoryId, tenantId);
  assertStorefrontBelongsToTenant(parsed.storefrontId, tenantId);
  assertUniqueFields(tenantId, parsed, id);

  const row = productRepository.updateProductRow(id, { ...parsed, updatedBy: getCurrentEmployeeId() });

  if (existing.image_path && existing.image_path !== parsed.imagePath) {
    deleteManagedProductImage(existing.image_path);
  }

  return productRepository.mapProductRow(row);
}

export function setProductStatus(id: string, status: ProductStatus): Product {
  requirePermission("products", "edit");
  const row = productRepository.setProductStatusRow(id, status);
  return productRepository.mapProductRow(row);
}
