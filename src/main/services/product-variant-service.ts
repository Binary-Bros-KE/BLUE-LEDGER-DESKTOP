import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as mainStoreAllocationRepository from "@main/database/repositories/main-store-allocation-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import type { ProductRow } from "@main/database/repositories/product-repository";
import { getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { sameVariantValues, variantLabel } from "@shared/lib/variants";
import {
  mergeIntoSharedVariantsSchema,
  saveSeparateVariantsSchema,
  saveSharedVariantsSchema
} from "@shared/schemas/product-variant";
import type { ProductVariantConfig, SharedVariant, VariantGroupView, VariantOption } from "@shared/types/product";

// Variants (docs/VARIANTS.md). Two stock modes, chosen per product:
//  - "shared":   ONE product, ONE stock. The variants (price override, own SKU/barcode) live inside
//                its variant_config_json. Selling a variant deducts the product's own stock — no
//                stock code knows variants exist.
//  - "separate": each variant is its OWN product (own stock, price, SKU, barcode). They're tied
//                together by variant_group_id = the main product's id (the main product included,
//                so it is itself one of the variants), and the main product carries the config
//                (options + title) with an empty variants list.
// Neither mode changes how stock moves. Grouping existing products into shared stock ("merge") is
// the one place stock moves here, and it goes through the normal ledger (adjustment movements).

function loadOwned(id: string, tenantId: string): ProductRow {
  const row = productRepository.findProductRowById(id);
  if (!row || row.tenant_id !== tenantId) throw new Error("Product not found");
  return row;
}

/** The main product of the separate-stock group this product belongs to — itself when it's the
 * main product, or not in a group (or its main product no longer exists on this device). */
function resolveMain(row: ProductRow, tenantId: string): ProductRow {
  if (row.variant_group_id && row.variant_group_id !== row.id) {
    const main = productRepository.findProductRowById(row.variant_group_id);
    if (main && main.tenant_id === tenantId) return main;
  }
  return row;
}

function configOf(row: ProductRow): ProductVariantConfig | null {
  return productRepository.parseVariantConfigJson(row.variant_config_json);
}

function buildView(main: ProductRow, tenantId: string): VariantGroupView {
  const product = productRepository.mapProductRow(main);
  const config = product.variantConfig;
  const mainTotal = productRepository.findProductListRowById(main.id)?.total_stock ?? 0;
  const members =
    config?.mode === "separate"
      ? productRepository
          .findVariantGroupMemberRows(tenantId, main.id)
          .map((r) => {
            const p = productRepository.mapProductListRow(r);
            return {
              productId: p.id,
              name: p.name,
              sku: p.sku,
              barcode: p.barcode,
              sellingPriceCents: p.sellingPriceCents,
              status: p.status,
              totalStock: p.totalStock,
              values: p.variantOptions,
              isMain: p.id === main.id
            };
          })
          .sort((a, b) => Number(b.isMain) - Number(a.isMain))
      : [];
  return {
    mainProductId: main.id,
    mainName: product.name,
    mainSku: product.sku,
    mainBarcode: product.barcode,
    mainPriceCents: product.sellingPriceCents,
    mainTotalStock: mainTotal,
    mode: config?.mode ?? null,
    title: config?.title ?? null,
    options: config?.options ?? [],
    members,
    variants: config?.mode === "shared" ? config.variants : []
  };
}

export function getVariantGroup(productId: string): VariantGroupView {
  requirePermission("products", "view");
  const { tenantId } = getCurrentTenant();
  return buildView(resolveMain(loadOwned(productId, tenantId), tenantId), tenantId);
}

// ------------------------------------------------------------------------------------------ rules

function assertValuesMatchOptions(options: VariantOption[], values: Record<string, string>, label: string): void {
  for (const option of options) {
    const value = values[option.name];
    if (!value) throw new Error(`${label}: choose a ${option.name}`);
    if (!option.values.includes(value)) throw new Error(`${label}: "${value}" isn't one of the ${option.name} values`);
  }
  if (Object.keys(values).length !== options.length) {
    throw new Error(`${label}: has a value for an option that doesn't exist`);
  }
}

function assertNoDuplicateCombos(options: VariantOption[], list: Array<Record<string, string>>): void {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (sameVariantValues(list[i]!, list[j]!)) {
        throw new Error(`"${variantLabel(options, list[i]!)}" is listed twice — each variant needs a different combination`);
      }
    }
  }
}

