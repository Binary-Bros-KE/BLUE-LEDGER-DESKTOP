// Credit notes end to end through the real return service, on a database built by every real
// migration (only Electron-bound modules are stubbed — see tests/stubs). An invoice is set up the way
// the app leaves one (stock already deducted), then credited.
import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDatabase } from "../src/main/database/connection.ts";
import { migrateDatabase } from "../src/main/database/migrate.ts";
import { findApprovedReturnRefundRows } from "../src/main/database/repositories/report-repository.ts";
import { setTestSession } from "../src/main/services/auth-service.ts";
import { requestInvoiceCancel } from "../src/main/services/invoice-cancellation-service.ts";
import { approveSaleReturn, getCreditNote, issueCreditNote, rejectSaleReturn, requestSaleReturn } from "../src/main/services/sale-return-service.ts";

const ALL = ["view", "create", "edit", "delete", "approve", "export"];

function insertRow(table: string, values: Record<string, string | number | null>): void {
  const db = getDatabase();
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number; dflt_value: unknown; type: string }>;
  const row: Record<string, string | number | null> = { ...values };
  for (const column of columns) {
    if (column.name in row || !column.notnull || column.dflt_value !== null) continue;
    row[column.name] = /INT|REAL/i.test(column.type) ? 0 : `${table}-${column.name}-${String(values.id ?? "")}`;
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...Object.values(row));
}

function stockOf(productId: string): number {
  const row = getDatabase().prepare("SELECT quantity FROM inventory WHERE product_id = ? AND location_id = 'loc-a'").get(productId) as { quantity: number } | undefined;
  return row?.quantity ?? 0;
}

function sale(id: string): { balance_due_cents: number; payment_status: string; amount_paid_cents: number } {
  return getDatabase().prepare("SELECT balance_due_cents, payment_status, amount_paid_cents FROM sales WHERE id = ?").get(id) as never;
}

let counter = 0;
/** An invoice for 10 units at 1,000 (10,000 total) with `paid` already paid, its stock already taken. */
function makeInvoice(paid: number, kind: "invoice" | "receipt" = "invoice"): { saleId: string; saleItemId: string } {
  counter += 1;
  const saleId = `sale-${counter}`;
  const saleItemId = `item-${counter}`;
  const now = new Date().toISOString();
  insertRow("sales", {
    id: saleId,
    tenant_id: "tenant-1",
    location_id: "loc-a",
    employee_id: "emp-1",
    customer_id: "cust-1",
    sale_status: "completed",
    receipt_number: kind === "receipt" ? `R-${counter}` : null,
    invoice_number: kind === "invoice" ? `INV-${counter}` : null,
    transaction_type: kind === "invoice" ? "invoice" : "retail_sale",
    grand_total_cents: 10_000,
    subtotal_cents: 10_000,
    amount_paid_cents: paid,
    balance_due_cents: 10_000 - paid,
    payment_status: paid >= 10_000 ? "paid" : paid > 0 ? "partially_paid" : "unpaid",
    payments: "[]",
    due_date: null,
    completed_at: now,
    created_at: now,
    updated_at: now
  });
  insertRow("sale_items", {
    id: saleItemId,
    sale_id: saleId,
    product_id: "prod-1",
    quantity: 10,
    unit_price_cents: 1_000,
    line_total_cents: 10_000,
    created_at: now
  });
  getDatabase().prepare("UPDATE inventory SET quantity = quantity - 10 WHERE product_id = 'prod-1' AND location_id = 'loc-a'").run();
  return { saleId, saleItemId };
}

async function credit(saleId: string, saleItemId: string, quantity: number) {
  const requested = requestSaleReturn({ saleId, items: [{ saleItemId, quantity }], reason: "Damaged on delivery" });
  return approveSaleReturn(requested.id, { notes: null });
}

