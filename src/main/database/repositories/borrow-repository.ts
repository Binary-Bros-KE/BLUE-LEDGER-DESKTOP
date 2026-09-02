import { getDatabase } from "@main/database/connection";
import type {
  Borrow,
  BorrowDirection,
  BorrowItem,
  BorrowListItem,
  BorrowReturnEvent,
  BorrowStatus,
  BorrowSummary,
  BorrowSyncStatus
} from "@shared/types/borrow";

export type BorrowRow = {
  id: string;
  tenant_id: string;
  borrow_number: string;
  direction: string;
  supplier_id: string;
  location_id: string;
  status: string;
  notes: string | null;
  return_events: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

export type BorrowDetailRow = BorrowRow & {
  supplier_name: string;
  location_name: string;
  created_by_name: string | null;
};

export type BorrowListRow = {
  id: string;
  borrow_number: string;
  direction: string;
  supplier_id: string;
  supplier_name: string;
  location_id: string;
  location_name: string;
  status: string;
  item_count: number;
  total_quantity: number;
  total_remaining_quantity: number;
  created_at: string;
};

export type BorrowItemRow = {
  id: string;
  borrow_id: string;
  product_id: string;
  quantity: number;
  returned_quantity: number;
  remaining_quantity: number;
  created_at: string;
  updated_at: string;
};

export type BorrowItemDetailRow = BorrowItemRow & {
  product_name: string;
  sku: string;
};

/** Pass null for locationId to see every branch's borrows (e.g. a super-admin with no assigned branch). */
export function findAllBorrowListRows(tenantId: string, locationId: string | null): BorrowListRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        b.id,
        b.borrow_number,
        b.direction,
        b.supplier_id,
        s.business_name AS supplier_name,
        b.location_id,
        l.location_name AS location_name,
        b.status,
        COUNT(bi.id) AS item_count,
        COALESCE(SUM(bi.quantity), 0) AS total_quantity,
        COALESCE(SUM(bi.remaining_quantity), 0) AS total_remaining_quantity,
        b.created_at
      FROM borrows b
      JOIN suppliers s ON s.id = b.supplier_id
      JOIN locations l ON l.id = b.location_id
      LEFT JOIN borrow_items bi ON bi.borrow_id = b.id
      WHERE b.tenant_id = ? AND (? IS NULL OR b.location_id = ?)
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `
    )
    .all(tenantId, locationId, locationId) as BorrowListRow[];
}

export function mapBorrowListRow(row: BorrowListRow): BorrowListItem {
  return {
    id: row.id,
    borrowNumber: row.borrow_number,
    direction: row.direction as BorrowDirection,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    locationId: row.location_id,
    locationName: row.location_name,
    status: row.status as BorrowStatus,
    itemCount: row.item_count,
    totalQuantity: row.total_quantity,
    totalRemainingQuantity: row.total_remaining_quantity,
    createdAt: row.created_at
  };
}

export type BorrowSummaryRow = {
  total_borrows: number;
  open_count: number;
  partially_returned_count: number;
  returned_count: number;
  outstanding_borrowed_quantity: number;
  outstanding_lent_quantity: number;
};

export function findBorrowSummaryRow(tenantId: string, locationId: string | null): BorrowSummaryRow {
  return getDatabase()
    .prepare(
      `
      SELECT
        COUNT(DISTINCT b.id) AS total_borrows,
        COALESCE(SUM(CASE WHEN b.status = 'open' THEN 1 ELSE 0 END), 0) AS open_count,
        COALESCE(SUM(CASE WHEN b.status = 'partially_returned' THEN 1 ELSE 0 END), 0) AS partially_returned_count,
        COALESCE(SUM(CASE WHEN b.status = 'returned' THEN 1 ELSE 0 END), 0) AS returned_count,
        COALESCE(SUM(CASE WHEN b.direction = 'borrowed' THEN bi.remaining_quantity ELSE 0 END), 0) AS outstanding_borrowed_quantity,
        COALESCE(SUM(CASE WHEN b.direction = 'lent' THEN bi.remaining_quantity ELSE 0 END), 0) AS outstanding_lent_quantity
      FROM borrows b
      LEFT JOIN borrow_items bi ON bi.borrow_id = b.id
      WHERE b.tenant_id = ? AND (? IS NULL OR b.location_id = ?)
    `
    )
    .get(tenantId, locationId, locationId) as BorrowSummaryRow;
}

export function mapBorrowSummaryRow(row: BorrowSummaryRow): BorrowSummary {
  return {
    totalBorrows: row.total_borrows,
    openCount: row.open_count,
    partiallyReturnedCount: row.partially_returned_count,
    returnedCount: row.returned_count,
    outstandingBorrowedQuantity: row.outstanding_borrowed_quantity,
    outstandingLentQuantity: row.outstanding_lent_quantity
  };
}

// Returns every matching number, not just the max — see document-number-service.ts's own comment.
export function findMaxBorrowNumberRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT borrow_number FROM borrows WHERE tenant_id = ? AND borrow_number LIKE 'BRW-%'")
      .all(tenantId) as Array<{ borrow_number: string }>
  ).map((row) => row.borrow_number);
}

export function findBorrowRowById(id: string): BorrowRow | undefined {
  return getDatabase().prepare("SELECT * FROM borrows WHERE id = ?").get(id) as BorrowRow | undefined;
}

export function findBorrowDetailRowById(id: string): BorrowDetailRow | undefined {
  return getDatabase()
    .prepare(
      `
      SELECT
        b.*,
        s.business_name AS supplier_name,
        l.location_name AS location_name,
        (e.first_name || ' ' || e.last_name) AS created_by_name
      FROM borrows b
      JOIN suppliers s ON s.id = b.supplier_id
      JOIN locations l ON l.id = b.location_id
      LEFT JOIN employees e ON e.id = b.created_by
      WHERE b.id = ?
    `
    )
    .get(id) as BorrowDetailRow | undefined;
}

export function findBorrowItemRowsForBorrow(borrowId: string): BorrowItemRow[] {
  return getDatabase()
    .prepare("SELECT * FROM borrow_items WHERE borrow_id = ? ORDER BY created_at ASC")
    .all(borrowId) as BorrowItemRow[];
}

export function findBorrowItemDetailRowsForBorrow(borrowId: string): BorrowItemDetailRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT bi.*, p.name AS product_name, p.sku AS sku
      FROM borrow_items bi
      JOIN products p ON p.id = bi.product_id
      WHERE bi.borrow_id = ?
      ORDER BY bi.created_at ASC
    `
    )
    .all(borrowId) as BorrowItemDetailRow[];
}