/** Who already uses this SKU/barcode as a SHARED variant code — "<product name>" or null.
 * `excludeProductId` skips that product's own variants (the ones being replaced). Also used by
 * product-service.ts so a new/edited product can't take a code a variant already has. */
export function findSharedVariantCodeOwner(
  tenantId: string,
  kind: "sku" | "barcode",
  code: string,
  excludeProductId?: string
): string | null {
  const wanted = code.trim().toLowerCase();
  if (!wanted) return null;
  for (const row of productRepository.findProductsWithVariantConfigRows(tenantId)) {
    if (row.id === excludeProductId) continue;
    const config = productRepository.parseVariantConfigJson(row.variant_config_json);
    if (config?.mode !== "shared") continue;
    if (config.variants.some((v) => (v[kind] ?? "").trim().toLowerCase() === wanted)) return row.name;
  }
  return null;
}

/** A code must be free across products (any status — a deactivated product can come back) and
 * across every other product's shared variants. */
function assertCodeFree(
  tenantId: string,
  kind: "sku" | "barcode",
  code: string,
  opts: { exceptProductId?: string | undefined; exceptSharedOf?: string | undefined }
): void {
  const productOwner =
    kind === "sku"
      ? productRepository.findProductBySkuRow(tenantId, code, opts.exceptProductId)
      : productRepository.findProductByBarcodeRow(tenantId, code, opts.exceptProductId);
  const label = kind === "sku" ? "SKU" : "Barcode";
  if (productOwner) throw new Error(`${label} "${code}" is already used by "${productOwner.name}"`);
  const variantOwner = findSharedVariantCodeOwner(tenantId, kind, code, opts.exceptSharedOf);
  if (variantOwner) throw new Error(`${label} "${code}" is already used by a variant of "${variantOwner}"`);
}

function assertUniqueWithin(codes: Array<string | null>, label: string): void {
  const seen = new Set<string>();
  for (const code of codes) {
    if (!code) continue;
    const key = code.toLowerCase();
    if (seen.has(key)) throw new Error(`${label} "${code}" is used by two variants`);
    seen.add(key);
  }
}