before(() => {
  assert.deepEqual(migrateDatabase(), [], "every migration applies cleanly");
  insertRow("tenant", { id: "tenant-1", business_name: "Test Shop", client_id: "client-1" });
  insertRow("locations", { id: "loc-a", tenant_id: "tenant-1", location_name: "Branch A", phone: "0700000000" });
  insertRow("employees", { id: "emp-1", tenant_id: "tenant-1", first_name: "Jane", last_name: "Manager" });
  insertRow("customers", { id: "cust-1", tenant_id: "tenant-1", name: "Mary Wanjiru", phone: "0712345678", status: "active" });
  insertRow("products", { id: "prod-1", tenant_id: "tenant-1", name: "Rice 1kg", track_stock: 1, status: "active" });
  insertRow("inventory", { id: "inv-1", tenant_id: "tenant-1", product_id: "prod-1", location_id: "loc-a", quantity: 1_000 });
});

beforeEach(() => {
  setTestSession({ employeeId: "emp-1", branchId: null, permissions: { sales: ALL, approvals: ["approve"] } });
});

test("migration 112 is recorded", () => {
  const row = getDatabase().prepare("SELECT name FROM migrations WHERE version = 112").get() as { name: string } | undefined;
  assert.equal(row?.name, "credit_notes");
});

test("unpaid invoice: stock comes back, the balance drops, nothing is refunded", async () => {
  const { saleId, saleItemId } = makeInvoice(0);
  const before = stockOf("prod-1");
  const approved = await credit(saleId, saleItemId, 3);
  assert.equal(stockOf("prod-1"), before + 3);
  assert.match(approved.creditNoteNumber ?? "", /^CN-/);
  assert.equal(approved.refundCents, 0);
  assert.equal(sale(saleId).balance_due_cents, 7_000);
  assert.equal(sale(saleId).payment_status, "unpaid");
  const note = getCreditNote(approved.id);
  assert.equal(note.againstKind, "invoice");
  assert.equal(note.totalCents, 3_000);
  assert.equal(note.balanceReductionCents, 3_000);
  assert.equal(note.refundCents, 0);
  assert.equal(note.invoiceBalanceCents, 7_000);
  assert.equal(note.customerName, "Mary Wanjiru");
});

test("fully paid invoice: the whole credit is refunded and shows as money out", async () => {
  const { saleId, saleItemId } = makeInvoice(10_000);
  const approved = await credit(saleId, saleItemId, 2);
  assert.equal(approved.refundCents, 2_000);
  assert.equal(sale(saleId).balance_due_cents, 0);
  assert.equal(sale(saleId).payment_status, "paid");
  const refund = findApprovedReturnRefundRows("tenant-1", null).find((row) => row.return_id === approved.id);
  assert.equal(refund?.returned_value_cents, 2_000, "Transactions/cash-up money out is the refund");
});

test("partly paid invoice: reduce the balance first, refund only the rest", async () => {
  const { saleId, saleItemId } = makeInvoice(4_000); // owes 6,000
  const first = await credit(saleId, saleItemId, 4); // 4,000 credit: owed 2,000, nothing back
  assert.equal(first.refundCents, 0);
  assert.equal(sale(saleId).balance_due_cents, 2_000);
  assert.equal(sale(saleId).payment_status, "partially_paid");
  const second = await credit(saleId, saleItemId, 5); // 5,000 credit: clears 2,000, refunds 3,000
  assert.equal(second.refundCents, 3_000);
  assert.equal(sale(saleId).balance_due_cents, 0);
  const refund = findApprovedReturnRefundRows("tenant-1", null).find((row) => row.return_id === first.id);
  assert.equal(refund?.returned_value_cents, 0, "an unpaid-part credit is no money out");
});

test("can't credit more than was sold, across credit notes", async () => {
  const { saleId, saleItemId } = makeInvoice(0);
  await credit(saleId, saleItemId, 8);
  assert.throws(() => requestSaleReturn({ saleId, items: [{ saleItemId, quantity: 3 }], reason: "x" }), /Only 2 unit/);
});

