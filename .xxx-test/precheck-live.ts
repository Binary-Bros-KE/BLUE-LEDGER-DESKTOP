import { getDatabase } from "@main/database/connection";

const db = getDatabase();
const tenant = db.prepare("SELECT id, business_name FROM tenant LIMIT 1").get() as {
  id: string;
  business_name: string;
};
console.log("Tenant:", tenant.business_name, tenant.id);

const names = ["KAWA GENERAL SHOP(MUKARU)", "EMBASSY CRYSTAL ENTERPRISES", "CRYSTAL ISHI KCO"];
for (const name of names) {
  const customer = db
    .prepare("SELECT id, name, current_balance_cents FROM customers WHERE tenant_id = ? AND name = ?")
    .get(tenant.id, name);
  console.log(name, "=>", JSON.stringify(customer));
}

const bbf = db
  .prepare("SELECT id FROM products WHERE tenant_id = ? AND name = 'Balance Brought Forward'")
  .get(tenant.id);
console.log("Existing Balance Brought Forward product:", JSON.stringify(bbf));

const lastInvoice = db
  .prepare("SELECT invoice_number FROM sales WHERE tenant_id = ? AND invoice_number IS NOT NULL ORDER BY created_at DESC LIMIT 3")
  .all(tenant.id);
console.log("Recent invoice numbers:", JSON.stringify(lastInvoice));