function newVariantKey(): string {
  return `v_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

// ------------------------------------------------------------------------------------ shared mode

/** Create or replace a product's SHARED-stock variants. The product's stock is untouched. */
export function saveSharedVariants(input: unknown): VariantGroupView {
  requirePermission("products", "edit");
  const parsed = saveSharedVariantsSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const row = loadOwned(parsed.productId, tenantId);

  if (row.variant_group_id) {
    throw new Error("This product is part of a separate-stock variant group. Remove it from that group first.");
  }
  if (configOf(row)?.mode === "separate") {
    throw new Error("This product's variants use separate stock. Remove its variants first to switch to shared stock.");
  }

  for (const v of parsed.variants) assertValuesMatchOptions(parsed.options, v.values, "A variant");
  assertNoDuplicateCombos(parsed.options, parsed.variants.map((v) => v.values));
  assertUniqueWithin(parsed.variants.map((v) => v.sku), "SKU");
  assertUniqueWithin(parsed.variants.map((v) => v.barcode), "Barcode");
  for (const v of parsed.variants) {
    // Not even the product's own SKU/barcode — scanning must land on exactly one thing.
    if (v.sku) assertCodeFree(tenantId, "sku", v.sku, { exceptSharedOf: row.id });
    if (v.barcode) assertCodeFree(tenantId, "barcode", v.barcode, { exceptSharedOf: row.id });
  }

  const usedKeys = new Set<string>();
  const variants: SharedVariant[] = parsed.variants.map((v) => {
    const key = v.key && !usedKeys.has(v.key) ? v.key : newVariantKey();
    usedKeys.add(key);
    return {
      key,
      values: v.values,
      priceCents: v.priceCents,
      sku: v.sku,
      barcode: v.barcode,
      active: v.active
    };
  });

  productRepository.patchProductVariantRow(row.id, {
    variantConfig: { mode: "shared", title: parsed.title, options: parsed.options, variants }
  });
  // re-read: `row` is the pre-write snapshot
  return buildView(loadOwned(row.id, tenantId), tenantId);
}

// ---------------------------------------------------------------------------------- separate mode

/** Create or replace a SEPARATE-stock group: link existing products, create new ones (a copy of the
 * main product with its own name/SKU/price/barcode and zero stock), and unlink any left out. */
export function saveSeparateVariants(input: unknown): VariantGroupView {
  requirePermission("products", "edit");
  const parsed = saveSeparateVariantsSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const createdBy = getCurrentEmployeeId();
  const main = loadOwned(parsed.productId, tenantId);

  if (main.variant_group_id && main.variant_group_id !== main.id) {
    throw new Error("Open the group's main product to change its variants");
  }
  if (configOf(main)?.mode === "shared") {
    throw new Error("This product's variants share one stock. Remove its variants first to switch to separate stock.");
  }
  if (parsed.members.filter((m) => m.productId === main.id).length !== 1) {
    throw new Error("The main product must be one of the variants");
  }
  if (parsed.members.some((m) => m.productId === null)) {
    requirePermission("products", "create");
  }

  const ids = parsed.members.flatMap((m) => (m.productId ? [m.productId] : []));
  if (new Set(ids).size !== ids.length) throw new Error("A product is listed twice");

  const existing = new Map<string, ProductRow>();
  for (const id of ids) {
    const row = loadOwned(id, tenantId);
    if (row.id !== main.id) {
      if (row.variant_group_id && row.variant_group_id !== main.id) {
        throw new Error(`"${row.name}" already belongs to another variant group`);
      }
      if (configOf(row)) throw new Error(`"${row.name}" has variants of its own — remove them first`);
    }
    existing.set(id, row);
  }

  for (const m of parsed.members) {
    const name = m.productId ? existing.get(m.productId)!.name : "A new variant";
    assertValuesMatchOptions(parsed.options, m.values, name);
  }
  assertNoDuplicateCombos(parsed.options, parsed.members.map((m) => m.values));
  assertUniqueWithin(parsed.members.map((m) => m.barcode), "Barcode");
  for (const m of parsed.members) {
    if (m.barcode) assertCodeFree(tenantId, "barcode", m.barcode, { exceptProductId: m.productId ?? undefined });
    if (m.productId) {
      const row = existing.get(m.productId)!;
      if (row.minimum_price_cents !== null && m.sellingPriceCents < row.minimum_price_cents) {
        throw new Error(`"${row.name}": price can't be below its minimum price`);
      }
    }
  }

  // New products: names + SKUs decided up front so every clash is reported before anything writes.
  const baseName = parsed.title ?? main.name;
  const skuPool = productRepository.findMaxProductSkuNumberRow(tenantId);
  const plannedNames = new Set<string>();
  const creations = parsed.members
    .filter((m) => m.productId === null)
    .map((m) => {
      const name = m.name?.trim() || `${baseName} - ${variantLabel(parsed.options, m.values)}`;
      const lower = name.toLowerCase();
      if (plannedNames.has(lower) || productRepository.findProductByNameRow(tenantId, name)) {
        throw new Error(`A product named "${name}" already exists — give this variant a different name`);
      }
      plannedNames.add(lower);
      const sku = generateDocumentNumber({ tenantId, prefix: "PROD", digits: 6, existingNumbers: skuPool });
      skuPool.push(sku);
      return { member: m, name, sku };
    });

  runInTransaction(() => {
    const keep = new Set(ids);
    for (const old of productRepository.findVariantGroupMemberRows(tenantId, main.id)) {
      if (!keep.has(old.id)) {
        productRepository.patchProductVariantRow(old.id, { variantGroupId: null, variantOptions: {} });
      }
    }

    for (const m of parsed.members) {
      if (!m.productId) continue;
      const row = existing.get(m.productId)!;
      productRepository.patchProductVariantRow(row.id, {
        variantGroupId: main.id,
        variantOptions: m.values,
        ...(row.selling_price_cents !== m.sellingPriceCents ? { sellingPriceCents: m.sellingPriceCents } : {}),
        ...(row.barcode !== m.barcode ? { barcode: m.barcode } : {}),
        ...(row.id === main.id
          ? { variantConfig: { mode: "separate" as const, title: parsed.title, options: parsed.options, variants: [] } }
          : {})
      });
    }

    const template = productRepository.mapProductRow(main);
    for (const c of creations) {
      const id = `product_${randomUUID()}`;
      productRepository.insertProductRow({
        id,
        tenantId,
        createdBy,
        sku: c.sku,
        barcode: c.member.barcode,
        supplierSku: null,
        name: c.name,
        shortName: null,
        description: template.description,
        categoryId: template.categoryId,
        storefrontId: template.storefrontId,
        unitOfMeasure: template.unitOfMeasure,
        buyingPriceCents: template.buyingPriceCents,
        sellingPriceCents: c.member.sellingPriceCents,
        wholesalePriceCents: template.wholesalePriceCents,
        wholesaleMinQuantity: template.wholesaleMinQuantity,
        minimumPriceCents:
          template.minimumPriceCents !== null && template.minimumPriceCents <= c.member.sellingPriceCents
            ? template.minimumPriceCents
            : null,
        taxRate: template.taxRate,
        taxType: template.taxType,
        pricesTaxInclusive: template.pricesTaxInclusive,
        reorderLevel: template.reorderLevel,
        trackStock: template.trackStock,
        allowNegativeStock: template.allowNegativeStock,
        // never share the main product's image FILE — editing one product's photo deletes its old file
        imagePath: null,
        brand: template.brand,
        openingStock: [],
        isQuickCreate: false
      });
      productRepository.patchProductVariantRow(id, { variantGroupId: main.id, variantOptions: c.member.values });
    }
  });

  return buildView(loadOwned(main.id, tenantId), tenantId);
}