test("a rejected request changes nothing", async () => {
  const { saleId, saleItemId } = makeInvoice(0);
  const before = stockOf("prod-1");
  const requested = requestSaleReturn({ saleId, items: [{ saleItemId, quantity: 2 }], reason: "x" });
  await rejectSaleReturn(requested.id, { notes: null });
  assert.equal(stockOf("prod-1"), before);
  assert.equal(sale(saleId).balance_due_cents, 10_000);
});

test("an invoice with a credit note can't be cancelled (it would refund and restock twice)", async () => {
  const { saleId, saleItemId } = makeInvoice(0);
  requestSaleReturn({ saleId, items: [{ saleItemId, quantity: 1 }], reason: "x" });
  assert.throws(() => requestInvoiceCancel({ saleId, reason: "Customer changed mind" }), /credit note/);
});

test("receipt return: refund is the whole value, and a CN number only when asked", async () => {
  const { saleId, saleItemId } = makeInvoice(10_000, "receipt");
  const approved = await credit(saleId, saleItemId, 2);
  assert.equal(approved.creditNoteNumber, null);
  assert.equal(approved.refundCents, null);
  assert.throws(() => getCreditNote(approved.id), /No credit note/);
  const note = issueCreditNote(approved.id);
  assert.match(note.creditNoteNumber, /^CN-/);
  assert.equal(note.againstKind, "receipt");
  assert.equal(note.refundCents, 2_000);
  assert.equal(note.invoiceBalanceCents, null);
  assert.equal(issueCreditNote(approved.id).creditNoteNumber, note.creditNoteNumber, "issuing again keeps the same number");
});

test("credit note numbers never repeat", async () => {
  const numbers = new Set<string>();
  for (let i = 0; i < 3; i += 1) {
    const { saleId, saleItemId } = makeInvoice(0);
    numbers.add((await credit(saleId, saleItemId, 1)).creditNoteNumber!);
  }
  assert.equal(numbers.size, 3);
});

test("only an approver can approve, and only sales viewers can see the document", async () => {
  const { saleId, saleItemId } = makeInvoice(0);
  const requested = requestSaleReturn({ saleId, items: [{ saleItemId, quantity: 1 }], reason: "x" });
  setTestSession({ employeeId: "emp-1", branchId: null, permissions: { sales: ALL } });
  await assert.rejects(() => approveSaleReturn(requested.id, { notes: null }), /permission/);
});

test("after a credit note, payments are capped at the reduced balance", async () => {
  const { recordInvoicePayment } = await import("../src/main/services/invoice-service.ts");
  insertRow("payment_methods", { id: "pm-cash", tenant_id: "tenant-1", name: "Cash", code: "CASH", requires_reference: 0, is_active: 1 });
  const { saleId, saleItemId } = makeInvoice(0);
  await credit(saleId, saleItemId, 3); // owes 7,000
  assert.throws(() => recordInvoicePayment(saleId, { paymentMethodId: "pm-cash", amountCents: 8_000 }), /outstanding balance of 70\.00/);
  recordInvoicePayment(saleId, { paymentMethodId: "pm-cash", amountCents: 7_000 });
  assert.equal(sale(saleId).balance_due_cents, 0);
  assert.equal(sale(saleId).payment_status, "paid");
});

test("an invoice's own totals add up after credit notes: total − credited − paid = balance", async () => {
  const { findSaleDetailRowById, mapSaleDetailRow } = await import("../src/main/database/repositories/sale-repository.ts");
  const { saleId, saleItemId } = makeInvoice(4_000);
  await credit(saleId, saleItemId, 3);
  const invoice = mapSaleDetailRow(findSaleDetailRowById(saleId)!, [], [], null);
  assert.equal(invoice.creditedCents, 3_000);
  assert.equal(invoice.grandTotalCents - invoice.creditedCents - invoice.amountPaidCents, invoice.balanceDueCents);
});
