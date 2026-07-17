/**
 * One-off demo-data generator for client demos — NOT part of the normal app. Only runs when
 * bootstrap.ts sees BLUE_LEDGER_SEED_DEMO=1. Calls the real service layer wherever the service
 * layer exposes a session-free entry point (sales, invoices) for full location/employee freedom,
 * and `setSessionForSeeding` elsewhere (purchases, quotations, salaries) so every business rule
 * (pricing, tax, stock movements, payment-status derivation) runs through the exact same code a
 * real user's action would. Every service call lands with "now" timestamps (no service function
 * accepts a backdated created/completed date), so each event is immediately backdated afterward
 * with a small, targeted SQL UPDATE — safe because these are cumulative running totals, not
 * date-range-dependent for their current state.
 */
import { getDatabase } from "@main/database/connection";
import * as customerRepository from "@main/database/repositories/customer-repository";
import * as employeeRepository from "@main/database/repositories/employee-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as supplierRepository from "@main/database/repositories/supplier-repository";
import { logout, setSessionForSeeding } from "@main/services/auth-service";
import { createCategory } from "@main/services/category-service";
import { createSalary } from "@main/services/salary-service";
import { insertInvoiceFromCart, recordInvoicePayment } from "@main/services/invoice-service";
import { createProduct } from "@main/services/product-service";
import { createPurchase, markPurchasePaid, receivePurchaseGoods, recordPurchasePayment } from "@main/services/purchase-service";
import { convertQuotationToSale, createQuotation, setQuotationStatus } from "@main/services/quotation-service";
import { insertCompletedSaleFromCart, prepareCart } from "@main/services/sale-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { isStorefrontType, type LocationType } from "@shared/types/location";

const SYSTEM_EMPLOYEE_CODE = "SYSTEM";
const DAYS_SPAN = 30;

// ---------------------------------------------------------------------------------------------
// Small random-data helpers
// ---------------------------------------------------------------------------------------------

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)]!;
}