// ---------------------------------------------------------------------------------------- dissolve

/** Remove a product's variants. Shared: the variants are dropped (past sales keep their labels).
 * Separate: every product stays as it is — just no longer grouped. Stock is never touched. */
export function removeVariants(productId: string): VariantGroupView {
  requirePermission("products", "edit");
  const { tenantId } = getCurrentTenant();
  const main = resolveMain(loadOwned(productId, tenantId), tenantId);
  runInTransaction(() => {
    for (const member of productRepository.findVariantGroupMemberRows(tenantId, main.id)) {
      productRepository.patchProductVariantRow(member.id, { variantGroupId: null, variantOptions: {} });
    }
    productRepository.patchProductVariantRow(main.id, { variantConfig: null, variantGroupId: null, variantOptions: {} });
  });
  return buildView(loadOwned(main.id, tenantId), tenantId);
}

// ------------------------------------------------------------------------- merge into shared stock

/** Group existing products into ONE shared-stock product: each other product becomes a variant of
 * the main product, its stock is moved into the main product (adjustment movements at every
 * location, Main Store earmarks moved bucket-for-bucket), its barcode moves onto its variant so
 * scanning still works, and it is deactivated (history kept). */
export function mergeIntoSharedVariants(input: unknown): VariantGroupView {
  requirePermission("products", "edit");
  requirePermission("inventory", "edit");
  const parsed = mergeIntoSharedVariantsSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const performedBy = getCurrentEmployeeId();
  const main = loadOwned(parsed.mainProductId, tenantId);

  if (main.variant_group_id) {
    throw new Error(`"${main.name}" is part of a separate-stock variant group. Remove it from that group first.`);
  }
  const current = configOf(main);
  if (current?.mode === "separate") {
    throw new Error(`"${main.name}" has separate-stock variants. Remove them first, or group with separate stock.`);
  }

  // Joining an existing shared product: same option names, value lists merged.
  let options = parsed.options;
  if (current) {
    const same =
      current.options.length === options.length &&
      current.options.every((o) => options.some((p) => p.name.toLowerCase() === o.name.toLowerCase()));
    if (!same) {
      throw new Error(
        `"${main.name}" already has variants by ${current.options.map((o) => o.name).join(", ")} — use the same option names`
      );
    }
    options = current.options.map((o) => {
      const incoming = parsed.options.find((p) => p.name.toLowerCase() === o.name.toLowerCase())!;
      return { name: o.name, values: [...o.values, ...incoming.values.filter((v) => !o.values.includes(v))] };
    });
    // values arrive keyed by the incoming spelling — re-key to the existing option names
    for (const entry of parsed.entries) {
      entry.values = Object.fromEntries(
        Object.entries(entry.values).map(([k, v]) => [
          options.find((o) => o.name.toLowerCase() === k.toLowerCase())?.name ?? k,
          v
        ])
      );
    }
  }

  if (parsed.entries.filter((e) => e.productId === main.id).length !== 1) {
    throw new Error("The main product must be one of the products being grouped");
  }
  const ids = parsed.entries.map((e) => e.productId);
  if (new Set(ids).size !== ids.length) throw new Error("A product is listed twice");

  const others = parsed.entries
    .filter((e) => e.productId !== main.id)
    .map((e) => {
      const row = loadOwned(e.productId, tenantId);
      if (row.variant_group_id) throw new Error(`"${row.name}" belongs to a variant group — remove it from that group first`);
      if (configOf(row)) throw new Error(`"${row.name}" has variants of its own — remove them first`);
      if (row.status !== "active") throw new Error(`"${row.name}" is deactivated — activate it first or leave it out`);
      return { row, values: e.values };
    });

  const existingVariants = current?.variants ?? [];
  for (const e of parsed.entries) {
    const name = e.productId === main.id ? main.name : others.find((o) => o.row.id === e.productId)!.row.name;
    assertValuesMatchOptions(options, e.values, `"${name}"`);
  }
  const mainEntry = parsed.entries.find((e) => e.productId === main.id)!;
  const mainAlreadyListed = existingVariants.some((v) => sameVariantValues(v.values, mainEntry.values));
  assertNoDuplicateCombos(options, [
    ...existingVariants.map((v) => v.values),
    ...(mainAlreadyListed ? [] : [mainEntry.values]),
    ...others.map((o) => o.values)
  ]);

  if (parsed.newName) {
    const clash = productRepository.findProductByNameRow(tenantId, parsed.newName, main.id);
    if (clash && !others.some((o) => o.row.id === clash.id)) {
      throw new Error(`A product named "${parsed.newName}" already exists`);
    }
  }

  const mainStore = locationRepository.findMainStoreLocationRow(tenantId);
  const referenceId = `variant_merge_${randomUUID()}`;
  const finalName = parsed.newName ?? main.name;

  runInTransaction(() => {
    const variants: SharedVariant[] = [...existingVariants];
    if (!mainAlreadyListed) {
      variants.push({ key: newVariantKey(), values: mainEntry.values, priceCents: null, sku: null, barcode: null, active: true });
    }

    for (const { row, values } of others) {
      const label = variantLabel(options, values);
      const notes = `Grouped "${row.name}" into "${finalName}" as variant ${label}`;
      const move = (productId: string, locationId: string, change: number, allocationStorefrontId: string | null): void => {
        if (change === 0) return;
        applyValidatedStockMovement(
          {
            productId,
            locationId,
            movementType: "adjustment",
            quantityChange: change,
            referenceType: "variant_merge",
            referenceId,
            performedBy,
            notes,
            allocationStorefrontId
          },
          tenantId
        );
      };

      for (const balance of inventoryRepository.findInventoryOverviewForProduct(tenantId, row.id)) {
        const quantity = balance.quantity ?? 0;
        if (quantity === 0) continue;
        let remainder = quantity;
        if (mainStore && balance.location_id === mainStore.id) {
          // named Main Store earmarks travel as themselves; only the rest is "unallocated"
          for (const bucket of mainStoreAllocationRepository.findAllocationRowsForProduct(row.id)) {
            if (bucket.storefront_id === null || bucket.quantity === 0) continue;
            move(row.id, balance.location_id, -bucket.quantity, bucket.storefront_id);
            move(main.id, balance.location_id, bucket.quantity, bucket.storefront_id);
            remainder -= bucket.quantity;
          }
        }
        move(row.id, balance.location_id, -remainder, null);
        move(main.id, balance.location_id, remainder, null);
      }

      // The barcode moves to the variant (so scanning it still finds this item); the old product
      // keeps its SKU and history, and is deactivated.
      if (row.barcode) productRepository.patchProductVariantRow(row.id, { barcode: null });
      productRepository.setProductStatusRow(row.id, "inactive");
      variants.push({
        key: newVariantKey(),
        values,
        priceCents: row.selling_price_cents !== main.selling_price_cents ? row.selling_price_cents : null,
        sku: null,
        barcode: row.barcode,
        active: true
      });
    }

    productRepository.patchProductVariantRow(main.id, {
      ...(parsed.newName ? { name: parsed.newName } : {}),
      variantConfig: { mode: "shared", title: parsed.title ?? current?.title ?? null, options, variants }
    });
  });

  return buildView(loadOwned(main.id, tenantId), tenantId);
}
