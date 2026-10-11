import { getDatabase } from "@main/database/connection";
import { setSessionForSeeding } from "@main/services/auth-service";
import { getCustomerStatement } from "@main/services/statement-service";

const db = getDatabase();
const tenant = db.prepare("SELECT id FROM tenant LIMIT 1").get() as { id: string };
const adminId = "employee_97e74a1e-2dce-47a0-938e-23b01b95bc8c";
setSessionForSeeding(adminId);

const names = ["KAWA GENERAL SHOP(MUKARU)", "EMBASSY CRYSTAL ENTERPRISES", "CRYSTAL ISHI KCO"];
for (const name of names) {
  const customer = db.prepare("SELECT id FROM customers WHERE tenant_id = ? AND name = ?").get(tenant.id, name) as {
    id: string;
  };
  const statement = getCustomerStatement(customer.id, {});
  console.log(`\n=== ${name} ===`);
  console.log("totalOutstandingCents:", statement.totalOutstandingCents);
  for (const inv of statement.invoices) {
    const items = db
      .prepare(
        `SELECT p.name, si.line_total_cents FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?`
      )
      .all(inv.id);
    console.log(
      ` - ${inv.invoiceNumber} (${inv.invoiceDate}) balanceDue=${inv.balanceDueCents} items=${JSON.stringify(items)}`
    );
  }
}