function pickWeighted<T>(entries: Array<[T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

function chance(probability: number): boolean {
  return Math.random() < probability;
}

/** A timestamp `daysBack` days before now (0 = today), at a randomized business hour. */
function historicalIso(daysBack: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  date.setHours(randInt(8, 19), randInt(0, 59), randInt(0, 59), 0);
  return date.toISOString();
}

/** A date string (no time) `daysOffset` days from now — positive = future, negative = past. */
function isoDateOffset(daysOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Backdating helpers — every business function above lands as "now"; these rewrite the handful
// of timestamp columns each event actually owns, matched by id/reference, right after creation.
// ---------------------------------------------------------------------------------------------

function backdateSale(saleId: string, iso: string): void {
  const db = getDatabase();
  db.prepare(`UPDATE sales SET completed_at = ?, created_at = ?, updated_at = ? WHERE id = ?`).run(iso, iso, iso, saleId);
  db.prepare(`UPDATE sale_items SET created_at = ? WHERE sale_id = ?`).run(iso, saleId);
  db.prepare(`UPDATE stock_movements SET created_at = ? WHERE reference_type = 'sale' AND reference_id = ?`).run(iso, saleId);
}

function backdateInvoice(saleId: string, iso: string): void {
  const db = getDatabase();
  db.prepare(`UPDATE sales SET invoice_date = ?, created_at = ?, updated_at = ? WHERE id = ?`).run(iso, iso, iso, saleId);
  db.prepare(`UPDATE sale_items SET created_at = ? WHERE sale_id = ?`).run(iso, saleId);
  db.prepare(`UPDATE stock_movements SET created_at = ? WHERE reference_type = 'sale' AND reference_id = ?`).run(iso, saleId);
}

function backdatePurchase(purchaseId: string, orderedIso: string, receivedIso: string | null): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE purchases SET ordered_at = ?, received_at = COALESCE(?, received_at), created_at = ?, updated_at = ? WHERE id = ?`
  ).run(orderedIso, receivedIso, orderedIso, receivedIso ?? orderedIso, purchaseId);
  db.prepare(`UPDATE purchase_items SET created_at = ?, updated_at = ? WHERE purchase_id = ?`).run(orderedIso, orderedIso, purchaseId);
  db.prepare(`UPDATE stock_movements SET created_at = ? WHERE reference_type = 'purchase' AND reference_id = ?`).run(
    receivedIso ?? orderedIso,
    purchaseId
  );
}

function backdateQuotation(quotationId: string, iso: string): void {
  const db = getDatabase();
  db.prepare(`UPDATE quotations SET created_at = ?, updated_at = ? WHERE id = ?`).run(iso, iso, quotationId);
  db.prepare(`UPDATE quotation_items SET created_at = ? WHERE quotation_id = ?`).run(iso, quotationId);
}

function backdateSalary(salaryId: string, iso: string): void {
  const db = getDatabase();
  db.prepare(`UPDATE salaries SET created_at = ?, updated_at = ? WHERE id = ?`).run(iso, iso, salaryId);
}

/** Re-running the seed script after an interrupted attempt must never crash on "already exists" —
 * these two look up an existing row by its unique key first, and only create a new one if missing. */
function findCategoryIdByName(tenantId: string, name: string): string | null {
  const row = getDatabase().prepare(`SELECT id FROM categories WHERE tenant_id = ? AND name = ?`).get(tenantId, name) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

function findProductIdBySku(tenantId: string, sku: string): string | null {
  const row = getDatabase().prepare(`SELECT id FROM products WHERE tenant_id = ? AND sku = ?`).get(tenantId, sku) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

/** Coincidental name collisions with the tenant's pre-existing catalog are possible (both catalogs
 * describe consumer electronics) — assertUniqueFields checks name independently of SKU, so this
 * must be checked too. */
function findProductIdByName(tenantId: string, name: string): string | null {
  const row = getDatabase().prepare(`SELECT id FROM products WHERE tenant_id = ? AND name = ?`).get(tenantId, name) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// New categories + a broad electronics catalog — on top of the existing satellite-TV-focused one
// ---------------------------------------------------------------------------------------------

type SeedProduct = {
  name: string;
  sku: string;
  buyingPriceCents: number;
  sellingPriceCents: number;
  wholesalePriceCents?: number;
  wholesaleMinQuantity?: number;
  reorderLevel: number;
};

const NEW_CATEGORIES: Array<{ name: string; color: string; products: SeedProduct[] }> = [
  {
    name: "SMARTPHONES",
    color: "#1d4ed8",
    products: [
      { name: "Samsung Galaxy A05", sku: "PHN-001", buyingPriceCents: 1_100_000, sellingPriceCents: 1_500_000, reorderLevel: 5 },
      { name: "Samsung Galaxy A15", sku: "PHN-002", buyingPriceCents: 1_800_000, sellingPriceCents: 2_350_000, reorderLevel: 5 },
      { name: "Xiaomi Redmi 13C", sku: "PHN-003", buyingPriceCents: 1_200_000, sellingPriceCents: 1_650_000, reorderLevel: 5 },
      { name: "Xiaomi Redmi Note 13", sku: "PHN-004", buyingPriceCents: 2_100_000, sellingPriceCents: 2_750_000, reorderLevel: 4 },
      { name: "Infinix Hot 40", sku: "PHN-005", buyingPriceCents: 1_400_000, sellingPriceCents: 1_850_000, reorderLevel: 5 },
      { name: "Infinix Note 30", sku: "PHN-006", buyingPriceCents: 1_900_000, sellingPriceCents: 2_500_000, reorderLevel: 4 },
      { name: "Tecno Spark 20", sku: "PHN-007", buyingPriceCents: 1_300_000, sellingPriceCents: 1_750_000, reorderLevel: 5 },
      { name: "Tecno Camon 20", sku: "PHN-008", buyingPriceCents: 2_200_000, sellingPriceCents: 2_900_000, reorderLevel: 4 },
      { name: "iPhone 11 (Refurbished)", sku: "PHN-009", buyingPriceCents: 3_200_000, sellingPriceCents: 4_200_000, reorderLevel: 3 },
      { name: "Nokia 105 Feature Phone", sku: "PHN-010", buyingPriceCents: 180_000, sellingPriceCents: 280_000, wholesalePriceCents: 240_000, wholesaleMinQuantity: 10, reorderLevel: 10 }
    ]
  },
  {
    name: "LAPTOPS & COMPUTERS",
    color: "#0e7490",
    products: [
      { name: "HP 15 Laptop Intel i3", sku: "LAP-001", buyingPriceCents: 4_500_000, sellingPriceCents: 5_800_000, reorderLevel: 3 },
      { name: "Dell Inspiron 15", sku: "LAP-002", buyingPriceCents: 5_200_000, sellingPriceCents: 6_600_000, reorderLevel: 3 },
      { name: "Lenovo IdeaPad 3", sku: "LAP-003", buyingPriceCents: 4_200_000, sellingPriceCents: 5_400_000, reorderLevel: 3 },
      { name: "HP EliteBook (Refurbished)", sku: "LAP-004", buyingPriceCents: 3_800_000, sellingPriceCents: 4_900_000, reorderLevel: 3 },
      { name: "Dell Latitude (Refurbished)", sku: "LAP-005", buyingPriceCents: 3_500_000, sellingPriceCents: 4_500_000, reorderLevel: 3 },
      { name: "Wireless Mouse", sku: "LAP-006", buyingPriceCents: 40_000, sellingPriceCents: 80_000, wholesalePriceCents: 65_000, wholesaleMinQuantity: 12, reorderLevel: 15 },
      { name: "USB Keyboard", sku: "LAP-007", buyingPriceCents: 60_000, sellingPriceCents: 120_000, wholesalePriceCents: 95_000, wholesaleMinQuantity: 12, reorderLevel: 15 },
      { name: "1TB External Hard Drive", sku: "LAP-008", buyingPriceCents: 550_000, sellingPriceCents: 750_000, reorderLevel: 6 },
      { name: "32GB Flash Disk", sku: "LAP-009", buyingPriceCents: 60_000, sellingPriceCents: 100_000, wholesalePriceCents: 80_000, wholesaleMinQuantity: 20, reorderLevel: 20 },
      { name: "Laptop Bag", sku: "LAP-010", buyingPriceCents: 90_000, sellingPriceCents: 180_000, reorderLevel: 10 }
    ]
  },
  {
    name: "AUDIO & HEADPHONES",
    color: "#7c3aed",
    products: [
      { name: "JBL Bluetooth Speaker Flip 6", sku: "AUD-001", buyingPriceCents: 850_000, sellingPriceCents: 1_250_000, reorderLevel: 5 },
      { name: "Sony Wireless Headphones", sku: "AUD-002", buyingPriceCents: 650_000, sellingPriceCents: 950_000, reorderLevel: 5 },
      { name: "Oraimo Earbuds", sku: "AUD-003", buyingPriceCents: 180_000, sellingPriceCents: 320_000, wholesalePriceCents: 260_000, wholesaleMinQuantity: 10, reorderLevel: 12 },
      { name: "Anker Soundcore Speaker", sku: "AUD-004", buyingPriceCents: 400_000, sellingPriceCents: 650_000, reorderLevel: 6 },
      { name: "Generic Wired Earphones", sku: "AUD-005", buyingPriceCents: 30_000, sellingPriceCents: 60_000, wholesalePriceCents: 45_000, wholesaleMinQuantity: 20, reorderLevel: 25 },
      { name: "Galaxy Buds Style Earbuds", sku: "AUD-006", buyingPriceCents: 250_000, sellingPriceCents: 450_000, reorderLevel: 8 },
      { name: "Home Theater Soundbar", sku: "AUD-007", buyingPriceCents: 900_000, sellingPriceCents: 1_400_000, reorderLevel: 4 },
      { name: "Wireless Karaoke Microphone", sku: "AUD-008", buyingPriceCents: 220_000, sellingPriceCents: 400_000, reorderLevel: 6 },
      { name: "Boombox Bluetooth Speaker", sku: "AUD-009", buyingPriceCents: 500_000, sellingPriceCents: 800_000, reorderLevel: 5 },
      { name: "Gaming Headset with Mic", sku: "AUD-010", buyingPriceCents: 300_000, sellingPriceCents: 550_000, reorderLevel: 6 }
    ]
  },
  {
    name: "GAMING & ACCESSORIES",
    color: "#be123c",
    products: [
      { name: "PS5 DualSense Controller", sku: "GAM-001", buyingPriceCents: 700_000, sellingPriceCents: 1_000_000, reorderLevel: 4 },
      { name: "Xbox Wireless Controller", sku: "GAM-002", buyingPriceCents: 650_000, sellingPriceCents: 950_000, reorderLevel: 4 },
      { name: "Gaming Chair", sku: "GAM-003", buyingPriceCents: 1_200_000, sellingPriceCents: 1_800_000, reorderLevel: 3 },
      { name: "PS4 Console (Refurbished)", sku: "GAM-004", buyingPriceCents: 2_800_000, sellingPriceCents: 3_600_000, reorderLevel: 2 },
      { name: "Gaming Mouse RGB", sku: "GAM-005", buyingPriceCents: 150_000, sellingPriceCents: 280_000, reorderLevel: 8 },
      { name: "Gaming Mechanical Keyboard", sku: "GAM-006", buyingPriceCents: 350_000, sellingPriceCents: 600_000, reorderLevel: 5 },
      { name: "HDMI Splitter", sku: "GAM-007", buyingPriceCents: 80_000, sellingPriceCents: 150_000, reorderLevel: 8 },
      { name: "VR Headset", sku: "GAM-008", buyingPriceCents: 1_500_000, sellingPriceCents: 2_200_000, reorderLevel: 3 },
      { name: "Racing Wheel Controller", sku: "GAM-009", buyingPriceCents: 900_000, sellingPriceCents: 1_400_000, reorderLevel: 3 },
      { name: "Gaming Monitor 24 Inch", sku: "GAM-010", buyingPriceCents: 1_800_000, sellingPriceCents: 2_600_000, reorderLevel: 3 }
    ]
  },
  {
    name: "CAMERAS & PHOTOGRAPHY",
    color: "#a16207",
    products: [
      { name: "4K Action Camera", sku: "CAM-001", buyingPriceCents: 800_000, sellingPriceCents: 1_200_000, reorderLevel: 4 },
      { name: "Tripod Stand", sku: "CAM-002", buyingPriceCents: 120_000, sellingPriceCents: 220_000, reorderLevel: 8 },
      { name: "Ring Light with Stand", sku: "CAM-003", buyingPriceCents: 150_000, sellingPriceCents: 280_000, reorderLevel: 6 },
      { name: "CCTV Camera Kit 4-Channel", sku: "CAM-004", buyingPriceCents: 900_000, sellingPriceCents: 1_400_000, reorderLevel: 4 },
      { name: "Digital Photo Frame", sku: "CAM-005", buyingPriceCents: 250_000, sellingPriceCents: 420_000, reorderLevel: 6 },
      { name: "Bluetooth Selfie Stick", sku: "CAM-006", buyingPriceCents: 40_000, sellingPriceCents: 80_000, wholesalePriceCents: 65_000, wholesaleMinQuantity: 15, reorderLevel: 15 },
      { name: "128GB Memory Card", sku: "CAM-007", buyingPriceCents: 90_000, sellingPriceCents: 160_000, reorderLevel: 10 },
      { name: "HD Webcam 1080p", sku: "CAM-008", buyingPriceCents: 180_000, sellingPriceCents: 320_000, reorderLevel: 6 },
      { name: "Instant Print Camera", sku: "CAM-009", buyingPriceCents: 600_000, sellingPriceCents: 950_000, reorderLevel: 3 },
      { name: "Drone with Camera", sku: "CAM-010", buyingPriceCents: 2_500_000, sellingPriceCents: 3_600_000, reorderLevel: 2 }
    ]
  },
  {
    name: "WEARABLES & SMARTWATCHES",
    color: "#0f766e",
    products: [
      { name: "Smart Watch Fitness Tracker", sku: "WCH-001", buyingPriceCents: 250_000, sellingPriceCents: 450_000, reorderLevel: 8 },
      { name: "Apple Watch (Used)", sku: "WCH-002", buyingPriceCents: 1_500_000, sellingPriceCents: 2_200_000, reorderLevel: 3 },
      { name: "Kids GPS Smart Watch", sku: "WCH-003", buyingPriceCents: 180_000, sellingPriceCents: 320_000, reorderLevel: 6 },
      { name: "Fitness Band", sku: "WCH-004", buyingPriceCents: 100_000, sellingPriceCents: 200_000, reorderLevel: 8 },
      { name: "Bluetooth Smart Ring", sku: "WCH-005", buyingPriceCents: 300_000, sellingPriceCents: 550_000, reorderLevel: 5 },
      { name: "Smart Watch with Call Function", sku: "WCH-006", buyingPriceCents: 350_000, sellingPriceCents: 600_000, reorderLevel: 6 },
      { name: "Waterproof Sport Smart Watch", sku: "WCH-007", buyingPriceCents: 280_000, sellingPriceCents: 480_000, reorderLevel: 6 }
    ]
  },
  {
    name: "POWER BANKS & CHARGERS",
    color: "#ca8a04",
    products: [
      { name: "Anker 20000mAh Power Bank", sku: "PWR-001", buyingPriceCents: 350_000, sellingPriceCents: 600_000, reorderLevel: 8 },
      { name: "Solar Power Bank 30000mAh", sku: "PWR-002", buyingPriceCents: 400_000, sellingPriceCents: 700_000, reorderLevel: 6 },
      { name: "Fast Charger 65W USB-C", sku: "PWR-003", buyingPriceCents: 120_000, sellingPriceCents: 220_000, wholesalePriceCents: 180_000, wholesaleMinQuantity: 12, reorderLevel: 12 },
      { name: "Dual USB Car Charger", sku: "PWR-004", buyingPriceCents: 60_000, sellingPriceCents: 120_000, wholesalePriceCents: 95_000, wholesaleMinQuantity: 15, reorderLevel: 15 },
      { name: "Wireless Charging Pad", sku: "PWR-005", buyingPriceCents: 150_000, sellingPriceCents: 280_000, reorderLevel: 8 },
      { name: "USB-C Cable 2M", sku: "PWR-006", buyingPriceCents: 40_000, sellingPriceCents: 80_000, wholesalePriceCents: 60_000, wholesaleMinQuantity: 20, reorderLevel: 25 },
      { name: "Multi-Port Charging Station", sku: "PWR-007", buyingPriceCents: 250_000, sellingPriceCents: 420_000, reorderLevel: 6 },
      { name: "Power Strip with USB Ports", sku: "PWR-008", buyingPriceCents: 180_000, sellingPriceCents: 320_000, reorderLevel: 8 }
    ]
  },
  {
    name: "KITCHEN & SMALL APPLIANCES",
    color: "#b91c1c",
    products: [
      { name: "Electric Kettle 1.7L", sku: "KIT-001", buyingPriceCents: 180_000, sellingPriceCents: 320_000, reorderLevel: 8 },
      { name: "2-in-1 Blender", sku: "KIT-002", buyingPriceCents: 350_000, sellingPriceCents: 600_000, reorderLevel: 6 },
      { name: "Sandwich Maker", sku: "KIT-003", buyingPriceCents: 250_000, sellingPriceCents: 450_000, reorderLevel: 6 },
      { name: "Rice Cooker 1.8L", sku: "KIT-004", buyingPriceCents: 400_000, sellingPriceCents: 680_000, reorderLevel: 6 },
      { name: "Air Fryer 5L", sku: "KIT-005", buyingPriceCents: 900_000, sellingPriceCents: 1_400_000, reorderLevel: 4 },
      { name: "Electric Iron Box", sku: "KIT-006", buyingPriceCents: 220_000, sellingPriceCents: 400_000, reorderLevel: 8 },
      { name: "Heavy Duty Blender", sku: "KIT-007", buyingPriceCents: 500_000, sellingPriceCents: 850_000, reorderLevel: 5 },
      { name: "Microwave 20L", sku: "KIT-008", buyingPriceCents: 1_100_000, sellingPriceCents: 1_700_000, reorderLevel: 4 }
    ]
  }
];

// ---------------------------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------------------------

export async function seedDemoData(): Promise<void> {
  console.log("[seed] Starting demo data generation...");

  const { tenantId } = getCurrentTenant();
  const systemRow = employeeRepository.findEmployeeByCodeRow(tenantId, SYSTEM_EMPLOYEE_CODE);
  if (!systemRow) throw new Error("[seed] SYSTEM employee not found — bootstrap must run first");

  const allLocations = locationRepository.findAllLocationRows(tenantId).filter((l) => l.status === "active");
  const storefronts = allLocations.filter((l) => isStorefrontType(l.location_type as LocationType));
  const mainStore = allLocations.find((l) => !isStorefrontType(l.location_type as LocationType));
  if (!mainStore) throw new Error("[seed] No Main Store found");

  const allEmployees = employeeRepository.findAllEmployeeRows(tenantId, null).filter((e) => e.status === "active");
  const branchEmployees = allEmployees.filter((e) => e.branch_id !== null);
  const customers = customerRepository.findAllCustomerRows(tenantId, null);
  const suppliers = supplierRepository.findAllSupplierRows(tenantId).filter((s) => s.status === "active");
  const paymentMethods = paymentMethodRepository.findAllPaymentMethodRows(tenantId).filter((p) => p.is_active);
  const cashMethod = paymentMethods.find((p) => p.name === "Cash") ?? paymentMethods[0]!;
  const mpesaMethod = paymentMethods.find((p) => p.name === "M-Pesa") ?? cashMethod;
  const cardMethod = paymentMethods.find((p) => p.name === "Card") ?? cashMethod;
  const bankMethod = paymentMethods.find((p) => p.name === "Bank Transfer") ?? cashMethod;

  console.log(
    `[seed] Found ${allLocations.length} locations (${storefronts.length} storefronts), ${allEmployees.length} employees, ${customers.length} customers, ${suppliers.length} suppliers, ${paymentMethods.length} payment methods.`
  );

  setSessionForSeeding(systemRow.id);

  // -----------------------------------------------------------------------------------------
  // Phase 1: categories + products
  // -----------------------------------------------------------------------------------------
  console.log("[seed] Creating categories + products...");
  const newProductIds: string[] = [];
  let sortOrder = 100;
  for (const group of NEW_CATEGORIES) {
    const existingCategoryId = findCategoryIdByName(tenantId, group.name);
    const categoryId =
      existingCategoryId ??
      createCategory({
        name: group.name,
        description: null,
        color: group.color,
        sortOrder: sortOrder,
        parentId: null
      }).id;
    sortOrder++;

    for (const product of group.products) {
      const existingProductId = findProductIdBySku(tenantId, product.sku) ?? findProductIdByName(tenantId, product.name);
      if (existingProductId) {
        newProductIds.push(existingProductId);
        continue;
      }

      const openingStock = [{ locationId: mainStore.id, quantity: randInt(60, 160) }];
      for (const sf of storefronts.length > 0 ? pickSome(storefronts, Math.min(3, storefronts.length)) : []) {
        openingStock.push({ locationId: sf.id, quantity: randInt(8, 35) });
      }

      const created = createProduct({
        sku: product.sku,
        barcode: null,
        supplierSku: null,
        name: product.name,
        shortName: null,
        description: null,
        categoryId,
        storefrontId: null,
        buyingPriceCents: product.buyingPriceCents,
        sellingPriceCents: product.sellingPriceCents,
        wholesalePriceCents: product.wholesalePriceCents ?? null,
        wholesaleMinQuantity: product.wholesaleMinQuantity ?? 0,
        minimumPriceCents: null,
        taxRate: 16,
        reorderLevel: product.reorderLevel,
        trackStock: true,
        allowNegativeStock: false,
        imagePath: null,
        openingStock
      });
      newProductIds.push(created.id);
    }
  }
  console.log(`[seed] Created ${NEW_CATEGORIES.length} categories, ${newProductIds.length} products.`);

  // -----------------------------------------------------------------------------------------
  // Phase 2: sales — every storefront, every day of the window, mixed employees
  // -----------------------------------------------------------------------------------------
  console.log("[seed] Generating sales across storefronts and days...");
  let saleCount = 0;
  let saleItemCount = 0;

  for (const storefront of storefronts) {
    const employeeForBranch = branchEmployees.filter((e) => e.branch_id === storefront.id);
    const stockRows = productRepository.findAllProductRows(tenantId, storefront.id).filter((p) => p.status === "active" && p.total_stock > 0);
    if (stockRows.length === 0) continue;

    const remaining = new Map<string, number>(stockRows.map((p) => [p.id, p.total_stock]));

    for (let daysBack = DAYS_SPAN - 1; daysBack >= 0; daysBack--) {
      const salesToday = randInt(2, 6);
      for (let s = 0; s < salesToday; s++) {
        const employee = employeeForBranch.length > 0 ? pick(employeeForBranch) : pick(allEmployees);
        const itemCount = randInt(1, 4);
        const items: Array<{ productId: string; quantity: number; discountAmountCents: number }> = [];

        for (let i = 0; i < itemCount; i++) {
          const candidates = stockRows.filter((p) => (remaining.get(p.id) ?? 0) >= 1);
          if (candidates.length === 0) break;
          const product = pick(candidates);
          const available = remaining.get(product.id) ?? 0;
          const quantity = Math.min(randInt(1, 3), available);
          if (quantity <= 0) continue;
          remaining.set(product.id, available - quantity);
          items.push({
            productId: product.id,
            quantity,
            discountAmountCents: chance(0.15) ? randInt(1, 5) * 5000 : 0
          });
        }
        if (items.length === 0) continue;

        const paymentMethodId = pickWeighted<string>([
          [cashMethod.id, 5],
          [mpesaMethod.id, 5],
          [cardMethod.id, 2],
          [bankMethod.id, 1]
        ]);
        const customerId = chance(0.3) ? pick(customers).id : null;

        const cart = prepareCart(tenantId, items);
        const sale = insertCompletedSaleFromCart({
          tenantId,
          employeeId: employee.id,
          locationId: storefront.id,
          customerId,
          cart,
          paymentMethodId,
          paymentReference: null,
          amountReceivedCents: null,
          notes: null
        });

        backdateSale(sale.id, historicalIso(daysBack));
        saleCount++;
        saleItemCount += items.length;
      }
    }
    console.log(`[seed]   ${storefront.location_name}: sales generated so far = ${saleCount}`);
  }
  console.log(`[seed] Created ${saleCount} sales (${saleItemCount} line items).`);

  // -----------------------------------------------------------------------------------------
  // Phase 3: purchases — mostly into Main Store, from all 3 suppliers, varied receiving/payment
  // -----------------------------------------------------------------------------------------
  console.log("[seed] Generating purchases...");
  let purchaseCount = 0;
  const allProductsForPurchasing = productRepository.findAllProductRows(tenantId, null).filter((p) => p.status === "active");

  for (let i = 0; i < 18; i++) {
    const supplier = pick(suppliers);
    const targetLocation = chance(0.8) ? mainStore : pick(storefronts.length > 0 ? storefronts : [mainStore]);
    const itemCount = randInt(2, 5);
    const items: Array<{ productId: string; orderedQuantity: number; unitCostCents: number; discountAmountCents: number; taxAmountCents: number }> = [];
    const chosen = pickSome(allProductsForPurchasing, Math.min(itemCount, allProductsForPurchasing.length));
    for (const product of chosen) {
      const quantity = randInt(10, 40);
      const unitCost = Math.round(product.buying_price_cents * (0.9 + Math.random() * 0.2));
      items.push({ productId: product.id, orderedQuantity: quantity, unitCostCents: unitCost, discountAmountCents: 0, taxAmountCents: 0 });
    }

    const daysBack = randInt(0, DAYS_SPAN - 1);
    const purchase = createPurchase({
      supplierId: supplier.id,
      supplierInvoiceNumber: null,
      locationId: targetLocation.id,
      taxType: "vat",
      notes: null,
      attachmentPath: null,
      items,
      intent: "ordered"
    });

    const orderedIso = historicalIso(daysBack + 2);
    let receivedIso: string | null = null;

    const receivingOutcome = pickWeighted<"full" | "partial" | "none">([
      ["full", 6],
      ["partial", 2],
      ["none", 2]
    ]);
    if (receivingOutcome !== "none") {
      const receiveItems = purchase.items.map((item) => ({
        purchaseItemId: item.id,
        receivingQuantity: receivingOutcome === "full" ? item.orderedQuantity : Math.max(1, Math.round(item.orderedQuantity * 0.5))
      }));
      receivePurchaseGoods(purchase.id, { items: receiveItems });
      receivedIso = historicalIso(Math.max(0, daysBack));
    }

    if (receivingOutcome !== "none") {
      const paymentOutcome = pickWeighted<"paid" | "partial" | "unpaid">([
        ["paid", 5],
        ["partial", 3],
        ["unpaid", 2]
      ]);
      if (paymentOutcome === "paid") {
        markPurchasePaid(purchase.id, {
          paymentMethodId: pick([cashMethod.id, mpesaMethod.id, bankMethod.id]),
          reference: `REF-${randInt(100000, 999999)}`,
          notes: null
        });
      } else if (paymentOutcome === "partial") {
        recordPurchasePayment(purchase.id, {
          paymentMethodId: pick([cashMethod.id, mpesaMethod.id, bankMethod.id]),
          amountCents: Math.round(purchase.grandTotalCents * 0.5),
          reference: `REF-${randInt(100000, 999999)}`,
          notes: null
        });
      }
    }

    backdatePurchase(purchase.id, orderedIso, receivedIso);
    purchaseCount++;
  }
  console.log(`[seed] Created ${purchaseCount} purchases.`);

  // -----------------------------------------------------------------------------------------
  // Phase 4: quotations — only at storefronts with real assigned employees (session-bound)
  // -----------------------------------------------------------------------------------------
  console.log("[seed] Generating quotations...");
  let quotationCount = 0;
  let convertedCount = 0;

  for (let i = 0; i < 24; i++) {
    const employee = pick(branchEmployees);
    setSessionForSeeding(employee.id);

    const locationProducts = productRepository.findAllProductRows(tenantId, employee.branch_id!).filter((p) => p.status === "active");
    if (locationProducts.length === 0) continue;

    const itemCount = randInt(1, 3);
    const items = pickSome(locationProducts, Math.min(itemCount, locationProducts.length)).map((p) => ({
      productId: p.id,
      quantity: randInt(1, 3),
      discountAmountCents: 0
    }));

    const daysBack = randInt(0, DAYS_SPAN - 1);
    const validUntilOffset = chance(0.4) ? -randInt(1, 10) : randInt(3, 20);

    const quotation = createQuotation({
      customerId: pick(customers).id,
      validUntil: isoDateOffset(validUntilOffset),
      notes: null,
      items
    });

    const statusOutcome = pickWeighted<"draft" | "sent" | "accepted" | "rejected">([
      ["draft", 3],
      ["sent", 3],
      ["accepted", 2],
      ["rejected", 1]
    ]);
    if (statusOutcome !== "draft") {
      setQuotationStatus(quotation.id, statusOutcome === "accepted" ? "sent" : statusOutcome);
      if (statusOutcome === "accepted") {
        setQuotationStatus(quotation.id, "accepted");
        if (chance(0.6) && validUntilOffset > 0) {
          try {
            convertQuotationToSale(quotation.id, {
              paymentMethodId: pick([cashMethod.id, mpesaMethod.id]),
              paymentReference: null,
              amountReceivedCents: null,
              quantityOverrides: []
            });
            convertedCount++;
          } catch {
            // Not enough stock left to convert this one — leave it accepted, unconverted. Fine.
          }
        }
      }
    }

    backdateQuotation(quotation.id, historicalIso(daysBack));
    quotationCount++;
  }
  setSessionForSeeding(systemRow.id);
  console.log(`[seed] Created ${quotationCount} quotations (${convertedCount} converted to sales).`);

  // -----------------------------------------------------------------------------------------
  // Phase 5: invoices — wholesale/business customers, varied due dates and payments
  // -----------------------------------------------------------------------------------------
  console.log("[seed] Generating invoices...");
  let invoiceCount = 0;
  const invoiceProducts = productRepository.findAllProductRows(tenantId, null).filter((p) => p.status === "active");

  for (let i = 0; i < 16; i++) {
    const employee = pick(branchEmployees);
    const locationId = employee.branch_id!;
    const itemCount = randInt(1, 4);
    const items = pickSome(invoiceProducts, Math.min(itemCount, invoiceProducts.length)).map((p) => ({
      productId: p.id,
      quantity: randInt(1, 5),
      discountAmountCents: 0
    }));

    const daysBack = randInt(2, DAYS_SPAN - 1);
    const dueOffset = chance(0.35) ? -randInt(1, 15) : randInt(3, 30);
    const cart = prepareCart(tenantId, items);

    const initialPayment = chance(0.5)
      ? {
          paymentMethodId: pick([cashMethod.id, mpesaMethod.id, bankMethod.id]),
          amountCents: Math.round(cart.grandTotalCents * 0.4),
          reference: `REF-${randInt(100000, 999999)}`
        }
      : null;

    let saleId: string;
    try {
      saleId = insertInvoiceFromCart({
        tenantId,
        employeeId: employee.id,
        locationId,
        customerId: pick(customers).id,
        transactionType: "invoice",
        dueDate: isoDateOffset(dueOffset),
        invoiceNotes: null,
        cart,
        initialPayment
      });
    } catch {
      continue; // Not enough stock for this product at this branch — skip this one.
    }

    if (chance(0.3)) {
      setSessionForSeeding(employee.id);
      try {
        recordInvoicePayment(saleId, {
          paymentMethodId: pick([cashMethod.id, mpesaMethod.id]),
          amountCents: Math.round(cart.grandTotalCents * 0.3),
          reference: null,
          notes: null
        });
      } catch {
        // Already paid off by the initial payment alone — fine, skip.
      }
      setSessionForSeeding(systemRow.id);
    }

    backdateInvoice(saleId, historicalIso(daysBack));
    invoiceCount++;
  }
  console.log(`[seed] Created ${invoiceCount} invoices.`);

  // -----------------------------------------------------------------------------------------
  // Phase 6: salaries — two pay periods per employee
  // -----------------------------------------------------------------------------------------
  console.log("[seed] Generating salaries...");
  let salaryCount = 0;
  const now = new Date();
  const periods = [
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    `${new Date(now.getFullYear(), now.getMonth() - 1, 1).getFullYear()}-${String(new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth() + 1).padStart(2, "0")}`
  ];

  for (const employee of allEmployees) {
    for (const [periodIndex, payPeriod] of periods.entries()) {
      const basicSalaryCents = randInt(25_000, 90_000) * 100;
      try {
        const salary = createSalary({
          employeeId: employee.id,
          payPeriod,
          basicSalaryCents,
          allowances: chance(0.4) ? [{ name: "Transport", amountCents: randInt(1_000, 5_000) * 100 }] : [],
          deductions: chance(0.3) ? [{ name: "Advance", amountCents: randInt(500, 3_000) * 100 }] : [],
          paymentMethodId: pick([bankMethod.id, mpesaMethod.id]),
          paymentReference: `PAYSLIP-${randInt(100000, 999999)}`,
          notes: null
        });
        const dayInPeriod = periodIndex === 0 ? randInt(1, 17) : randInt(28, 30);
        backdateSalary(salary.id, historicalIso(periodIndex === 0 ? dayInPeriod : DAYS_SPAN + dayInPeriod - 30));
        salaryCount++;
      } catch {
        // Already has a payslip for this period (from an earlier seed attempt) — fine, skip.
      }
    }
  }
  console.log(`[seed] Created ${salaryCount} salary records.`);

  logout();
  console.log("[seed] Done. Logged out. Restart the app normally to see the fresh data.");
}

function pickSome<T>(arr: readonly T[], count: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, count);
}
