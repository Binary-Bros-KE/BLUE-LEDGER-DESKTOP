import { migrateDatabase } from "@main/database/migrate";
import { getDatabase } from "@main/database/connection";
import { setSessionForSeeding } from "@main/services/auth-service";
import { createProduct } from "@main/services/product-service";
import { createInvoice } from "@main/services/invoice-service";
import { reconcileAllCustomerBalances } from "@main/database/repositories/customer-repository";

const failures = migrateDatabase();
if (failures.length > 0) {
  console.log("MIGRATION FAILURES:", JSON.stringify(failures, null, 1));
  process.exit(1);
}
console.log("Migrations applied cleanly.");

const db = getDatabase();
const tenant = db.prepare("SELECT id FROM tenant LIMIT 1").get() as { id: string };
const adminId = "employee_97e74a1e-2dce-47a0-938e-23b01b95bc8c"; // System Administrator / Super Admin
setSessionForSeeding(adminId);

// Find or create the "Balance Brought Forward" non-stock product
let bbfProduct = db
  .prepare("SELECT id FROM products WHERE tenant_id = ? AND name = 'Balance Brought Forward'")
  .get(tenant.id) as { id: string } | undefined;

if (!bbfProduct) {
  const created = createProduct({
    sku: "BAL-BROUGHT-FWD",
    name: "Balance Brought Forward",
    description: "Historical balance carried forward from before this system — not a real sale.",
    buyingPriceCents: 0,
    sellingPriceCents: 0,
    wholesaleMinQuantity: 0,
    taxRate: 0,
    taxType: "exempted",
    reorderLevel: 0,
    trackStock: false,
    allowNegativeStock: true
  });
  console.log("Created product:", created.id, created.name, "trackStock:", created.trackStock);
  bbfProduct = { id: created.id };
} else {
  console.log("Reusing existing product:", bbfProduct.id);
}

const cashMethod = db
  .prepare("SELECT id FROM payment_methods WHERE tenant_id = ? AND name = 'Cash'")
  .get(tenant.id) as { id: string };

console.log(
  "Locations:",
  JSON.stringify(
    db.prepare("SELECT id, location_name, location_type, status FROM locations WHERE tenant_id = ?").all(tenant.id)
  )
);

const targets: Array<{ nameLike: string; amountCents: number; label: string }> = [
  { nameLike: "KAWA GENERAL SHOP(MUKARU)", amountCents: 10_020_000, label: "Kawa General" },
  { nameLike: "EMBASSY CRYSTAL ENTERPRISES", amountCents: 275_081_500, label: "Embassy Crystal" },
  { nameLike: "CRYSTAL ISHI KCO", amountCents: 56_089_000, label: "Crystal Ishi" }
];

const dueDate = new Date();
dueDate.setDate(dueDate.getDate() + 30);
const dueDateIso = dueDate.toISOString().slice(0, 10);

for (const t of targets) {
  const customer = db
    .prepare("SELECT id, name, current_balance_cents FROM customers WHERE tenant_id = ? AND name = ?")
    .get(tenant.id, t.nameLike) as { id: string; name: string; current_balance_cents: number } | undefined;
  if (!customer) {
    console.log(`SKIP ${t.label}: customer not found by exact name "${t.nameLike}"`);
    continue;
  }

  const priorLocations = db
    .prepare(
      `
      SELECT l.id, l.location_name, COUNT(*) c
      FROM sales s JOIN locations l ON l.id = s.location_id
      WHERE s.customer_id = ?
      GROUP BY l.id, l.location_name
      ORDER BY c DESC
    `
    )
    .all(customer.id);
  console.log(`${t.label} prior invoice locations:`, JSON.stringify(priorLocations));
  const locationId = "location_4461becd-6bde-449f-900d-6fcb0e890345"; // ICONIX-ADIA HOME APPLIANCES — where all 3 customers' real invoices already live

  const stockMovementsBefore = (
    db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE reference_type = 'invoice'").get() as { c: number }
  ).c;

  const invoice = createInvoice({
    customerId: customer.id,
    transactionType: "invoice",
    dueDate: dueDateIso,
    locationId,
    items: [{ productId: bbfProduct.id, quantity: 1, unitPriceCents: t.amountCents }]
  });

  const stockMovementsAfter = (
    db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE reference_type = 'invoice'").get() as { c: number }
  ).c;

  console.log(
    `${t.label} (${customer.name}): invoice ${invoice.invoiceNumber}, grandTotal=${invoice.grandTotalCents}, ` +
      `amountPaid=${invoice.amountPaidCents}, balanceDue=${invoice.grandTotalCents - invoice.amountPaidCents}, ` +
      `stockMovementsCreated=${stockMovementsAfter - stockMovementsBefore} (should be 0)`
  );
}

reconcileAllCustomerBalances(tenant.id);
console.log("\n--- Final balances after reconcile ---");
for (const t of targets) {
  const customer = db
    .prepare("SELECT name, current_balance_cents FROM customers WHERE tenant_id = ? AND name = ?")
    .get(tenant.id, t.nameLike) as { name: string; current_balance_cents: number } | undefined;
  console.log(`${customer?.name}: current_balance_cents = ${customer?.current_balance_cents}`);
}