export function findBorrowItemRowById(id: string): BorrowItemRow | undefined {
  return getDatabase().prepare("SELECT * FROM borrow_items WHERE id = ?").get(id) as BorrowItemRow | undefined;
}

export function insertBorrowRow(input: {
  id: string;
  tenantId: string;
  borrowNumber: string;
  direction: BorrowDirection;
  supplierId: string;
  locationId: string;
  notes: string | null;
  createdBy: string | null;
}): BorrowRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO borrows (
        id, tenant_id, borrow_number, direction, supplier_id, location_id, status,
        notes, created_by, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.borrowNumber,
      input.direction,
      input.supplierId,
      input.locationId,
      input.notes,
      input.createdBy,
      now,
      now
    );

  const row = findBorrowRowById(input.id);
  if (!row) {
    throw new Error("Failed to create borrow record");
  }
  return row;
}

export function insertBorrowItemRow(input: {
  id: string;
  borrowId: string;
  productId: string;
  quantity: number;
}): BorrowItemRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO borrow_items (id, borrow_id, product_id, quantity, returned_quantity, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `
    )
    .run(input.id, input.borrowId, input.productId, input.quantity, now, now);

  const row = findBorrowItemRowById(input.id);
  if (!row) {
    throw new Error("Failed to create borrow item record");
  }
  return row;
}

export function updateBorrowItemReturnedQuantityRow(id: string, returnedQuantity: number): BorrowItemRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE borrow_items SET returned_quantity = ?, updated_at = ? WHERE id = ?")
    .run(returnedQuantity, now, id);

  const row = findBorrowItemRowById(id);
  if (!row) {
    throw new Error("Borrow item not found after recording return");
  }
  return row;
}

export function updateBorrowStatusRow(id: string, status: BorrowStatus): BorrowRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE borrows SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(status, now, id);

  const row = findBorrowRowById(id);
  if (!row) {
    throw new Error("Borrow not found after status update");
  }
  return row;
}

/** Appends one return event (one "Record Return" click) to the borrow's return history — each
 * event's before/after quantities are frozen at the moment it happened, same pattern as
 * appendReceivingEventToPurchaseRow. */
export function appendReturnEventToBorrowRow(input: { id: string; returnEvents: BorrowReturnEvent[] }): BorrowRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE borrows SET return_events = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(JSON.stringify(input.returnEvents), now, input.id);

  const row = findBorrowRowById(input.id);
  if (!row) {
    throw new Error("Borrow not found after recording return event");
  }
  return row;
}

export function mapBorrowItemDetailRow(row: BorrowItemDetailRow): BorrowItem {
  return {
    id: row.id,
    borrowId: row.borrow_id,
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    quantity: row.quantity,
    returnedQuantity: row.returned_quantity,
    remainingQuantity: row.remaining_quantity,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseReturnEvents(raw: string): BorrowReturnEvent[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BorrowReturnEvent[]) : [];
  } catch {
    return [];
  }
}

export function mapBorrowDetailRow(row: BorrowDetailRow, items: BorrowItem[]): Borrow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    borrowNumber: row.borrow_number,
    direction: row.direction as BorrowDirection,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    locationId: row.location_id,
    locationName: row.location_name,
    status: row.status as BorrowStatus,
    notes: row.notes,
    returnEvents: parseReturnEvents(row.return_events),
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as BorrowSyncStatus,
    lastSyncedAt: row.last_synced_at,
    items
  };
}
