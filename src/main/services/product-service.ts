import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as categoryRepository from "@main/database/repositories/category-repository";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { deleteManagedProductImage } from "@main/services/image-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { deriveUnallocatedQuantity } from "@main/services/main-store-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { bulkSetTaxTypeSchema, productCreateSchema, productUpdateSchema } from "@shared/schemas/product";
import type { Product, ProductListItem, ProductStatus, ProductStockSummary } from "@shared/types/product";

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

/** A branch-scoped caller (a Manager) can only ever create a product for THEIR OWN storefront —
 * never "All Storefronts" (null, which shows it to every other branch too) and never a different
 * one. Only Super Admin (no branch assigned) can pick freely.
 *
 * NOT applied for a quick-create (see productCreateSchema's own isQuickCreate doc comment) — a
 * branch-scoped cashier/manager routinely needs to add a product Products has never seen before
 * right in the middle of building a Purchase/Invoice/Quotation/Borrow/Goods-Received, and this
 * check used to reject that outright (storefrontId comes back null from that mini form, which
 * never matches a real branchScope), the exact bug several real clients hit. A product created that
 * way is for every storefront by default instead — the deliberate, requested behavior, not just an
 * exemption from the restriction above. */
function assertProductStorefrontCreateAllowed(storefrontId: string | null, branchScope: string | null): void {
  if (!branchScope) return;
  if (storefrontId !== branchScope) {
    throw new Error("You can only create products for your own storefront");
  }
}

/** Same boundary for edits — a Manager can leave an existing product's storefront assignment
 * exactly as-is (even "All Storefronts", if a Super Admin set it that way), but can't reassign it to
 * anything other than their own branch. */
function assertProductStorefrontUpdateAllowed(
  nextStorefrontId: string | null,
  existingStorefrontId: string | null,
  branchScope: string | null
): void {
  if (!branchScope) return;
  if (nextStorefrontId === existingStorefrontId) return;
  if (nextStorefrontId !== branchScope) {
    throw new Error("You can only assign products to your own storefront");
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

/**
 * Pass a storefrontId to slice the catalog down to just that storefront's ACTUALLY STOCKED products
 * (a real inventory row at that location — the same membership test the Inventory Report's own
 * per-location sections use), with totalStock reflecting only that storefront's own quantity — used
 * by the Products tab's storefront filter. Only meaningful for a caller with full multi-storefront
 * visibility (no branch scope, typically Super Admin): a branch-scoped caller (e.g. a storefront
 * Manager) is always locked to their own storefront regardless of what's passed, same as before this
 * parameter existed — and that automatic restriction deliberately stays on the older, more lenient
 * "sellable here" test (storefront tag, or untagged) so Checkout/Invoices/Quotations keep showing a
 * product the moment it's created, before any stock has physically been distributed to it.
 */
export function listProducts(storefrontId?: string | null): ProductListItem[] {
  requirePermission("products", "view");
  const { tenantId } = getCurrentTenant();
  const branchScope = getCurrentBranchScope();
  const requestedLocationId = storefrontId ?? null;
  if (!branchScope && requestedLocationId) {
    const location = locationRepository.findLocationRowById(requestedLocationId);
    if (!location || location.tenant_id !== tenantId) {
      throw new Error("Storefront not found");
    }
  }
  const locationId = branchScope ?? requestedLocationId;
  const requireInventoryRow = !branchScope && requestedLocationId !== null;
  return productRepository
    .findAllProductRows(tenantId, locationId, requireInventoryRow)
    .map(productRepository.mapProductListRow);
}

/** Just two numbers — this location's own stock and Main Store's — for a quick "do we have it, can
 * we get more" check from the Products list or Checkout. Deliberately not a per-storefront
 * breakdown (that's the Main Store screen's job, and requires "inventory" permission); this only
 * needs "products:view" so every role that can browse the catalog can use it. */
export function getProductStockSummary(productId: string): ProductStockSummary {
  requirePermission("products", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  const mainStore = locationRepository.findMainStoreLocationRow(tenantId);

  const ownLocation = locationId ? locationRepository.findLocationRowById(locationId) : undefined;
  const ownLocationQuantity = locationId
    ? (inventoryRepository.findInventoryRow(productId, locationId)?.quantity ?? 0)
    : null;
  const mainStoreQuantity = mainStore
    ? (inventoryRepository.findInventoryRow(productId, mainStore.id)?.quantity ?? 0)
    : 0;
  // Derived, not read from a stored bucket — see main-store-service.ts's deriveUnallocatedQuantity
  // doc comment for why "unallocated" is never its own independently-synced fact any more (migration
  // 77 removed the storefront_id IS NULL row this used to read directly).
  const mainStoreUnallocatedQuantity = mainStore ? deriveUnallocatedQuantity(productId, mainStore.id) : 0;

  return {
    ownLocationName: ownLocation?.location_name ?? null,
    ownLocationQuantity,
    mainStoreQuantity,
    mainStoreUnallocatedQuantity
  };
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

/** A branch-scoped caller (i.e. not Super Admin) may only seed opening stock into their own
 * storefront or the Main Store — never another storefront they don't manage. Unrestricted callers
 * (null scope) can target anything, same as every other branch-scoped read/write in this app. */
function assertOpeningStockLocationsAllowed(
  entries: Array<{ locationId: string }>,
  tenantId: string,
  branchScope: string | null
): void {
  if (!branchScope || entries.length === 0) return;
  const mainStore = locationRepository.findMainStoreLocationRow(tenantId);
  for (const entry of entries) {
    if (entry.locationId === branchScope) continue;
    if (mainStore && entry.locationId === mainStore.id) continue;
    throw new Error("You can only set opening stock for your own storefront or Main Store");
  }
}

/** A peek at the next auto-generated SKU (e.g. "PROD-000042") — used to prefill the Create Product
 * form so nobody has to track the latest number by hand as the catalog grows into the thousands. The
 * form field stays a normal editable text input, so a tenant with their own existing SKU scheme can
 * still override it. */
export function nextProductSku(): string {
  requirePermission("products", "create");
  const { tenantId } = getCurrentTenant();
  return generateDocumentNumber({
    tenantId,
    prefix: "PROD",
    digits: 6,
    existingNumbers: productRepository.findMaxProductSkuNumberRow(tenantId)
  });
}

export function createProduct(input: unknown): Product {
  requirePermission("products", "create");
  const parsed = productCreateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const performedBy = getCurrentEmployeeId();
  const branchScope = getCurrentBranchScope();

  // See productCreateSchema's own isQuickCreate doc comment and assertProductStorefrontCreateAllowed's
  // — a quick-created product is for every storefront by default, so storefrontId is forced to null
  // (defensive: the quick-create form never actually sends one) and the branch-scoped restriction
  // that would otherwise reject that null outright never runs.
  if (parsed.isQuickCreate) {
    parsed.storefrontId = null;
  } else {
    assertProductStorefrontCreateAllowed(parsed.storefrontId, branchScope);
  }
  assertCategoryBelongsToTenant(parsed.categoryId, tenantId);
  assertStorefrontBelongsToTenant(parsed.storefrontId, tenantId);
  assertUniqueFields(tenantId, parsed);
  assertOpeningStockLocationsAllowed(parsed.openingStock, tenantId, branchScope);

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
          notes: null,
          allocationStorefrontId: entry.allocationStorefrontId ?? null
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
  assertProductStorefrontUpdateAllowed(parsed.storefrontId, existing.storefront_id, getCurrentBranchScope());
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

/** Bulk tax-category backfill — built for a tenant onboarded before tax categories existed, whose
 * whole catalog needs re-classifying at once. Not scoped to the caller's own branch (unlike most
 * product actions) — tax classification is a catalog-wide business decision, not a per-storefront
 * one, same as every other product field. */
export function bulkSetProductTaxType(input: unknown): { updatedCount: number } {
  requirePermission("products", "edit");
  const parsed = bulkSetTaxTypeSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const updatedCount = productRepository.bulkSetTaxTypeRows(tenantId, parsed.productIds, parsed.taxType);
  return { updatedCount };
}
