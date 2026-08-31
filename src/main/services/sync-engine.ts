import { randomUUID } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import { getDatabase, runInTransaction } from "@main/database/connection";
import * as categoryRepository from "@main/database/repositories/category-repository";
import * as customerRepository from "@main/database/repositories/customer-repository";
import * as deliveryNoteRepository from "@main/database/repositories/delivery-note-repository";
import * as employeeRepository from "@main/database/repositories/employee-repository";
import * as expenseCategoryRepository from "@main/database/repositories/expense-category-repository";
import * as expenseRepository from "@main/database/repositories/expense-repository";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as invoiceCancellationRepository from "@main/database/repositories/invoice-cancellation-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as mainStoreAllocationRepository from "@main/database/repositories/main-store-allocation-repository";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as purchaseRepository from "@main/database/repositories/purchase-repository";
import * as quotationRepository from "@main/database/repositories/quotation-repository";
import * as recurringBillRepository from "@main/database/repositories/recurring-bill-repository";
import * as riderRepository from "@main/database/repositories/rider-repository";
import * as roleRepository from "@main/database/repositories/role-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import * as saleReturnRepository from "@main/database/repositories/sale-return-repository";
import * as saleVoidRepository from "@main/database/repositories/sale-void-repository";
import * as salaryRepository from "@main/database/repositories/salary-repository";
import * as serviceChargeRepository from "@main/database/repositories/service-charge-repository";
import * as stockMovementRepository from "@main/database/repositories/stock-movement-repository";
import * as stockReceiptRepository from "@main/database/repositories/stock-receipt-repository";
import * as stockRequestRepository from "@main/database/repositories/stock-request-repository";
import * as supplierBalanceRepository from "@main/database/repositories/supplier-balance-repository";
import * as supplierRepository from "@main/database/repositories/supplier-repository";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import * as workingHoursRepository from "@main/database/repositories/working-hours-repository";
import { API_BASE_URL } from "@main/services/license-service";
import { computeGraceStatus } from "@shared/lib/grace-period";
import type { LicenseStatus, SubscriptionType } from "@shared/types/tenant";
import type {
  ConflictResolution,
  DriftEntry,
  EntitySyncOverviewRow,
  SyncConflictItem,
  SyncEntity,
  SyncReconciliationItem
} from "@shared/types/sync";

/** Every synced entity, in an order that respects the local SQLite schema's own foreign keys on
 * PULL (roles before employees — employees.role_id references roles; products after categories —
 * products.category_id references it; categories is self-referential via parent_id but has no
 * cross-entity dependency). Push has no such ordering concern — the cloud's Employee.roleId and
 * Product.categoryId are deliberately plain opaque strings, not Prisma relations (see
 * schema.prisma's own comment on that field). */
const SYNC_ENTITIES: SyncEntity[] = [
  "locations",
  // Depends on locations already existing locally on pull (FK on location_id) — must come after it.
  "working_hours",
  "categories",
  "roles",
  "payment_methods",
  "riders",
  "suppliers",
  // Depends on suppliers already existing locally on pull (FK on supplier_id) — must come after it.
  // Same "ledger, not a mutable field" shape as stock_movements/main_store_allocations: see this
  // entity's own PAYLOAD_BUILDER comment for why suppliers.balance_cents (the local cache it drives)
  // is never itself synced.
  "supplier_balance_entries",
  "customers",
  "employees",
  "products",
  // Depends on products + locations already existing locally on pull (FK) — must come after both.
  "stock_movements",
  // Depends on products + locations, same as stock_movements — but no longer reconstructed by
  // replaying it (see this table's own migration comment); syncs directly, own cursor.
  "main_store_allocations",
  // Depends on locations + employees (storefront_id/requested_by/reviewed_by) + products (item FKs).
  "stock_requests",
  // Same dependency shape as stock_requests (locations + employees + products).
  "stock_receipts",
  "expense_categories",
  "sales",
  "quotations",
  "purchases",
  "sale_returns",
  "sale_voids",
  "invoice_cancellations",
  "expenses",
  "salaries",
  "recurring_bills"
];

/** Entities whose PULL apply needs bespoke logic beyond the generic declarative column-map — a
 * header row plus nested line items (and, for sales/quotations, attached extras) that need a
 * replace-all-children apply, not a flat column-by-column upsert. See applySalePulledRow /
 * applyQuotationPulledRow / applyPurchasePulledRow / applySaleReturnPulledRow below. */
const BESPOKE_APPLY_ENTITIES = new Set<SyncEntity>([
  "sales",
  "quotations",
  "purchases",
  "sale_returns",
  // Not a document-with-line-items like the other four — an append-only ledger row that must be
  // applied as a quantity DELTA to local inventory/allocations, never a plain column-map upsert (see
  // applyStockMovementPulledRow's own doc comment).
  "stock_movements",
  // Same shape again — an append-only ledger row applied as a delta to a local cache column
  // (suppliers.balance_cents), never a plain column-map upsert. See
  // applySupplierBalanceEntryPulledRow's own doc comment.
  "supplier_balance_entries",
  // Back to a plain document-with-line-items, same shape as sale_returns — a header with a real
  // update path (approve/reject) plus items only ever inserted once at creation.
  "stock_requests",
  // Same shape again, but create-only — no update path at all (see this entity's own comments).
  "stock_receipts"
]);

/** Every entity whose PAYLOAD_BUILDER includes a `baseUpdatedAt` field and whose successful push/
 * pull needs to cache a new baseline (see markSyncedBaseline below) — the optimistic-lock
 * mechanism Products had alone through Phase 2, extended to every generic-path entity, and now to
 * the document entities too (sales/quotations/purchases/sale_returns/stock_requests — their
 * bespoke apply functions/upsertDocumentHeader gained the same synced_updated_at caching the
 * generic path already had). Only stock_movements stays out permanently — an append-only ledger
 * has no concurrent-edit scenario to guard against. */
const CONFLICT_AWARE_ENTITIES = new Set<SyncEntity>([
  "products",
  "categories",
  "payment_methods",
  "riders",
  "suppliers",
  "customers",
  "employees",
  "roles",
  "locations",
  "working_hours",
  "expense_categories",
  "expenses",
  "salaries",
  "recurring_bills",
  "sale_voids",
  "invoice_cancellations",
  "sales",
  "quotations",
  "purchases",
  "sale_returns",
  "stock_requests",
  "stock_receipts",
  // Unlike stock_movements (append-only, no concurrent-edit scenario), this table genuinely can be
  // touched by two devices before either syncs (e.g. both reallocate the same bucket offline) — a
  // real optimistic-lock case, same as any other mutable reference row.
  "main_store_allocations"
]);

/** Exported for sync-service.ts's getSyncSnapshot() — the UI-facing "what's the current sync state"
 * reader shares this app_settings-backed storage rather than duplicating the read logic. */
export function readSetting<T>(key: string): T | null {
  const row = getDatabase().prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: unknown): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), now);
}

function readCursor(entity: SyncEntity): string | null {
  return readSetting<string>(`sync_cursor:${entity}`);
}

function writeCursor(entity: SyncEntity, cursor: string): void {
  writeSetting(`sync_cursor:${entity}`, cursor);
}

/** Resolves the {tenantId, deviceId} the cloud actually knows this install as — null if this
 * install hasn't successfully activated yet (no cloud tenant id cached) or its workstation hasn't
 * completed activation (no cloud device id cached). Every sync operation bails out silently in
 * that case; there is nothing to sync against yet, and this is never an error a user needs to see.
 * Exported so sync-service.ts's getSyncSnapshot() can distinguish "never synced because not
 * activated yet" from "activated but genuinely offline right now". */
export function getCloudIdentity(): { tenantId: string; deviceId: string } | null {
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow?.server_id) return null;
  const workstation = tenantRepository.findPrimaryWorkstationRow(tenantRow.id);
  if (!workstation?.server_id) return null;
  return { tenantId: tenantRow.server_id, deviceId: workstation.server_id };
}

/** A MONTHLY tenant past grace is already fully hard-locked at the UI layer (App.tsx routes to
 * LicenseBlockedRoute) — this check is redundant-but-harmless for them (no reason background sync
 * should keep running behind a locked screen either). For LIFETIME/CUSTOM tenants, who the product
 * explicitly never blocks from using the POS itself, this is the ONLY place cloud sync actually
 * stops once their maintenance fee's grace period lapses — see the login banner's own "cloud sync
 * will pause" wording, which this is what makes literally true rather than aspirational. Same
 * "offline-safe, driven by this device's own already-cached clock" design as computeGraceStatus
 * itself was built for — no network round trip needed to decide this, and it must stay that way so
 * it works the instant the device's local clock crosses the deadline, without waiting on a heartbeat. */
function isSyncDisabledByGracePeriod(): boolean {
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) return false;
  const grace = computeGraceStatus(
    tenantRow.next_due_date,
    tenantRow.subscription_type as SubscriptionType | null,
    tenantRow.license_status as LicenseStatus
  );
  return grace.state === "expired";
}

/** Live pre-approval guard for stock requests/sale voids/sale returns (see SERVER's getRowStatus
 * for the full reasoning) — call this BEFORE creating the real side effect (a stock movement), not
 * just after the fact via the normal push/pull cycle. Two devices approving the same request within
 * the same sync window used to both succeed locally and both apply their side effect; this closes
 * that for the common (online) case by asking the cloud "what's true right now" first.
 *
 * Fails OPEN, deliberately: not activated, unreachable, or a slow connection all just return
 * silently and let the approval proceed exactly as it did before this existed — the sync cycle's
 * own conflict handling remains the fallback for a genuinely offline approver, same reduced (not
 * eliminated) risk window as before. This only ever narrows the window further, never removes the
 * offline capability the rest of the app is built around. */
export async function assertNotAlreadyDecidedRemotely(
  entity: SyncEntity,
  id: string,
  expectedPendingStatus: string
): Promise<void> {
  const identity = getCloudIdentity();
  if (!identity) return;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/sync/row-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: identity.tenantId, deviceId: identity.deviceId, entity, id }),
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    return;
  }
  if (!response.ok) return;

  const body = (await response.json().catch(() => null)) as
    | { found: boolean; status: string | null }
    | null;
  if (!body || !body.found || body.status === null || body.status === expectedPendingStatus) return;

  // Someone else already decided this — refresh local state right away rather than leaving this
  // device showing "pending" until its next scheduled pull.
  void pullDeltas();
  const verb = body.status === "approved" ? "approved" : body.status === "rejected" ? "rejected" : "decided";
  throw new Error(`This request was already ${verb} on another device.`);
}

// ---------------------------------------------------------------------------------------------
// PUSH — drain the outbox
// ---------------------------------------------------------------------------------------------

/** Every Phase-1 model shares the same cloud shape, but which LOCAL fields are safe to send
 * differs per entity (see the comments inline below) — most notably Employee, where the local
 * domain type already keeps pin_hash/password_hash out of mapEmployeeRow() entirely, but still
 * carries failed_login_attempts/locked_until/photo_path that have no cloud-side column and must be
 * dropped here, not just relied on the server to ignore. */
const PAYLOAD_BUILDERS: Record<SyncEntity, (id: string) => Record<string, unknown> | null> = {
  categories: (id) => {
    const row = categoryRepository.findCategoryRowById(id);
    if (!row) return null;
    const c = categoryRepository.mapCategoryRow(row);
    return {
      id: c.id,
      parentId: c.parentId,
      name: c.name,
      description: c.description,
      color: c.color,
      level: c.level,
      sortOrder: c.sortOrder,
      status: c.status,
      localCreatedAt: c.createdAt,
      localUpdatedAt: c.updatedAt,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  payment_methods: (id) => {
    const row = paymentMethodRepository.findPaymentMethodRowById(id);
    if (!row) return null;
    const p = paymentMethodRepository.mapPaymentMethodRow(row);
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      description: p.description,
      isSystemMethod: p.isSystemMethod,
      isActive: p.isActive,
      requiresReference: p.requiresReference,
      sortOrder: p.sortOrder,
      localCreatedAt: p.createdAt,
      localUpdatedAt: p.updatedAt,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  working_hours: (id) => {
    const row = workingHoursRepository.findWorkingHoursRowById(id);
    if (!row) return null;
    const w = workingHoursRepository.mapWorkingHoursRow(row);
    return {
      id: w.id,
      locationId: w.locationId,
      lockEnabled: w.lockEnabled,
      lockMode: w.lockMode,
      manuallyLocked: w.manuallyLocked,
      timezoneOffsetMinutes: w.timezoneOffsetMinutes,
      schedule: w.schedule,
      localCreatedAt: w.createdAt,
      localUpdatedAt: w.updatedAt,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  riders: (id) => {
    const row = riderRepository.findRiderRowById(id);
    if (!row) return null;
    const r = riderRepository.mapRiderRow(row);
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      altPhone: r.altPhone,
      company: r.company,
      vehicleDescription: r.vehicleDescription,
      status: r.status,
      localCreatedAt: r.createdAt,
      localUpdatedAt: r.updatedAt,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  suppliers: (id) => {
    const row = supplierRepository.findSupplierRowById(id);
    if (!row) return null;
    const s = supplierRepository.mapSupplierRow(row);
    return {
      id: s.id,
      supplierCode: s.supplierCode,
      businessName: s.businessName,
      contactPerson: s.contactPerson,
      phone1: s.phone1,
      phone2: s.phone2,
      email: s.email,
      kraPin: s.kraPin,
      website: s.website,
      country: s.country,
      county: s.county,
      town: s.town,
      physicalAddress: s.physicalAddress,
      paymentOption: s.paymentOption,
      mpesaName: s.mpesaName,
      mpesaNumber: s.mpesaNumber,
      mpesaAlternativeNumber: s.mpesaAlternativeNumber,
      bankName: s.bankName,
      bankAccountName: s.bankAccountName,
      bankAccountNumber: s.bankAccountNumber,
      creditLimitCents: s.creditLimitCents,
      status: s.status,
      notes: s.notes,
      // balanceCents deliberately NOT sent — see the Supplier type's own doc comment (mirrors
      // customers' currentBalanceCents exactly, same reasoning). The real, synced source of truth is
      // supplier_balance_entries, its own entry below.
      localCreatedAt: s.createdAt,
      localUpdatedAt: s.updatedAt,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  // Not conflict-aware — append-only ledger, same shape as stock_movements (no concurrent-edit
  // scenario: two devices each recording their own purchase/payment for the same supplier just both
  // land as independent rows, never competing over one). supplier_balance_entries has no APPLY_
  // CONFIG entry (see refColumnsFor's bespokeColumns map), so — same fix as stock_movements —
  // supplierId is alias-translated directly here rather than through that generic machinery.
  supplier_balance_entries: (id) => {
    const row = supplierBalanceRepository.findBalanceEntryRowById(id);
    if (!row) return null;
    return {
      id: row.id,
      supplierId: resolveCloudRef("suppliers", row.supplier_id),
      entryType: row.entry_type,
      amountCents: row.amount_cents,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      notes: row.notes,
      performedBy: row.performed_by,
      localCreatedAt: row.created_at,
      // Immutable — no separate updated_at column locally; its "last updated" IS its creation time.
      localUpdatedAt: row.created_at
    };
  },
  customers: (id) => {
    const row = customerRepository.findCustomerRowById(id);
    if (!row) return null;
    const c = customerRepository.mapCustomerRow(row);
    return {
      id: c.id,
      customerCode: c.customerCode,
      customerType: c.customerType,
      name: c.name,
      phone: c.phone,
      email: c.email,
      kraPin: c.kraPin,
      physicalAddress: c.physicalAddress,
      creditLimitCents: c.creditLimitCents,
      // currentBalanceCents deliberately NOT sent (Phase 2 finding) — it changes as a side effect
      // of sales/payments on whichever device recorded them, not a value someone consciously
      // edits; syncing it as plain last-write-wins risked silently losing one device's balance
      // change entirely. Stays device-local until a real fix (an append-only balance-adjustment
      // ledger) lands in Phase 3.
      notes: c.notes,
      status: c.status,
      // locationId intentionally omitted — the local Customer domain type (mapCustomerRow) doesn't
      // surface it even though the underlying column exists; the cloud column stays null for now.
      localCreatedAt: c.createdAt,
      localUpdatedAt: c.updatedAt,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  products: (id) => {
    const row = productRepository.findProductRowById(id);
    if (!row) return null;
    const p = productRepository.mapProductRow(row);
    return {
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      supplierSku: p.supplierSku,
      name: p.name,
      shortName: p.shortName,
      description: p.description,
      categoryId: p.categoryId,
      storefrontId: p.storefrontId,
      unitOfMeasure: p.unitOfMeasure,
      buyingPriceCents: p.buyingPriceCents,
      sellingPriceCents: p.sellingPriceCents,
      wholesalePriceCents: p.wholesalePriceCents,
      wholesaleMinQuantity: p.wholesaleMinQuantity,
      minimumPriceCents: p.minimumPriceCents,
      taxRate: p.taxRate,
      taxType: p.taxType,
      pricesTaxInclusive: p.pricesTaxInclusive,
      reorderLevel: p.reorderLevel,
      trackStock: p.trackStock,
      allowNegativeStock: p.allowNegativeStock,
      status: p.status,
      // imagePath deliberately NOT sent — a local file path, no shared cloud image storage yet
      // (same precedent as Employee.photoPath).
      localCreatedAt: p.createdAt,
      localUpdatedAt: p.updatedAt,
      // The optimistic-lock baseline — see CONFLICT_AWARE_ENTITIES's own comment. Null on a
      // product's first-ever push (nothing to conflict against yet).
      baseUpdatedAt: row.synced_updated_at
    };
  },
  // Not conflict-aware — the ledger is append-only, so there's never a concurrent-edit scenario to
  // detect a lock against. allocationStorefrontId/allocationExplicit are kept as historical/audit
  // context (what the original action intended) but no longer REPLAYED into allocation buckets on
  // pull — main_store_allocations syncs directly now (its own entry below), which is authoritative;
  // see that table's own migration comment for why ledger-replay could never fully reconstruct it.
  stock_movements: (id) => {
    const row = stockMovementRepository.findStockMovementRowById(id);
    if (!row) return null;
    return {
      id: row.id,
      // stock_movements has no APPLY_CONFIG entry (see refColumnsFor's bespokeColumns map), so
      // unlike every generic-path entity it never got alias-translation on push for free — fixed
      // here directly rather than bending it into that machinery for just one entity.
      productId: resolveCloudRef("products", row.product_id),
      locationId: resolveCloudRef("locations", row.location_id),
      movementType: row.movement_type,
      quantityChange: row.quantity_change,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      performedBy: row.performed_by,
      notes: row.notes,
      allocationStorefrontId: resolveCloudRef("locations", row.allocation_storefront_id),
      allocationExplicit: Boolean(row.allocation_explicit),
      localCreatedAt: row.created_at,
      // Immutable — no separate updated_at column locally; its "last updated" IS its creation time.
      localUpdatedAt: row.created_at
    };
  },
  main_store_allocations: (id) => {
    const row = mainStoreAllocationRepository.findAllocationRowById(id);
    if (!row) return null;
    return {
      id: row.id,
      productId: row.product_id,
      storefrontId: row.storefront_id,
      quantity: row.quantity,
      bucketKey: row.bucket_key,
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  // A plain document-with-line-items (like sale_returns), not a ledger — queried directly rather than
  // through stockRequestRepository.findStockRequestRowById, which joins in display-only fields
  // (storefront_name, requested_by_name, ...) this payload has no use for.
  stock_requests: (id) => {
    const row = getDatabase().prepare("SELECT * FROM stock_requests WHERE id = ?").get(id) as
      | {
          id: string;
          request_number: string;
          storefront_id: string;
          status: string;
          notes: string | null;
          rejection_reason: string | null;
          requested_by: string;
          requested_at: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
          synced_updated_at: string | null;
        }
      | undefined;
    if (!row) return null;

    const itemRows = getDatabase()
      .prepare("SELECT * FROM stock_request_items WHERE stock_request_id = ? ORDER BY created_at ASC")
      .all(id) as Array<{
      id: string;
      product_id: string;
      quantity_requested: number;
      previous_quantity: number | null;
      new_quantity: number | null;
      main_store_previous_quantity: number | null;
      main_store_new_quantity: number | null;
      created_at: string;
    }>;

    return {
      id: row.id,
      requestNumber: row.request_number,
      storefrontId: row.storefront_id,
      status: row.status,
      notes: row.notes,
      rejectionReason: row.rejection_reason,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      items: itemRows.map((i) => ({
        id: i.id,
        // Alias-translate before push — see resolveRef's pull-side counterpart in the apply
        // functions below for the full reasoning (a natural-key merge on "products" can supersede
        // this device's own local id with a different cloud id at any time).
        productId: resolveCloudRef("products", i.product_id),
        quantityRequested: i.quantity_requested,
        // Null for a still-pending or rejected request's items — see stock-request-service.ts's
        // approveStockRequest for where these get frozen at approval, mirroring stock_receipts'
        // own previous/new quantity pair below.
        previousQuantity: i.previous_quantity,
        newQuantity: i.new_quantity,
        mainStorePreviousQuantity: i.main_store_previous_quantity,
        mainStoreNewQuantity: i.main_store_new_quantity,
        createdAt: i.created_at
      })),
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  // Same header-with-frozen-line-items shape as stock_requests, but create-only — no reviewedBy/
  // reviewedAt-style update path exists (see this table's own migrate.ts comment), so there's no
  // update scenario to worry about here beyond the generic optimistic-lock plumbing every
  // CONFLICT_AWARE_ENTITIES member gets for free.
  stock_receipts: (id) => {
    const row = getDatabase().prepare("SELECT * FROM stock_receipts WHERE id = ?").get(id) as
      | {
          id: string;
          receipt_number: string;
          location_id: string;
          allocation_storefront_id: string | null;
          received_by: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
          synced_updated_at: string | null;
        }
      | undefined;
    if (!row) return null;

    const itemRows = getDatabase()
      .prepare("SELECT * FROM stock_receipt_items WHERE stock_receipt_id = ? ORDER BY created_at ASC")
      .all(id) as Array<{
      id: string;
      product_id: string;
      quantity_received: number;
      previous_quantity: number;
      new_quantity: number;
      main_store_previous_quantity: number | null;
      main_store_new_quantity: number | null;
      created_at: string;
    }>;

    return {
      id: row.id,
      receiptNumber: row.receipt_number,
      // locationId/allocationStorefrontId/receivedBy are flat header columns, alias-translated
      // generically by resolvePayloadRefsForPush via refColumnsFor's bespokeColumns entry below —
      // only item.productId (nested inside the items JSON array) needs a manual resolveCloudRef call
      // here, since that generic mechanism only ever walks the payload's top-level fields.
      locationId: row.location_id,
      allocationStorefrontId: row.allocation_storefront_id,
      receivedBy: row.received_by,
      notes: row.notes,
      items: itemRows.map((i) => ({
        id: i.id,
        productId: resolveCloudRef("products", i.product_id),
        quantityReceived: i.quantity_received,
        previousQuantity: i.previous_quantity,
        newQuantity: i.new_quantity,
        mainStorePreviousQuantity: i.main_store_previous_quantity,
        mainStoreNewQuantity: i.main_store_new_quantity,
        createdAt: i.created_at
      })),
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  employees: (id) => {
    const row = employeeRepository.findEmployeeRowById(id);
    if (!row) return null;
    const e = employeeRepository.mapEmployeeRow(row);
    return {
      id: e.id,
      employeeCode: e.employeeCode,
      firstName: e.firstName,
      middleName: e.middleName,
      lastName: e.lastName,
      gender: e.gender,
      dateOfBirth: e.dateOfBirth,
      phone: e.phone,
      alternativePhone: e.alternativePhone,
      email: e.email,
      branchId: e.branchId,
      department: e.department,
      jobTitle: e.jobTitle,
      hireDate: e.hireDate,
      roleId: e.roleId,
      username: e.username,
      status: e.status,
      lastLogin: e.lastLogin,
      defaultBasicSalaryCents: e.defaultBasicSalaryCents,
      // Cloud/Prisma field names carry the "Json" suffix (matching Salary.allowancesJson's own
      // established precedent) even though the local domain field doesn't — Prisma's upsert()
      // rejects any unrecognized key in its data object outright, which is exactly what "Invalid
      // `prisma.employee.upsert()` invocation" meant here: these were pushed as bare
      // defaultAllowances/defaultDeductions, which don't exist as columns on the Employee model.
      defaultAllowancesJson: e.defaultAllowances,
      defaultDeductionsJson: e.defaultDeductions,
      // Now sent (read from the RAW row, not `e` — mapEmployeeRow deliberately keeps these out of
      // the domain type for every OTHER local use, e.g. never rendered in the UI). A device that
      // never sees this employee's real secret can't let them log in with their existing PIN after
      // a disaster-recovery restore — see APPLY_CONFIG.employees' own comment for the reasoning on
      // why this is an acceptable risk to accept for that goal.
      pinHash: row.pin_hash,
      passwordHash: row.password_hash,
      // Still deliberately NOT sent: failedLoginAttempts/lockedUntil (live local security state,
      // meaningless off-device), photoPath (no shared cloud image storage yet).
      localCreatedAt: e.createdAt,
      localUpdatedAt: e.updatedAt,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  roles: (id) => {
    const row = roleRepository.findRoleRowById(id);
    if (!row) return null;
    const r = roleRepository.mapRoleRow(row);
    return {
      id: r.id,
      roleName: r.roleName,
      description: r.description,
      permissionsJson: r.permissions,
      isSystemRole: r.isSystemRole,
      isSuperAdmin: r.isSuperAdmin,
      localCreatedAt: r.createdAt,
      localUpdatedAt: r.updatedAt,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  locations: (id) => {
    const row = locationRepository.findLocationRowById(id);
    if (!row) return null;
    return {
      id: row.id,
      locationCode: row.location_code,
      locationName: row.location_name,
      displayName: row.display_name,
      locationType: row.location_type,
      // logo_path/logo_ratio deliberately NOT sent — local file path, no shared cloud image
      // storage yet (same precedent as Employee.photoPath/Product.imagePath).
      phone: row.phone,
      alternativePhone: row.alternative_phone,
      email: row.email,
      country: row.country,
      county: row.county,
      city: row.city,
      physicalAddress: row.physical_address,
      buildingName: row.building_name,
      floorRoom: row.floor_room,
      postalAddress: row.postal_address,
      latitude: row.latitude,
      longitude: row.longitude,
      googleMapsLink: row.google_maps_link,
      managerName: row.manager_name,
      managerPhone: row.manager_phone,
      managerEmail: row.manager_email,
      openingTime: row.opening_time,
      closingTime: row.closing_time,
      workingDays: row.working_days,
      defaultTaxRate: row.default_tax_rate,
      allowNegativeStock: Boolean(row.allow_negative_stock),
      priceLevel: row.price_level,
      isInventoryLocation: Boolean(row.is_inventory_location),
      canReceiveStock: Boolean(row.can_receive_stock),
      canSellStock: Boolean(row.can_sell_stock),
      canTransferStock: Boolean(row.can_transfer_stock),
      status: row.status,
      description: row.description,
      notes: row.notes,
      receiptHeader: row.receipt_header,
      receiptFooter: row.receipt_footer,
      invoiceHeader: row.invoice_header,
      invoiceFooter: row.invoice_footer,
      quotationHeader: row.quotation_header,
      quotationFooter: row.quotation_footer,
      showProductImagesOnInvoices: Boolean(row.show_product_images_on_invoices),
      showProductImagesOnQuotations: Boolean(row.show_product_images_on_quotations),
      defaultIncludeBusinessInfo: Boolean(row.default_include_business_info),
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  sales: (id) => {
    const row = saleRepository.findSaleRowById(id);
    if (!row) return null;

    const itemRows = getDatabase()
      .prepare("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY created_at ASC")
      .all(id) as Array<{
      id: string;
      product_id: string;
      quantity: number;
      unit_price_cents: number;
      discount_amount_cents: number;
      tax_type: string;
      tax_amount_cents: number;
      line_total_cents: number;
      is_locally_sourced: number;
      local_cost_cents: number | null;
      local_supplier_id: string | null;
      created_at: string;
    }>;
    const items = itemRows.map((i) => ({
      id: i.id,
      // Alias-translate before push — see resolveRef's pull-side counterpart in the apply
      // functions below for the full reasoning (a natural-key merge on "products" can supersede
      // this device's own local id with a different cloud id at any time).
      productId: resolveCloudRef("products", i.product_id),
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      discountAmountCents: i.discount_amount_cents,
      taxType: i.tax_type,
      taxAmountCents: i.tax_amount_cents,
      lineTotalCents: i.line_total_cents,
      isLocallySourced: Boolean(i.is_locally_sourced),
      localCostCents: i.local_cost_cents,
      localSupplierId: resolveCloudRef("suppliers", i.local_supplier_id),
      createdAt: i.created_at
    }));

    const serviceCharges = serviceChargeRepository.findServiceChargeRowsForSale(id).map((s) => ({
      id: s.id,
      name: s.name,
      feeCents: s.fee_cents,
      costCents: s.cost_cents,
      createdAt: s.created_at
    }));

    const deliveryRow = deliveryNoteRepository.findDeliveryNoteRowBySaleId(id);
    const delivery = deliveryRow
      ? {
          id: deliveryRow.id,
          deliveryNoteNumber: deliveryRow.delivery_note_number,
          riderId: resolveCloudRef("riders", deliveryRow.rider_id),
          recipientName: deliveryRow.recipient_name,
          country: deliveryRow.country,
          town: deliveryRow.town,
          physicalAddress: deliveryRow.physical_address,
          notes: deliveryRow.notes,
          feeCents: deliveryRow.fee_cents,
          costCents: deliveryRow.cost_cents,
          isDelivered: Boolean(deliveryRow.is_delivered),
          deliveredAt: deliveryRow.delivered_at,
          createdAt: deliveryRow.created_at,
          updatedAt: deliveryRow.updated_at
        }
      : null;

    return {
      id: row.id,
      receiptNumber: row.receipt_number,
      locationId: row.location_id,
      employeeId: row.employee_id,
      customerId: row.customer_id,
      saleStatus: row.sale_status,
      subtotalCents: row.subtotal_cents,
      discountAmountCents: row.discount_amount_cents,
      taxAmountCents: row.tax_amount_cents,
      grandTotalCents: row.grand_total_cents,
      paymentMethodId: row.payment_method_id,
      paymentReference: row.payment_reference,
      amountReceivedCents: row.amount_received_cents,
      changeGivenCents: row.change_given_cents,
      notes: row.notes,
      completedAt: row.completed_at,
      transactionType: row.transaction_type,
      paymentStatus: row.payment_status,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      dueDate: row.due_date,
      amountPaidCents: row.amount_paid_cents,
      balanceDueCents: row.balance_due_cents,
      invoiceNotes: row.invoice_notes,
      includeTaxBreakdown: Boolean(row.include_tax_breakdown),
      includeBusinessInfo: Boolean(row.include_business_info),
      payments: JSON.parse(row.payments) as unknown,
      items,
      serviceCharges,
      delivery,
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  expense_categories: (id) => {
    const row = expenseCategoryRepository.findExpenseCategoryRowById(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  expenses: (id) => {
    const row = expenseRepository.findExpenseRowById(id);
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      expenseNumber: row.expense_number,
      expenseDate: row.expense_date,
      categoryId: row.category_id,
      amountCents: row.amount_cents,
      paidBy: row.paid_by,
      paymentMethodId: row.payment_method_id,
      storefrontId: row.storefront_id,
      reference: row.reference,
      description: row.description,
      // attachmentPath deliberately NOT sent — local file path, no shared cloud storage yet.
      status: row.status,
      isRecurring: Boolean(row.is_recurring),
      recurrenceFrequency: row.recurrence_frequency,
      nextDueDate: row.next_due_date,
      lastReminderSent: row.last_reminder_sent,
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  salaries: (id) => {
    const row = salaryRepository.findSalaryRowById(id);
    if (!row) return null;
    return {
      id: row.id,
      payslipNumber: row.payslip_number,
      employeeId: row.employee_id,
      payPeriod: row.pay_period,
      basicSalaryCents: row.basic_salary_cents,
      allowancesCents: row.allowances_cents,
      deductionsCents: row.deductions_cents,
      netPayCents: row.net_pay_cents,
      paymentMethodId: row.payment_method_id,
      paymentReference: row.payment_reference,
      status: row.status,
      notes: row.notes,
      allowancesJson: JSON.parse(row.allowances_json) as unknown,
      deductionsJson: JSON.parse(row.deductions_json) as unknown,
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  recurring_bills: (id) => {
    const row = recurringBillRepository.findRecurringBillRowById(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      categoryId: row.category_id,
      storefrontId: row.storefront_id,
      amountCents: row.amount_cents,
      cycle: row.cycle,
      startDate: row.start_date,
      nextDueDate: row.next_due_date,
      status: row.status,
      notes: row.notes,
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  sale_voids: (id) => {
    const row = saleVoidRepository.findSaleVoidRowById(id);
    if (!row) return null;
    return {
      id: row.id,
      saleId: row.sale_id,
      status: row.status,
      reason: row.reason,
      notes: row.notes,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  // Same shape as sale_voids — see invoice-cancellation-service.ts's own doc comment for why this is
  // a genuinely separate entity rather than a reuse of sale_voids.
  invoice_cancellations: (id) => {
    const row = invoiceCancellationRepository.findInvoiceCancellationRowById(id);
    if (!row) return null;
    return {
      id: row.id,
      saleId: row.sale_id,
      status: row.status,
      reason: row.reason,
      notes: row.notes,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  sale_returns: (id) => {
    const row = saleReturnRepository.findSaleReturnRowById(id);
    if (!row) return null;
    const itemRows = getDatabase()
      .prepare("SELECT * FROM sale_return_items WHERE sale_return_id = ? ORDER BY created_at ASC")
      .all(id) as Array<{
      id: string;
      sale_item_id: string;
      product_id: string;
      quantity: number;
      unit_price_cents: number;
      line_total_cents: number;
      created_at: string;
    }>;
    return {
      id: row.id,
      saleId: row.sale_id,
      status: row.status,
      reason: row.reason,
      notes: row.notes,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      items: itemRows.map((i) => ({
        id: i.id,
        saleItemId: i.sale_item_id,
        // Alias-translate before push — see resolveRef's pull-side counterpart in the apply
        // functions below for the full reasoning (a natural-key merge on "products" can supersede
        // this device's own local id with a different cloud id at any time).
        productId: resolveCloudRef("products", i.product_id),
        quantity: i.quantity,
        unitPriceCents: i.unit_price_cents,
        lineTotalCents: i.line_total_cents,
        createdAt: i.created_at
      })),
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  quotations: (id) => {
    const row = quotationRepository.findQuotationRowById(id);
    if (!row) return null;

    const itemRows = getDatabase()
      .prepare("SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY created_at ASC")
      .all(id) as Array<{
      id: string;
      product_id: string;
      quantity: number;
      unit_price_cents: number;
      discount_amount_cents: number;
      tax_type: string;
      tax_amount_cents: number;
      line_total_cents: number;
      is_locally_sourced: number;
      local_cost_cents: number | null;
      local_supplier_id: string | null;
      created_at: string;
    }>;
    const items = itemRows.map((i) => ({
      id: i.id,
      // Alias-translate before push — see resolveRef's pull-side counterpart in the apply
      // functions below for the full reasoning (a natural-key merge on "products" can supersede
      // this device's own local id with a different cloud id at any time).
      productId: resolveCloudRef("products", i.product_id),
      quantity: i.quantity,
      unitPriceCents: i.unit_price_cents,
      discountAmountCents: i.discount_amount_cents,
      taxType: i.tax_type,
      taxAmountCents: i.tax_amount_cents,
      lineTotalCents: i.line_total_cents,
      isLocallySourced: Boolean(i.is_locally_sourced),
      localCostCents: i.local_cost_cents,
      localSupplierId: resolveCloudRef("suppliers", i.local_supplier_id),
      createdAt: i.created_at
    }));

    const serviceCharges = serviceChargeRepository.findServiceChargeRowsForQuotation(id).map((s) => ({
      id: s.id,
      name: s.name,
      feeCents: s.fee_cents,
      costCents: s.cost_cents,
      createdAt: s.created_at
    }));

    const deliveryRow = deliveryNoteRepository.findDeliveryNoteRowByQuotationId(id);
    const delivery = deliveryRow
      ? {
          id: deliveryRow.id,
          deliveryNoteNumber: deliveryRow.delivery_note_number,
          riderId: resolveCloudRef("riders", deliveryRow.rider_id),
          recipientName: deliveryRow.recipient_name,
          country: deliveryRow.country,
          town: deliveryRow.town,
          physicalAddress: deliveryRow.physical_address,
          notes: deliveryRow.notes,
          feeCents: deliveryRow.fee_cents,
          costCents: deliveryRow.cost_cents,
          isDelivered: Boolean(deliveryRow.is_delivered),
          deliveredAt: deliveryRow.delivered_at,
          createdAt: deliveryRow.created_at,
          updatedAt: deliveryRow.updated_at
        }
      : null;

    return {
      id: row.id,
      quotationNumber: row.quotation_number,
      customerId: row.customer_id,
      locationId: row.location_id,
      employeeId: row.employee_id,
      status: row.status,
      subtotalCents: row.subtotal_cents,
      discountAmountCents: row.discount_amount_cents,
      taxAmountCents: row.tax_amount_cents,
      grandTotalCents: row.grand_total_cents,
      validUntil: row.valid_until,
      notes: row.notes,
      includeTaxBreakdown: Boolean(row.include_tax_breakdown),
      includeBusinessInfo: Boolean(row.include_business_info),
      convertedSaleId: row.converted_sale_id,
      convertedAt: row.converted_at,
      items,
      serviceCharges,
      delivery,
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  },
  purchases: (id) => {
    const row = purchaseRepository.findPurchaseRowById(id);
    if (!row) return null;

    const itemRows = getDatabase()
      .prepare("SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY created_at ASC")
      .all(id) as Array<{
      id: string;
      product_id: string;
      ordered_quantity: number;
      received_quantity: number;
      unit_cost_cents: number;
      selling_price_cents: number | null;
      discount_amount_cents: number;
      tax_type: string;
      tax_amount_cents: number;
      line_total_cents: number;
      created_at: string;
      updated_at: string;
    }>;
    const items = itemRows.map((i) => ({
      id: i.id,
      // Alias-translate before push — see resolveRef's pull-side counterpart in the apply
      // functions below for the full reasoning (a natural-key merge on "products" can supersede
      // this device's own local id with a different cloud id at any time).
      productId: resolveCloudRef("products", i.product_id),
      orderedQuantity: i.ordered_quantity,
      receivedQuantity: i.received_quantity,
      unitCostCents: i.unit_cost_cents,
      sellingPriceCents: i.selling_price_cents,
      discountAmountCents: i.discount_amount_cents,
      taxType: i.tax_type,
      taxAmountCents: i.tax_amount_cents,
      lineTotalCents: i.line_total_cents,
      createdAt: i.created_at,
      updatedAt: i.updated_at
    }));

    return {
      id: row.id,
      purchaseNumber: row.purchase_number,
      supplierId: row.supplier_id,
      supplierInvoiceNumber: row.supplier_invoice_number,
      locationId: row.location_id,
      status: row.status,
      taxType: row.tax_type,
      subtotalCents: row.subtotal_cents,
      discountAmountCents: row.discount_amount_cents,
      taxAmountCents: row.tax_amount_cents,
      shippingCostCents: row.shipping_cost_cents,
      grandTotalCents: row.grand_total_cents,
      paymentMethodId: row.payment_method_id,
      paymentReference: row.payment_reference,
      paymentStatus: row.payment_status,
      amountPaidCents: row.amount_paid_cents,
      payments: JSON.parse(row.payments) as unknown,
      receivingEvents: JSON.parse(row.receiving_events) as unknown,
      notes: row.notes,
      // attachmentPath deliberately NOT sent — local file path, no shared cloud storage yet.
      orderedAt: row.ordered_at,
      receivedAt: row.received_at,
      items,
      localCreatedAt: row.created_at,
      localUpdatedAt: row.updated_at,
      baseUpdatedAt: row.synced_updated_at
    };
  }
};

/** Safety net, run at the start of every push cycle (timer-driven or manual "Sync Now"): finds any
 * row whose OWN sync_status isn't 'synced' but that — for whatever reason — has no matching
 * pending outbox entry, and enqueues one. Triggers are the primary queueing mechanism, but they can
 * only ever cover writes that happen AFTER they exist; this sweep is what makes the whole
 * mechanism self-healing regardless of that (a migration backfill that didn't run yet, a future
 * bug, a manual DB edit, anything). This is also the direct answer to "manual sync should resolve
 * count errors" — a drift caused by never-enqueued rows gets fixed by the very next push, timer or
 * manual, without needing a special "resync everything" button. */
function enqueueUnsyncedRows(): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  for (const entity of SYNC_ENTITIES) {
    // A held ("pending") sale's sync_status is permanently 'pending' by design — it never syncs
    // (see migration 51) — so without this exclusion, this generic self-healing sweep would
    // re-discover it every single cycle and enqueue it anyway, defeating the trigger-level guard.
    const extraCondition = entity === "sales" ? " AND sale_status != 'pending'" : "";
    const rows = db
      .prepare(
        `SELECT id, tenant_id FROM ${entity}
         WHERE sync_status != 'synced'${extraCondition}
           AND id NOT IN (SELECT entity_id FROM sync_outbox WHERE entity = ? AND status IN ('queued', 'failed', 'conflict'))`
      )
      .all(entity) as Array<{ id: string; tenant_id: string }>;

    for (const row of rows) {
      db.prepare(
        `INSERT INTO sync_outbox (id, tenant_id, client_id, entity, entity_id, operation, direction, status, attempt_count, payload_json, idempotency_key, created_at, updated_at)
         VALUES (?, ?, (SELECT client_id FROM tenant WHERE id = ?), ?, ?, 'upsert', 'push', 'queued', 0, '{}', ?, ?, ?)`
      ).run(
        randomUUID(),
        row.tenant_id,
        row.tenant_id,
        entity,
        row.id,
        `${row.id}:reconcile:${randomUUID()}`,
        now,
        now
      );
    }
  }
}

type OutboxGroup = { entity: SyncEntity; entityId: string; isDelete: boolean };

function loadPendingOutboxGroups(): OutboxGroup[] {
  const rows = getDatabase()
    .prepare(
      `SELECT entity, entity_id, MAX(CASE WHEN operation = 'delete' THEN 1 ELSE 0 END) AS is_delete
       FROM sync_outbox
       WHERE status IN ('queued', 'failed')
       GROUP BY entity, entity_id`
    )
    .all() as Array<{ entity: SyncEntity; entity_id: string; is_delete: number }>;

  return rows.map((r) => ({ entity: r.entity, entityId: r.entity_id, isDelete: r.is_delete === 1 }));
}

function markOutboxSynced(entity: SyncEntity, entityId: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE sync_outbox SET status = 'synced', updated_at = ?
       WHERE entity = ? AND entity_id = ? AND status IN ('queued', 'failed')`
    )
    .run(now, entity, entityId);
}

function markOutboxFailed(entity: SyncEntity, entityId: string, error: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE sync_outbox SET status = 'failed', attempt_count = attempt_count + 1, last_error = ?, updated_at = ?
       WHERE entity = ? AND entity_id = ? AND status IN ('queued', 'failed')`
    )
    .run(error, now, entity, entityId);
}

/** The losing device's own push attempt is rejected — see sync-service.ts's pushRows (SERVER) for
 * the optimistic-lock check that produces this. Only the server's current row (the other half of
 * the diff) needs storing here — the local side is deliberately left untouched (the user's edit
 * stays exactly as they left it until they explicitly resolve via sync:resolve-conflict), so
 * listConflicts() reads it live off the local row itself at render time rather than needing a
 * snapshot captured here. */
function markOutboxConflict(entity: SyncEntity, entityId: string, serverRow: unknown): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE sync_outbox SET status = 'conflict', remote_snapshot_json = ?, updated_at = ?
       WHERE entity = ? AND entity_id = ? AND status IN ('queued', 'failed')`
    )
    .run(JSON.stringify(serverRow), now, entity, entityId);
}

/** table name === entity name for every synced entity — see shared/types/sync.ts. */
function markSourceRowSynced(entity: SyncEntity, id: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(`UPDATE ${entity} SET sync_status = 'synced', last_synced_at = ? WHERE id = ?`)
    .run(now, id);
}

/** Only for CONFLICT_AWARE_ENTITIES — caches the value just confirmed as the server's current
 * truth (either just pushed successfully, or just pulled) as the new optimistic-lock baseline for
 * this row's NEXT push. */
function markSyncedBaseline(entity: SyncEntity, id: string, localUpdatedAt: string): void {
  if (!CONFLICT_AWARE_ENTITIES.has(entity)) return;
  getDatabase().prepare(`UPDATE ${entity} SET synced_updated_at = ? WHERE id = ?`).run(localUpdatedAt, id);
}

/** Rows per /sync/push HTTP call. This is what caps request body size, NOT a limit on how many
 * rows can be queued overall — pushOutbox below slices the full per-entity backlog into chunks of
 * this size and posts them one at a time. Needed because a brand-new entity's first sync can
 * enqueue years of pre-existing history in one go (enqueueUnsyncedRows' backfill sweep): a real
 * tenant's 2013 sales, each carrying nested items/serviceCharges/delivery, serialized to ~3.4MB in
 * one request — comfortably over Express's default 100kb json() body limit (SERVER's app.ts now
 * raises that to 10mb too, but chunking is the real fix; the raised limit is just headroom for a
 * single unusually heavy document, not a license to send the whole backlog in one shot again). A
 * single flat-entity row (categories, riders, etc.) is a few hundred bytes, so 200 rows is small
 * even for the heaviest documents (sales/quotations/purchases/sale_returns) at realistic item
 * counts. Mirrors the pull side's own PULL_PAGE_SIZE — same idea, opposite direction. */
const PUSH_BATCH_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function pushBatch(
  tenantId: string,
  deviceId: string,
  entity: SyncEntity,
  rows: Array<{ entityId: string; payload: Record<string, unknown> }>
): Promise<void> {
  if (rows.length === 0) return;

  for (const batch of chunk(rows, PUSH_BATCH_SIZE)) {
    await pushOneBatch(tenantId, deviceId, entity, batch);
  }
}

async function pushOneBatch(
  tenantId: string,
  deviceId: string,
  entity: SyncEntity,
  rows: Array<{ entityId: string; payload: Record<string, unknown> }>
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, deviceId, entity, rows: rows.map((r) => r.payload) }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (err) {
    // Offline/unreachable — every row stays queued/failed for the next cycle. Never throws, but
    // DOES log — this exact path (silent, unlogged) is what let a 413 from an oversized request go
    // unnoticed for hours in production. See PUSH_BATCH_SIZE above.
    console.error(`[sync] Push request failed for ${entity} (${rows.length} rows):`, err);
    return;
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    console.error(
      `[sync] Push rejected for ${entity} (${rows.length} rows): HTTP ${response.status} ${bodyText.slice(0, 500)}`
    );
    return; // e.g. license suspended mid-sync — leave everything queued, try again next cycle.
  }

  const body = (await response.json().catch(() => null)) as {
    results: Array<{ id: string; status: string; error?: string; serverRow?: unknown; canonicalId?: string }>;
  } | null;
  if (!body) return;

  const byId = new Map(rows.map((r) => [r.entityId, r.payload]));

  // Each result is applied independently — the server has ALREADY durably committed every "ok"/
  // "aliased" row in this batch by the time this loop runs, so one row's LOCAL bookkeeping throwing
  // (e.g. a transient SQLite lock) must never stop the rest of an already-successful batch from
  // being marked synced. Before this, an uncaught throw here would abort the loop silently, leave
  // every row from that point on stuck at "queued"/attempt_count 0 forever (nothing re-throws to
  // mark them failed for retry), AND propagate up through pushOutbox()'s un-awaited caller in
  // bootstrap.ts as an unhandled rejection — invisible in the exact same way the pre-chunking 413
  // bug was invisible. Caught live: 7 of 9 employee rows the server had already accepted stayed
  // stuck locally after one row's processing failed partway through this exact loop.
  for (const result of body.results) {
    try {
      if (result.status === "ok") {
        markOutboxSynced(entity, result.id);
        markSourceRowSynced(entity, result.id);
        const payload = byId.get(result.id);
        if (payload) markSyncedBaseline(entity, result.id, payload.localUpdatedAt as string);
      } else if (result.status === "conflict") {
        markOutboxConflict(entity, result.id, result.serverRow);
      } else if (result.status === "aliased" && result.canonicalId) {
        // The server already had a row for this same natural key (roles/employees/payment_methods/
        // expense_categories/locations — see SERVER's own NATURAL_KEY_FIELDS) under a different id,
        // and refused to create a duplicate. SERVER writes this row's actual content to the
        // canonical row instead (see sync-service.ts's pushRows: targetId/aliasedCanonicalId), so
        // nothing pushed here is lost even on a later edit to the aliased local row — record the
        // same alias pull-time reconciliation already uses (recordIdAlias), so any future payload
        // referencing the server's canonical id resolves to this device's local row correctly, and
        // mark this row synced — it's safely represented server-side now, just under a different id
        // than this device generated. (Before 2026-08-25, SERVER discarded the row's content on
        // every aliased push instead of writing it to the canonical row — harmless the instant an
        // alias was first created, since both rows were then still identical, but silently dropped
        // every subsequent edit forever after.)
        recordIdAlias(entity, result.canonicalId, result.id);
        markOutboxSynced(entity, result.id);
        markSourceRowSynced(entity, result.id);
      } else {
        markOutboxFailed(entity, result.id, result.error ?? "Unknown error");
      }
    } catch (err) {
      console.error(`[sync] Failed to apply push result for ${entity}/${result.id}:`, err);
    }
  }
}

/** Drains every queued/failed outbox row — batched per entity into one /sync/push call each. Each
 * row's payload is re-read fresh from its own table right before sending (via PAYLOAD_BUILDERS),
 * not replayed from whatever the trigger captured at write time — so several edits made between
 * sync cycles collapse into a single push of current state.
 *
 * Hard DELETEs are a known Phase-1 limitation: there is no /sync/delete endpoint yet (see the
 * plan's own reasoning — building real tombstone propagation is deferred). A local delete just
 * marks its own outbox breadcrumb synced without a server call, leaving a stale copy on the cloud.
 * This is exactly the kind of thing checkDrift() below is FOR — it'll show up as a count mismatch,
 * a signal to investigate, not silent data corruption. Only categories/employees/roles even have a
 * delete path today; the rest never hit this branch. */
export async function pushOutbox(): Promise<void> {
  const identity = getCloudIdentity();
  if (!identity) return;

  enqueueUnsyncedRows();

  const groups = loadPendingOutboxGroups();
  if (groups.length === 0) {
    writeSetting("sync_last_push_at", new Date().toISOString());
    return;
  }

  const byEntity = new Map<SyncEntity, OutboxGroup[]>();
  for (const group of groups) {
    const list = byEntity.get(group.entity) ?? [];
    list.push(group);
    byEntity.set(group.entity, list);
  }

  for (const [entity, items] of byEntity) {
    for (const item of items.filter((i) => i.isDelete)) {
      markOutboxSynced(entity, item.entityId);
    }

    const upsertRows = items
      .filter((i) => !i.isDelete)
      .map((i) => ({ entityId: i.entityId, payload: PAYLOAD_BUILDERS[entity](i.entityId) }))
      .filter((r): r is { entityId: string; payload: Record<string, unknown> } => r.payload !== null)
      .map((r) => ({ entityId: r.entityId, payload: resolvePayloadRefsForPush(entity, r.payload) }));

    await pushBatch(identity.tenantId, identity.deviceId, entity, upsertRows);
  }

  writeSetting("sync_last_push_at", new Date().toISOString());
}

// ---------------------------------------------------------------------------------------------
// PULL — apply deltas from the cloud
// ---------------------------------------------------------------------------------------------

type ColumnMap = {
  local: string;
  cloud: string;
  type?: "bool" | "json";
  /** Set when this column stores the id of one of the five naturalKey-bearing entities (roles,
   * employees, payment_methods, expense_categories, locations) — the incoming value is resolved
   * through resolveRef() before use, in case it was reconciled under a different local id. */
  refEntity?: SyncEntity;
  /** This column is NOT NULL locally, so resolveRefOrNull's "fall back to null when unresolvable"
   * behavior would just trade an FK violation for a NOT NULL one — no better. Uses resolveRef
   * instead (alias-translate if a merge happened, otherwise pass the raw id through unchanged and
   * let the FK check throw so the existing 2-pass-then-retry-next-cycle mechanism handles it, same
   * as every NOT NULL item-level ref like sale_items.product_id already does). Caught live: a fresh
   * device's very first sync threw straight through sale_returns.sale_id/sale_voids.sale_id being
   * resolved to null via the unconditional resolveRefOrNull this column map used before this flag
   * existed. */
  refNotNull?: boolean;
  /** Fallback for a NOT NULL column when an older device's payload was built before this field
   * existed (so the key is simply absent, not explicitly null). SQLite only applies a column's own
   * DEFAULT when the column is omitted from the INSERT — an explicit NULL bind still violates NOT
   * NULL — so without this the older payload would throw here instead of falling back. */
  default?: SQLInputValue;
};
type EntityApplyConfig = {
  table: string;
  columns: ColumnMap[];
  /** Set only for entities with a boot-time "ensureDefaultX" local seed (default roles, the SYSTEM
   * employee, default payment methods/expense categories, the Main Store location) — every such
   * table has its own real UNIQUE(tenant_id, <this column>) constraint. Two independently-seeded
   * devices generate the SAME name/code with DIFFERENT ids, so pulling one device's version onto
   * the other would otherwise permanently fail that row's insert (see applyPulledRow's own comment
   * on why this exists — found live via real two-device testing). */
  naturalKey?: ColumnMap;
};

// Partial, not Record<SyncEntity, ...> — BESPOKE_APPLY_ENTITIES (currently just "sales") are routed
// to their own apply function before this map is ever consulted, so they deliberately have no entry.
const APPLY_CONFIG: Partial<Record<SyncEntity, EntityApplyConfig>> = {
  categories: {
    table: "categories",
    columns: [
      { local: "parent_id", cloud: "parentId", refEntity: "categories" },
      { local: "name", cloud: "name" },
      { local: "description", cloud: "description" },
      { local: "color", cloud: "color" },
      { local: "level", cloud: "level" },
      { local: "sort_order", cloud: "sortOrder" },
      { local: "status", cloud: "status" }
    ]
  },
  payment_methods: {
    table: "payment_methods",
    naturalKey: { local: "code", cloud: "code" },
    columns: [
      { local: "name", cloud: "name" },
      { local: "code", cloud: "code" },
      { local: "description", cloud: "description" },
      { local: "is_system_method", cloud: "isSystemMethod", type: "bool" },
      { local: "is_active", cloud: "isActive", type: "bool" },
      { local: "requires_reference", cloud: "requiresReference", type: "bool" },
      { local: "sort_order", cloud: "sortOrder" }
    ]
  },
  riders: {
    table: "riders",
    columns: [
      { local: "name", cloud: "name" },
      { local: "phone", cloud: "phone" },
      { local: "alt_phone", cloud: "altPhone" },
      { local: "company", cloud: "company" },
      { local: "vehicle_description", cloud: "vehicleDescription" },
      { local: "status", cloud: "status" }
    ]
  },
  suppliers: {
    table: "suppliers",
    columns: [
      { local: "supplier_code", cloud: "supplierCode" },
      { local: "business_name", cloud: "businessName" },
      { local: "contact_person", cloud: "contactPerson" },
      { local: "phone_1", cloud: "phone1" },
      { local: "phone_2", cloud: "phone2" },
      { local: "email", cloud: "email" },
      { local: "kra_pin", cloud: "kraPin" },
      { local: "website", cloud: "website" },
      { local: "country", cloud: "country" },
      { local: "county", cloud: "county" },
      { local: "town", cloud: "town" },
      { local: "physical_address", cloud: "physicalAddress" },
      { local: "payment_option", cloud: "paymentOption" },
      { local: "mpesa_name", cloud: "mpesaName" },
      { local: "mpesa_number", cloud: "mpesaNumber" },
      { local: "mpesa_alternative_number", cloud: "mpesaAlternativeNumber" },
      { local: "bank_name", cloud: "bankName" },
      { local: "bank_account_name", cloud: "bankAccountName" },
      { local: "bank_account_number", cloud: "bankAccountNumber" },
      { local: "credit_limit_cents", cloud: "creditLimitCents" },
      { local: "status", cloud: "status" },
      { local: "notes", cloud: "notes" }
    ]
  },
  customers: {
    table: "customers",
    columns: [
      { local: "customer_code", cloud: "customerCode" },
      { local: "customer_type", cloud: "customerType" },
      { local: "name", cloud: "name" },
      { local: "phone", cloud: "phone" },
      { local: "email", cloud: "email" },
      { local: "kra_pin", cloud: "kraPin" },
      { local: "physical_address", cloud: "physicalAddress" },
      { local: "credit_limit_cents", cloud: "creditLimitCents" },
      // current_balance_cents deliberately excluded — see PAYLOAD_BUILDERS.customers's own comment.
      // location_id likewise never synced at all (see project memory) — not added here either.
      { local: "notes", cloud: "notes" },
      { local: "status", cloud: "status" }
    ]
  },
  products: {
    table: "products",
    columns: [
      { local: "sku", cloud: "sku" },
      { local: "barcode", cloud: "barcode" },
      { local: "supplier_sku", cloud: "supplierSku" },
      { local: "name", cloud: "name" },
      { local: "short_name", cloud: "shortName" },
      { local: "description", cloud: "description" },
      { local: "category_id", cloud: "categoryId", refEntity: "categories" },
      { local: "storefront_id", cloud: "storefrontId", refEntity: "locations" },
      { local: "unit_of_measure", cloud: "unitOfMeasure" },
      { local: "buying_price_cents", cloud: "buyingPriceCents" },
      { local: "selling_price_cents", cloud: "sellingPriceCents" },
      { local: "wholesale_price_cents", cloud: "wholesalePriceCents" },
      { local: "wholesale_min_quantity", cloud: "wholesaleMinQuantity" },
      { local: "minimum_price_cents", cloud: "minimumPriceCents" },
      { local: "tax_rate", cloud: "taxRate" },
      { local: "tax_type", cloud: "taxType", default: "vat" },
      // Genuinely tri-state (null = inherit the tenant default) — toLocalValue checks value === null
      // BEFORE checking col.type, so a pulled null cloud value stays null (no `default` is set here,
      // so `col.default ?? null` resolves to null) while an actual true/false still goes through the
      // "bool" branch to become 1/0, which better-sqlite3 requires (it can't bind raw JS booleans).
      { local: "prices_tax_inclusive", cloud: "pricesTaxInclusive", type: "bool" },
      { local: "reorder_level", cloud: "reorderLevel" },
      { local: "track_stock", cloud: "trackStock", type: "bool" },
      { local: "allow_negative_stock", cloud: "allowNegativeStock", type: "bool" },
      { local: "status", cloud: "status" }
    ]
  },
  employees: {
    // pin_hash/password_hash now included (were deliberately excluded through Phase 1-5 — see
    // PAYLOAD_BUILDERS.employees' own comment for the reasoning on why that changed): a device
    // restored from a disaster-recovery pull must let an employee log in with their EXISTING PIN,
    // not force everyone to be re-onboarded. Still deliberately excludes failed_login_attempts/
    // locked_until/photo_path — none of those exist in the cloud payload at all (live local
    // security state or a local file path, neither meaningful off-device).
    table: "employees",
    naturalKey: { local: "employee_code", cloud: "employeeCode" },
    columns: [
      { local: "employee_code", cloud: "employeeCode" },
      { local: "first_name", cloud: "firstName" },
      { local: "middle_name", cloud: "middleName" },
      { local: "last_name", cloud: "lastName" },
      { local: "gender", cloud: "gender" },
      { local: "date_of_birth", cloud: "dateOfBirth" },
      { local: "phone", cloud: "phone" },
      { local: "alternative_phone", cloud: "alternativePhone" },
      { local: "email", cloud: "email" },
      { local: "branch_id", cloud: "branchId", refEntity: "locations" },
      { local: "department", cloud: "department" },
      { local: "job_title", cloud: "jobTitle" },
      { local: "hire_date", cloud: "hireDate" },
      { local: "role_id", cloud: "roleId", refEntity: "roles" },
      { local: "username", cloud: "username" },
      { local: "status", cloud: "status" },
      { local: "pin_hash", cloud: "pinHash" },
      { local: "password_hash", cloud: "passwordHash" },
      { local: "default_basic_salary_cents", cloud: "defaultBasicSalaryCents" },
      // default: "[]" (a pre-stringified string, not a JS array) — toLocalValue's null/undefined
      // branch returns col.default as-is, BEFORE the type:"json" branch would normally stringify it,
      // so this must already be the exact TEXT this NOT NULL column expects. Needed so an older
      // device's payload that predates this feature (missing these keys entirely) doesn't crash
      // trying to bind undefined into a NOT NULL column — same bug class as
      // [[project_syncedat_update_propagation_bug]]'s sibling issues this session.
      { local: "default_allowances_json", cloud: "defaultAllowancesJson", type: "json", default: "[]" },
      { local: "default_deductions_json", cloud: "defaultDeductionsJson", type: "json", default: "[]" }
    ]
  },
  roles: {
    table: "roles",
    naturalKey: { local: "role_name", cloud: "roleName" },
    columns: [
      { local: "role_name", cloud: "roleName" },
      { local: "description", cloud: "description" },
      { local: "permissions_json", cloud: "permissionsJson", type: "json" },
      { local: "is_system_role", cloud: "isSystemRole", type: "bool" },
      { local: "is_super_admin", cloud: "isSuperAdmin", type: "bool", default: 0 }
    ]
  },
  locations: {
    table: "locations",
    naturalKey: { local: "location_code", cloud: "locationCode" },
    columns: [
      { local: "location_code", cloud: "locationCode" },
      { local: "location_name", cloud: "locationName" },
      { local: "display_name", cloud: "displayName" },
      { local: "location_type", cloud: "locationType" },
      { local: "phone", cloud: "phone" },
      { local: "alternative_phone", cloud: "alternativePhone" },
      { local: "email", cloud: "email" },
      { local: "country", cloud: "country" },
      { local: "county", cloud: "county" },
      { local: "city", cloud: "city" },
      { local: "physical_address", cloud: "physicalAddress" },
      { local: "building_name", cloud: "buildingName" },
      { local: "floor_room", cloud: "floorRoom" },
      { local: "postal_address", cloud: "postalAddress" },
      { local: "latitude", cloud: "latitude" },
      { local: "longitude", cloud: "longitude" },
      { local: "google_maps_link", cloud: "googleMapsLink" },
      { local: "manager_name", cloud: "managerName" },
      { local: "manager_phone", cloud: "managerPhone" },
      { local: "manager_email", cloud: "managerEmail" },
      { local: "opening_time", cloud: "openingTime" },
      { local: "closing_time", cloud: "closingTime" },
      { local: "working_days", cloud: "workingDays" },
      { local: "default_tax_rate", cloud: "defaultTaxRate" },
      { local: "allow_negative_stock", cloud: "allowNegativeStock", type: "bool" },
      { local: "price_level", cloud: "priceLevel" },
      { local: "is_inventory_location", cloud: "isInventoryLocation", type: "bool" },
      { local: "can_receive_stock", cloud: "canReceiveStock", type: "bool" },
      { local: "can_sell_stock", cloud: "canSellStock", type: "bool" },
      { local: "can_transfer_stock", cloud: "canTransferStock", type: "bool" },
      { local: "status", cloud: "status" },
      { local: "description", cloud: "description" },
      { local: "notes", cloud: "notes" },
      { local: "receipt_header", cloud: "receiptHeader" },
      { local: "receipt_footer", cloud: "receiptFooter" },
      { local: "invoice_header", cloud: "invoiceHeader" },
      { local: "invoice_footer", cloud: "invoiceFooter" },
      { local: "quotation_header", cloud: "quotationHeader" },
      { local: "quotation_footer", cloud: "quotationFooter" },
      // NOT NULL locally (DEFAULT 0) — an older device (pre-dating this feature) editing ANY field
      // on a storefront it owns would push a payload missing these keys entirely; without this
      // default, toLocalValue's undefined-fallback would bind a bare null into a NOT NULL column
      // and crash the pull, exactly like sale_items.local_supplier_id did before it got one.
      { local: "show_product_images_on_invoices", cloud: "showProductImagesOnInvoices", type: "bool", default: 0 },
      { local: "show_product_images_on_quotations", cloud: "showProductImagesOnQuotations", type: "bool", default: 0 },
      // Same older-device-safety reasoning as the two fields above, but this one's own column
      // default is 1 (true), not 0 — matching include_business_info's own default polarity.
      { local: "default_include_business_info", cloud: "defaultIncludeBusinessInfo", type: "bool", default: 1 }
    ]
  },
  // Not a boot-seeded default — created on-demand the first time a Super Admin configures hours for
  // a storefront (see the model's own migration comment). naturalKey dedupes the case where two
  // devices each independently create the first-ever row for the same storefront before ever
  // syncing with each other, same reasoning as main_store_allocations below.
  working_hours: {
    table: "working_hours",
    naturalKey: { local: "location_id", cloud: "locationId" },
    columns: [
      { local: "location_id", cloud: "locationId", refEntity: "locations", refNotNull: true },
      { local: "lock_enabled", cloud: "lockEnabled", type: "bool" },
      { local: "lock_mode", cloud: "lockMode" },
      { local: "manually_locked", cloud: "manuallyLocked", type: "bool" },
      { local: "timezone_offset_minutes", cloud: "timezoneOffsetMinutes" },
      { local: "schedule_json", cloud: "schedule", type: "json" }
    ]
  },
  expense_categories: {
    table: "expense_categories",
    naturalKey: { local: "name", cloud: "name" },
    columns: [
      { local: "name", cloud: "name" },
      { local: "description", cloud: "description" },
      { local: "status", cloud: "status" }
    ]
  },
  // Not a boot-seeded default like the naturalKey entities above — reconciles a DIFFERENT collision
  // (two devices each first-touching the same real bucket before ever syncing with each other). See
  // this table's own migration comment for the full story.
  main_store_allocations: {
    table: "main_store_allocations",
    naturalKey: { local: "bucket_key", cloud: "bucketKey" },
    columns: [
      { local: "product_id", cloud: "productId", refEntity: "products", refNotNull: true },
      { local: "storefront_id", cloud: "storefrontId", refEntity: "locations" },
      { local: "quantity", cloud: "quantity" },
      { local: "bucket_key", cloud: "bucketKey" }
    ]
  },
  expenses: {
    table: "expenses",
    columns: [
      { local: "kind", cloud: "kind", default: "general" },
      { local: "expense_number", cloud: "expenseNumber" },
      { local: "expense_date", cloud: "expenseDate" },
      { local: "category_id", cloud: "categoryId", refEntity: "expense_categories", refNotNull: true },
      { local: "amount_cents", cloud: "amountCents" },
      { local: "paid_by", cloud: "paidBy" },
      { local: "payment_method_id", cloud: "paymentMethodId", refEntity: "payment_methods", refNotNull: true },
      { local: "storefront_id", cloud: "storefrontId", refEntity: "locations" },
      { local: "reference", cloud: "reference" },
      { local: "description", cloud: "description" },
      { local: "status", cloud: "status" },
      { local: "is_recurring", cloud: "isRecurring", type: "bool" },
      { local: "recurrence_frequency", cloud: "recurrenceFrequency" },
      { local: "next_due_date", cloud: "nextDueDate" },
      { local: "last_reminder_sent", cloud: "lastReminderSent" }
    ]
  },
  salaries: {
    table: "salaries",
    columns: [
      { local: "payslip_number", cloud: "payslipNumber" },
      { local: "employee_id", cloud: "employeeId", refEntity: "employees", refNotNull: true },
      { local: "pay_period", cloud: "payPeriod" },
      { local: "basic_salary_cents", cloud: "basicSalaryCents" },
      { local: "allowances_cents", cloud: "allowancesCents" },
      { local: "deductions_cents", cloud: "deductionsCents" },
      { local: "net_pay_cents", cloud: "netPayCents" },
      { local: "payment_method_id", cloud: "paymentMethodId", refEntity: "payment_methods", refNotNull: true },
      { local: "payment_reference", cloud: "paymentReference" },
      { local: "status", cloud: "status" },
      { local: "notes", cloud: "notes" },
      { local: "allowances_json", cloud: "allowancesJson", type: "json" },
      { local: "deductions_json", cloud: "deductionsJson", type: "json" }
    ]
  },
  recurring_bills: {
    table: "recurring_bills",
    columns: [
      { local: "name", cloud: "name" },
      { local: "category_id", cloud: "categoryId", refEntity: "expense_categories" },
      { local: "storefront_id", cloud: "storefrontId", refEntity: "locations" },
      { local: "amount_cents", cloud: "amountCents" },
      { local: "cycle", cloud: "cycle" },
      { local: "start_date", cloud: "startDate" },
      { local: "next_due_date", cloud: "nextDueDate" },
      { local: "status", cloud: "status" },
      { local: "notes", cloud: "notes" }
    ]
  },
  sale_voids: {
    table: "sale_voids",
    columns: [
      { local: "sale_id", cloud: "saleId", refEntity: "sales", refNotNull: true },
      { local: "status", cloud: "status" },
      { local: "reason", cloud: "reason" },
      { local: "notes", cloud: "notes" },
      { local: "requested_by", cloud: "requestedBy", refEntity: "employees", refNotNull: true },
      { local: "requested_at", cloud: "requestedAt" },
      { local: "approved_by", cloud: "approvedBy", refEntity: "employees" },
      { local: "approved_at", cloud: "approvedAt" }
    ]
  },
  invoice_cancellations: {
    table: "invoice_cancellations",
    columns: [
      { local: "sale_id", cloud: "saleId", refEntity: "sales", refNotNull: true },
      { local: "status", cloud: "status" },
      { local: "reason", cloud: "reason" },
      { local: "notes", cloud: "notes" },
      { local: "requested_by", cloud: "requestedBy", refEntity: "employees", refNotNull: true },
      { local: "requested_at", cloud: "requestedAt" },
      { local: "approved_by", cloud: "approvedBy", refEntity: "employees" },
      { local: "approved_at", cloud: "approvedAt" }
    ]
  }
};

function toLocalValue(value: unknown, col: ColumnMap): SQLInputValue {
  if (value === null || value === undefined) return col.default ?? null;
  if (col.type === "bool") return value ? 1 : 0;
  if (col.type === "json") return JSON.stringify(value);
  if (col.refEntity) {
    return (col.refNotNull ? resolveRef(col.refEntity, value) : resolveRefOrNull(col.refEntity, value)) as SQLInputValue;
  }
  return value as SQLInputValue;
}

/** Persists "the cloud calls this local row <cloudId>" — see applyPulledRow's naturalKey
 * reconciliation. `entity` here is one of the five naturalKey-bearing entities (roles, employees,
 * payment_methods, expense_categories, locations); resolveRef below is what actually consults this
 * for every foreign-key-shaped field that might reference one of them. */
function recordIdAlias(entity: SyncEntity, cloudId: string, localId: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO sync_id_aliases (entity, cloud_id, local_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(entity, cloud_id) DO UPDATE SET local_id = excluded.local_id`
    )
    .run(entity, cloudId, localId, new Date().toISOString());
}

/** Resolves a foreign-key-shaped value from a pulled payload to this device's own local id, if that
 * id was ever reconciled under a different local id (see recordIdAlias) — otherwise returns the
 * value unchanged, which is the overwhelmingly common case (only the five naturalKey entities are
 * ever aliased at all, and only when a genuine two-device naming collision actually occurred). Must
 * be called on EVERY field that references one of those five entities — see each call site's own
 * comment for which column and why. Null/undefined pass through untouched (an optional reference
 * that's genuinely absent, not a lookup to perform). */
function resolveRef(entity: SyncEntity, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const row = getDatabase()
    .prepare("SELECT local_id FROM sync_id_aliases WHERE entity = ? AND cloud_id = ?")
    .get(entity, value as SQLInputValue) as { local_id: string } | undefined;
  return row ? row.local_id : value;
}

/** Same as resolveRef, but additionally verifies the resolved id actually exists in that entity's
 * own local table (table name === entity name, same convention used everywhere else) before handing
 * it back — table name === entity name for every synced entity. A referenced row that hasn't
 * reached this device at all yet (no alias recorded because there was never a naming collision to
 * reconcile in the first place — it's just genuinely still missing) must never be allowed to write
 * an id the local FOREIGN KEY constraint will reject. Every document header upsert
 * (upsertDocumentHeader, applySalePulledRow) has real `FOREIGN KEY (...) REFERENCES <refEntity>(id)`
 * constraints in migrate.ts, and a violation there throws INSIDE the same transaction as the rest of
 * that row's real fields (status, paid, received, etc.) — which, per pullEntity's own "only advance
 * the cursor once every row in the page applies" design, doesn't just fail this one field, it
 * PERMANENTLY WEDGES the entire entity's pull cursor at this exact point, silently (only a
 * console.warn, no UI ever shows it), retried forever on every future cycle with the identical
 * failure. Caught live: a purchase's payment_method_id referenced a payment method that had never
 * itself reached this device — every future change to that SAME purchase (marking it received, then
 * paid) sailed through the push side perfectly and sat correctly in the cloud, yet silently never
 * arrived on this device, because the pull cursor for the whole "purchases" entity had already been
 * frozen by this one dangling reference. Falls back to null here instead — lets every other real
 * field on the row apply and the cursor advance normally; the missing reference converges on its own
 * whenever that dependency actually arrives via a later, unrelated edit to this same row. */
function resolveRefOrNull(entity: SyncEntity, value: unknown): unknown {
  const resolved = resolveRef(entity, value);
  if (resolved === null || resolved === undefined) return resolved;
  const exists = getDatabase().prepare(`SELECT 1 FROM ${entity} WHERE id = ?`).get(resolved as SQLInputValue);
  return exists ? resolved : null;
}

/** The reverse of resolveRef, for the PUSH direction. When this device's own locally-seeded copy of
 * a naturalKey entity (e.g. its own "Super Admin" role, created before it ever synced with an
 * existing tenant) gets recognized as a duplicate and "aliased" instead of inserted (see pushOutbox
 * -> pushBatch's "aliased" handling and recordIdAlias), the row itself is never renamed locally —
 * but every OTHER row that references it by this device's original local id (e.g. an Employee's
 * role_id) would otherwise keep pushing that same now-nonexistent-in-the-cloud id forever, since
 * PAYLOAD_BUILDERS just reads the raw column value. Caught live: an Employee's roleId kept
 * referencing a Role id the cloud had aliased away and never actually created, making that employee
 * permanently unresolvable by role from any cloud-side feature. Falls through to the original value
 * when no alias exists — the common case (only the five naturalKey entities are ever aliased, and
 * only after a genuine two-device naming collision).
 *
 * Exported for bespoke (non-generic-sync) call sites that hand a raw local row id to a SERVER
 * endpoint outside the normal push pipeline — e.g. mpesa-service.ts sending `locationId` to
 * `/mpesa/*`. Those calls never pass through resolvePayloadRefsForPush, so without this they'd
 * silently key the till settings by whichever local id happened to lose a natural-key collision,
 * making a second device unable to find Till settings a first device already saved for the same
 * real storefront. */
export function resolveCloudRef(entity: SyncEntity, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const row = getDatabase()
    .prepare("SELECT cloud_id FROM sync_id_aliases WHERE entity = ? AND local_id = ?")
    .get(entity, value as SQLInputValue) as { cloud_id: string } | undefined;
  return row ? row.cloud_id : value;
}

/** Every column across every entity's own pull-side column map that's tagged with a refEntity —
 * spans BOTH families: APPLY_CONFIG (the generic entities) and the four BESPOKE_APPLY_ENTITIES'
 * own private header-column constants (PURCHASE_HEADER_COLUMNS etc. — each bespoke entity needed
 * its own column list purely because of its nested-item handling around the shared header, never
 * because its ref-resolution needs differ). resolvePayloadRefsForPush must see every one of these
 * or a push from any of the four bespoke document entities would never translate a locally-aliased
 * reference at all — caught live: a Purchase's paymentMethodId, referencing this device's own
 * aliased-away "Cash" row, pushed unchanged forever, landing in the cloud as a reference to a
 * payment method that was never actually inserted there under that id (the exact mechanism behind
 * [[project_dangling_ref_cursor_freeze_bug]]'s frozen cursor on the OTHER device pulling it back). */
function refColumnsFor(entity: SyncEntity): Array<{ cloud: string; refEntity: SyncEntity }> {
  const bespokeColumns: Partial<Record<SyncEntity, Array<{ local: string; cloud: string; refEntity?: SyncEntity; refNotNull?: boolean }>>> = {
    purchases: PURCHASE_HEADER_COLUMNS,
    quotations: QUOTATION_HEADER_COLUMNS,
    sale_returns: SALE_RETURN_HEADER_COLUMNS,
    sales: SALE_HEADER_COLUMNS,
    // Previously missing here — storefront_id/requested_by/reviewed_by never got alias-translated
    // before push, the exact bug class [[project_alias_push_resolution_bug]] fixed elsewhere in this
    // codebase; found and closed alongside adding stock_receipts (its own sibling entity) below.
    stock_requests: STOCK_REQUEST_HEADER_COLUMNS,
    stock_receipts: STOCK_RECEIPT_HEADER_COLUMNS
  };
  const columns = APPLY_CONFIG[entity]?.columns ?? bespokeColumns[entity] ?? [];
  return columns.filter((c): c is { local: string; cloud: string; refEntity: SyncEntity } => Boolean(c.refEntity));
}

/** Applied to every payload right before it's pushed — rewrites any refEntity-tagged field (see
 * refColumnsFor above) through resolveCloudRef, so a push can never carry a reference to an id the
 * cloud has already reconciled away. */
function resolvePayloadRefsForPush(entity: SyncEntity, payload: Record<string, unknown>): Record<string, unknown> {
  for (const column of refColumnsFor(entity)) {
    if (payload[column.cloud] !== undefined) {
      payload[column.cloud] = resolveCloudRef(column.refEntity, payload[column.cloud]);
    }
  }
  return payload;
}

/** Applies one pulled cloud row locally — insert if unknown, or last-write-wins update (only if the
 * incoming localUpdatedAt is strictly newer than the local row's own updated_at, so an unpushed
 * local edit never gets silently clobbered by a slightly-stale pull). Throws on FK violations
 * (e.g. an employee pulled before its role has) so the caller can retry it in a later pass —
 * callers must catch.
 *
 * `force` skips the "don't overwrite a newer local edit" guard — needed by resolveConflict's
 * "theirs" resolution, where the user has explicitly chosen to discard their own (possibly
 * chronologically newer) local edit in favor of the server's. That's a deliberate override of the
 * passive-pull default, not a bug in the guard. */
function applyPulledRow(entity: SyncEntity, row: Record<string, unknown>, force = false): void {
  if (BESPOKE_APPLY_ENTITIES.has(entity)) {
    if (entity === "sales") applySalePulledRow(row, force);
    if (entity === "quotations") applyQuotationPulledRow(row, force);
    if (entity === "purchases") applyPurchasePulledRow(row, force);
    if (entity === "sale_returns") applySaleReturnPulledRow(row, force);
    // Never conflict-aware (see stock_movements' own PAYLOAD_BUILDER comment) — resolveConflict()
    // can only ever call applyPulledRow with force:true for a CONFLICT_AWARE_ENTITIES member, which
    // this deliberately isn't, so there's no force parameter to thread through here.
    if (entity === "stock_movements") applyStockMovementPulledRow(row);
    // Never conflict-aware, same reasoning as stock_movements just above.
    if (entity === "supplier_balance_entries") applySupplierBalanceEntryPulledRow(row);
    if (entity === "stock_requests") applyStockRequestPulledRow(row, force);
    if (entity === "stock_receipts") applyStockReceiptPulledRow(row, force);
    return;
  }

  const config = APPLY_CONFIG[entity];
  if (!config) return; // unreachable — every non-bespoke SyncEntity has an APPLY_CONFIG entry.
  const db = getDatabase();
  const id = row.id as string;
  const localUpdatedAt = row.localUpdatedAt as string;
  const localCreatedAt = (row.localCreatedAt as string | null) ?? localUpdatedAt;

  // If this exact cloud id was already reconciled once before (see naturalKey handling below), the
  // alias table already knows which local id it really is — resolve that FIRST, not just a raw
  // by-id lookup. Without this, a LATER edit to an already-reconciled row (e.g. renaming a role
  // after the fact) would miss on both the by-id lookup (still never matches, by design) AND the
  // natural-key lookup (the name changed), and fall through to inserting a duplicate instead of
  // updating the row that's genuinely already there.
  const resolvedId = config.naturalKey ? (resolveRef(entity, id) as string) : id;

  let existing = db.prepare(`SELECT id, updated_at FROM ${config.table} WHERE id = ?`).get(resolvedId) as
    | { id: string; updated_at: string }
    | undefined;

  // Reference data seeded locally at every boot (default roles, the SYSTEM employee, default
  // payment methods/expense categories, the Main Store location) gets a fresh id on EVERY device —
  // so a second device pulling the first device's version of the "same" default (identical name/
  // code, different id) would otherwise hit this table's own UNIQUE(tenant_id, name/code)
  // constraint and fail the insert forever. Found live via real two-device testing: employees got
  // stuck at "1 local vs 10 cloud" because every real employee's role_id pointed at a role that had
  // failed to pull for exactly this reason. Reconciling by natural key treats "same name, different
  // id" as the same real-world thing: update the row that's ALREADY there in place, keeping ITS id
  // stable (a first attempt at renaming the row to adopt the cloud's id instead was reverted — it
  // breaks any OTHER payload, including this same row's own future re-pulls, still holding the old
  // id, which a bare rename can't retroactively fix). Instead, record the mapping in
  // `sync_id_aliases` — see recordIdAlias/resolveRef below, which every foreign-key-shaped field
  // resolves through before use, so a value the cloud calls "roleId: role_c9de8354" correctly
  // resolves to this device's own local role id no matter which payload it shows up in or when.
  if (!existing && config.naturalKey) {
    const naturalKeyValue = row[config.naturalKey.cloud];
    if (naturalKeyValue !== null && naturalKeyValue !== undefined) {
      existing = db
        .prepare(`SELECT id, updated_at FROM ${config.table} WHERE ${config.naturalKey.local} = ?`)
        .get(naturalKeyValue as SQLInputValue) as { id: string; updated_at: string } | undefined;

      if (existing && existing.id !== id) {
        recordIdAlias(entity, id, existing.id);
      }
    }
  }

  if (!force && existing && new Date(existing.updated_at).getTime() >= new Date(localUpdatedAt).getTime()) {
    return; // local is already same-or-newer — never overwrite a more recent local edit.
  }

  const now = new Date().toISOString();
  const localTenantId = tenantRepository.findTenantRow()!.id;
  // Accepting the server's row as truth — for a conflict-aware entity, this IS the new baseline
  // for the next push's optimistic-lock check (see CONFLICT_AWARE_ENTITIES).
  const isConflictAware = CONFLICT_AWARE_ENTITIES.has(entity);

  if (!existing) {
    const columns = [
      "id",
      "tenant_id",
      ...config.columns.map((c) => c.local),
      "created_at",
      "updated_at",
      "sync_status",
      "last_synced_at",
      ...(isConflictAware ? ["synced_updated_at"] : [])
    ];
    const placeholders = columns.map(() => "?").join(", ");
    const values: SQLInputValue[] = [
      id,
      localTenantId,
      ...config.columns.map((c) => toLocalValue(row[c.cloud], c)),
      localCreatedAt,
      localUpdatedAt,
      "synced",
      now,
      ...(isConflictAware ? [localUpdatedAt] : [])
    ];
    db.prepare(`INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders})`).run(...values);
  } else {
    const setClauses = [
      ...config.columns.map((c) => `${c.local} = ?`),
      "updated_at = ?",
      "sync_status = 'synced'",
      "last_synced_at = ?",
      ...(isConflictAware ? ["synced_updated_at = ?"] : [])
    ];
    const values: SQLInputValue[] = [
      ...config.columns.map((c) => toLocalValue(row[c.cloud], c)),
      localUpdatedAt,
      now,
      ...(isConflictAware ? [localUpdatedAt] : []),
      // existing.id, NOT the incoming row's id — for a plain by-id match they're the same value, but
      // for a natural-key reconciliation they differ, and it's existing.id (the row already present
      // locally, possibly already referenced elsewhere via FK) that must be updated in place.
      existing.id
    ];
    db.prepare(`UPDATE ${config.table} SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
  }
}

/** Sale's business fields, header-row only — mirrors the generic ColumnMap shape but kept separate
 * from APPLY_CONFIG since the header alone isn't the whole story for this entity (see below). */
const SALE_HEADER_COLUMNS: Array<{ local: string; cloud: string; refEntity?: SyncEntity; refNotNull?: boolean }> = [
  { local: "receipt_number", cloud: "receiptNumber" },
  { local: "location_id", cloud: "locationId", refEntity: "locations", refNotNull: true },
  { local: "employee_id", cloud: "employeeId", refEntity: "employees", refNotNull: true },
  // Missing this tag (unlike location_id/employee_id right above) meant customer_id was pushed AND
  // pulled 100% raw, with zero alias/existence protection — the real cause behind a rash of
  // permanently FK-failing sales for a customer id that no longer exists anywhere in the cloud
  // (deleted, or never actually synced). Every other refEntity column here was already safe.
  { local: "customer_id", cloud: "customerId", refEntity: "customers" },
  { local: "sale_status", cloud: "saleStatus" },
  { local: "subtotal_cents", cloud: "subtotalCents" },
  { local: "discount_amount_cents", cloud: "discountAmountCents" },
  { local: "tax_amount_cents", cloud: "taxAmountCents" },
  { local: "grand_total_cents", cloud: "grandTotalCents" },
  { local: "payment_method_id", cloud: "paymentMethodId", refEntity: "payment_methods" },
  { local: "payment_reference", cloud: "paymentReference" },
  { local: "amount_received_cents", cloud: "amountReceivedCents" },
  { local: "change_given_cents", cloud: "changeGivenCents" },
  { local: "notes", cloud: "notes" },
  { local: "completed_at", cloud: "completedAt" },
  { local: "transaction_type", cloud: "transactionType" },
  { local: "payment_status", cloud: "paymentStatus" },
  { local: "invoice_number", cloud: "invoiceNumber" },
  { local: "invoice_date", cloud: "invoiceDate" },
  { local: "due_date", cloud: "dueDate" },
  { local: "amount_paid_cents", cloud: "amountPaidCents" },
  { local: "balance_due_cents", cloud: "balanceDueCents" },
  { local: "invoice_notes", cloud: "invoiceNotes" }
];

/** The bespoke apply path BESPOKE_APPLY_ENTITIES routes "sales" through — a plain column-map upsert
 * for the header row (same semantics as applyPulledRow's generic path, just not expressible in that
 * declarative shape because of what follows), PLUS a replace-all-children apply for the nested
 * items/serviceCharges/delivery arrays: delete everything currently attached to this sale_id, then
 * insert fresh from the pulled payload. Safe because these children are never independently edited
 * after creation (delivery_notes.is_delivered included — its current value already lives inside the
 * pulled `delivery` object, so wholesale replacement is still correct). Wrapped in one transaction
 * so a failure partway through (e.g. an item referencing a product not yet pulled locally — the same
 * cross-page FK-ordering case Phase 1 already documents) leaves nothing partially applied; the
 * caller's existing try/catch + 2-pass retry in pullEntity handles the retry exactly as it does for
 * every other entity today. */
function applySalePulledRow(row: Record<string, unknown>, force: boolean): void {
  const db = getDatabase();
  const id = row.id as string;
  const localUpdatedAt = row.localUpdatedAt as string;
  const localCreatedAt = (row.localCreatedAt as string | null) ?? localUpdatedAt;

  // A held ("pending") sale is local-only by design (see migration 51) — no device running current
  // code ever pushes one. Pulling one down here always means a stale device (still on pre-1.0.9
  // code) is still pushing every hold, exactly the bug migration 51 was meant to end. Refusing to
  // materialize it locally stops that stale device's junk from re-appearing as a phantom "held
  // sale" on every OTHER device's Checkout screen on every sync cycle — it doesn't fix the source
  // (the stale device itself needs updating), but it stops the symptom from spreading.
  if (row.saleStatus === "pending") {
    console.warn(`[sync] ignored a 'pending' sale pulled from the cloud (${id}) — held sales are local-only; source device is likely still running old code`);
    return;
  }

  const existing = db.prepare("SELECT updated_at FROM sales WHERE id = ?").get(id) as
    | { updated_at: string }
    | undefined;

  if (!force && existing && new Date(existing.updated_at).getTime() >= new Date(localUpdatedAt).getTime()) {
    return;
  }

  runInTransaction(() => {
    const now = new Date().toISOString();
    const localTenantId = tenantRepository.findTenantRow()!.id;

    const isConflictAware = CONFLICT_AWARE_ENTITIES.has("sales");

    if (!existing) {
      const columns = [
        "id",
        "tenant_id",
        ...SALE_HEADER_COLUMNS.map((c) => c.local),
        "payments",
        "include_tax_breakdown",
        "include_business_info",
        "created_at",
        "updated_at",
        "sync_status",
        "last_synced_at",
        ...(isConflictAware ? ["synced_updated_at"] : [])
      ];
      const placeholders = columns.map(() => "?").join(", ");
      const values: SQLInputValue[] = [
        id,
        localTenantId,
        ...SALE_HEADER_COLUMNS.map((c) =>
          c.refEntity
            ? ((c.refNotNull ? resolveRef(c.refEntity, row[c.cloud]) : resolveRefOrNull(c.refEntity, row[c.cloud])) as SQLInputValue)
            : (row[c.cloud] as SQLInputValue)
        ),
        JSON.stringify(row.payments ?? []),
        // Bound separately from SALE_HEADER_COLUMNS (like "payments" above) rather than folded into
        // that array — it has no "bool" type concept (unlike the generic ColumnMap/toLocalValue path
        // other entities use), so a raw JS true/false would otherwise get bound straight to node:sqlite
        // for an INTEGER column. Missing on an older device's pre-this-feature payload defaults to 1,
        // matching the column's own DEFAULT 1.
        row.includeTaxBreakdown === false ? 0 : 1,
        row.includeBusinessInfo === false ? 0 : 1,
        localCreatedAt,
        localUpdatedAt,
        "synced",
        now,
        ...(isConflictAware ? [localUpdatedAt] : [])
      ];
      db.prepare(`INSERT INTO sales (${columns.join(", ")}) VALUES (${placeholders})`).run(...values);
    } else {
      const setClauses = [
        ...SALE_HEADER_COLUMNS.map((c) => `${c.local} = ?`),
        "payments = ?",
        "include_tax_breakdown = ?",
        "include_business_info = ?",
        "updated_at = ?",
        "sync_status = 'synced'",
        "last_synced_at = ?",
        ...(isConflictAware ? ["synced_updated_at = ?"] : [])
      ];
      const values: SQLInputValue[] = [
        ...SALE_HEADER_COLUMNS.map((c) =>
          c.refEntity
            ? ((c.refNotNull ? resolveRef(c.refEntity, row[c.cloud]) : resolveRefOrNull(c.refEntity, row[c.cloud])) as SQLInputValue)
            : (row[c.cloud] as SQLInputValue)
        ),
        JSON.stringify(row.payments ?? []),
        row.includeTaxBreakdown === false ? 0 : 1,
        row.includeBusinessInfo === false ? 0 : 1,
        localUpdatedAt,
        now,
        ...(isConflictAware ? [localUpdatedAt] : []),
        id
      ];
      db.prepare(`UPDATE sales SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
    }

    db.prepare("DELETE FROM sale_items WHERE sale_id = ?").run(id);
    const items = (row.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      db.prepare(
        `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price_cents, discount_amount_cents, tax_type, tax_amount_cents, line_total_cents, is_locally_sourced, local_cost_cents, local_supplier_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.id as string,
        id,
        // NOT NULL — a natural-key merge on "products" may have superseded this device's own row
        // under a different cloud id (see resolveRefOrNull's own doc comment on the same class of
        // issue for header-level refs); resolveRef translates through that alias if one exists, and
        // otherwise passes the raw id through unchanged so the existing cross-page retry still works.
        resolveRef("products", item.productId) as string,
        item.quantity as number,
        item.unitPriceCents as number,
        (item.discountAmountCents as number | undefined) ?? 0,
        // Older device's payload predates this field entirely — see toLocalValue's own comment on
        // the same class of issue for header-level columns.
        (item.taxType as string | undefined) ?? "vat",
        (item.taxAmountCents as number | undefined) ?? 0,
        item.lineTotalCents as number,
        // Older device's payload predates this field entirely, same fallback reasoning as taxType.
        item.isLocallySourced ? 1 : 0,
        (item.localCostCents as number | null | undefined) ?? null,
        // Nullable — resolveRefOrNull is safe here (unlike product_id above, which is NOT NULL).
        // Older device's payload predates this field entirely too — same fallback reasoning as
        // taxType above, but here it matters even more: better-sqlite3 throws a TypeError on an
        // undefined bind parameter (unlike null, which is fine), so without normalizing first this
        // crashed the WHOLE row — every sale from a pre-feature device, not just ones that actually
        // used local sourcing.
        resolveRefOrNull("suppliers", (item.localSupplierId as string | null | undefined) ?? null) as string | null,
        item.createdAt as string
      );
    }

    db.prepare("DELETE FROM sale_service_charges WHERE sale_id = ?").run(id);
    const serviceCharges = (row.serviceCharges as Array<Record<string, unknown>>) ?? [];
    for (const charge of serviceCharges) {
      db.prepare(
        `INSERT INTO sale_service_charges (id, tenant_id, sale_id, quotation_id, name, fee_cents, cost_cents, created_at, sync_status)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'synced')`
      ).run(
        charge.id as string,
        localTenantId,
        id,
        charge.name as string,
        charge.feeCents as number,
        (charge.costCents as number | undefined) ?? 0,
        charge.createdAt as string
      );
    }

    db.prepare("DELETE FROM delivery_notes WHERE sale_id = ?").run(id);
    const delivery = row.delivery as Record<string, unknown> | null;
    if (delivery) {
      insertPulledDeliveryNote(db, {
        id: delivery.id as string,
        tenantId: localTenantId,
        deliveryNoteNumber: delivery.deliveryNoteNumber as string,
        saleId: id,
        riderId: resolveRefOrNull("riders", delivery.riderId) as string | null,
        recipientName: delivery.recipientName as string,
        country: delivery.country as string | null,
        town: delivery.town as string | null,
        physicalAddress: delivery.physicalAddress as string,
        notes: delivery.notes as string | null,
        feeCents: delivery.feeCents as number,
        costCents: (delivery.costCents as number | undefined) ?? 0,
        isDelivered: delivery.isDelivered ? 1 : 0,
        deliveredAt: delivery.deliveredAt as string | null,
        createdAt: delivery.createdAt as string,
        updatedAt: delivery.updatedAt as string
      });
    }
  });
}

/** True only for the exact UNIQUE(tenant_id, delivery_note_number) violation — never for the
 * sale_id/quotation_id partial-unique indexes (both pre-cleared by a DELETE right before every call
 * site calls this) or any unrelated failure, which insertPulledDeliveryNote below must still let
 * through unchanged. SQLite's own constraint-failed message lists the exact column pair, so matching
 * on that text is precise, not a guess. */
function isDeliveryNoteNumberCollision(err: unknown): boolean {
  return err instanceof Error && err.message.includes("delivery_notes.tenant_id, delivery_notes.delivery_note_number");
}

/** Inserts one pulled delivery note. A UNIQUE(tenant_id, delivery_note_number) collision here means
 * two devices independently minted the identical number — almost always the pre-activation hash-tag
 * fallback in document-number-service.ts's getDeviceTag colliding across two devices that both
 * started before either had picked up its real device sequence (a genuinely rare but real
 * possibility with a short 4-hex-char tag — see that function's own comment). Retries ONCE with a
 * disambiguated number (this delivery's own id appended) instead of giving up.
 *
 * An earlier version of this function silently DROPPED the collision instead (reasoning: it can only
 * mean a stale pre-migration-51 duplicate, so discard the dead one and keep going) — that reasoning
 * was wrong in practice: it couldn't distinguish "this is provably dead orphaned data" from "this is
 * a real, currently-relevant delivery on another device," and ended up silently dropping delivery
 * notes off genuine sales. Disambiguating instead of dropping keeps BOTH real records — the sale/
 * quotation this delivery belongs to can still fully land locally, its number is just no longer the
 * exact one another device's delivery happens to also be using. Any OTHER error (a genuinely
 * different failure) is rethrown unchanged, same as before — this only ever intercepts this one
 * specific, identifiable collision. */
function insertPulledDeliveryNote(
  db: ReturnType<typeof getDatabase>,
  fields: {
    id: string;
    tenantId: string;
    deliveryNoteNumber: string;
    saleId: string | null;
    quotationId?: string | null;
    riderId: string | null;
    recipientName: string;
    country: string | null;
    town: string | null;
    physicalAddress: string;
    notes: string | null;
    feeCents: number;
    costCents: number;
    isDelivered: number;
    deliveredAt: string | null;
    createdAt: string;
    updatedAt: string;
  }
): void {
  const insert = (deliveryNoteNumber: string): void => {
    db.prepare(
      `INSERT INTO delivery_notes (
        id, tenant_id, delivery_note_number, sale_id, quotation_id, rider_id, recipient_name,
        country, town, physical_address, notes, fee_cents, cost_cents, is_delivered, delivered_at,
        created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`
    ).run(
      fields.id,
      fields.tenantId,
      deliveryNoteNumber,
      fields.saleId,
      fields.quotationId ?? null,
      fields.riderId,
      fields.recipientName,
      fields.country,
      fields.town,
      fields.physicalAddress,
      fields.notes,
      fields.feeCents,
      fields.costCents,
      fields.isDelivered,
      fields.deliveredAt,
      fields.createdAt,
      fields.updatedAt
    );
  };

  try {
    insert(fields.deliveryNoteNumber);
  } catch (err) {
    if (!isDeliveryNoteNumberCollision(err)) throw err;
    // Deterministic per delivery id (not random/timestamp-based) — so if this same pulled row is
    // retried on a later cycle before it's ever fully committed, it renumbers to the exact same
    // disambiguated value every time instead of drifting.
    const suffix = fields.id.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
    const disambiguated = `${fields.deliveryNoteNumber}-${suffix}`;
    console.error(
      `[sync] delivery note number "${fields.deliveryNoteNumber}" collided with an existing local ` +
        `record belonging to a DIFFERENT delivery — two devices minted the identical number. ` +
        `Renumbering this one to "${disambiguated}" so its sale/quotation can still land locally. ` +
        `Flag to support if this recurs for the same tenant.`
    );
    insert(disambiguated);
  }
}

/** Shared header-upsert for the other three BESPOKE_APPLY_ENTITIES (quotations/purchases/
 * sale_returns) — the same generic column-map upsert logic applySalePulledRow hand-rolls, factored
 * out so these three don't each repeat it. Returns null if the "don't overwrite a newer local edit"
 * guard blocked the write (and force wasn't set) — in which case the caller must also skip touching
 * its own children, not just the header. Returns the tenant id otherwise, since some callers'
 * children need it (quotation's service_charges/delivery_notes carry a tenant_id column; purchase/
 * sale_return line items don't). */
function upsertDocumentHeader(
  table: string,
  businessColumns: Array<{ local: string; cloud: string; refEntity?: SyncEntity; refNotNull?: boolean }>,
  jsonColumns: Array<{ local: string; cloud: string }>,
  row: Record<string, unknown>,
  force: boolean
): string | null {
  const db = getDatabase();
  const id = row.id as string;
  const localUpdatedAt = row.localUpdatedAt as string;
  const localCreatedAt = (row.localCreatedAt as string | null) ?? localUpdatedAt;

  const existing = db.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).get(id) as
    | { updated_at: string }
    | undefined;

  if (!force && existing && new Date(existing.updated_at).getTime() >= new Date(localUpdatedAt).getTime()) {
    return null;
  }

  const now = new Date().toISOString();
  const localTenantId = tenantRepository.findTenantRow()!.id;
  // table name === entity name for every synced entity — safe to check directly, no separate
  // "which entity is this document" parameter needed.
  const isConflictAware = CONFLICT_AWARE_ENTITIES.has(table as SyncEntity);

  if (!existing) {
    const columns = [
      "id",
      "tenant_id",
      ...businessColumns.map((c) => c.local),
      ...jsonColumns.map((c) => c.local),
      "created_at",
      "updated_at",
      "sync_status",
      "last_synced_at",
      ...(isConflictAware ? ["synced_updated_at"] : [])
    ];
    const placeholders = columns.map(() => "?").join(", ");
    const values: SQLInputValue[] = [
      id,
      localTenantId,
      ...businessColumns.map((c) =>
        c.refEntity
          ? ((c.refNotNull ? resolveRef(c.refEntity, row[c.cloud]) : resolveRefOrNull(c.refEntity, row[c.cloud])) as SQLInputValue)
          : (row[c.cloud] as SQLInputValue)
      ),
      ...jsonColumns.map((c) => JSON.stringify(row[c.cloud] ?? null)),
      localCreatedAt,
      localUpdatedAt,
      "synced",
      now,
      ...(isConflictAware ? [localUpdatedAt] : [])
    ];
    db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`).run(...values);
  } else {
    const setClauses = [
      ...businessColumns.map((c) => `${c.local} = ?`),
      ...jsonColumns.map((c) => `${c.local} = ?`),
      "updated_at = ?",
      "sync_status = 'synced'",
      "last_synced_at = ?",
      ...(isConflictAware ? ["synced_updated_at = ?"] : [])
    ];
    const values: SQLInputValue[] = [
      ...businessColumns.map((c) =>
        c.refEntity
          ? ((c.refNotNull ? resolveRef(c.refEntity, row[c.cloud]) : resolveRefOrNull(c.refEntity, row[c.cloud])) as SQLInputValue)
          : (row[c.cloud] as SQLInputValue)
      ),
      ...jsonColumns.map((c) => JSON.stringify(row[c.cloud] ?? null)),
      localUpdatedAt,
      now,
      ...(isConflictAware ? [localUpdatedAt] : []),
      id
    ];
    db.prepare(`UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
  }

  return localTenantId;
}

const QUOTATION_HEADER_COLUMNS: Array<{ local: string; cloud: string; refEntity?: SyncEntity; refNotNull?: boolean }> = [
  { local: "quotation_number", cloud: "quotationNumber" },
  // Nullable now, same as SALE_HEADER_COLUMNS' own customer_id (walk-in quotations) — was
  // refNotNull: true, which meant a quotation whose customer became genuinely unresolvable (e.g. a
  // duplicate-customer sync collision, see the customers NATURAL_KEY_FIELDS fix) failed to apply at
  // all and eventually got permanently skipped, silently losing the whole document rather than just
  // its customer name. resolveRefOrNull degrades to a walk-in quotation instead — see
  // migration 67 (quotation_walk_in_customer) for the schema half of this.
  { local: "customer_id", cloud: "customerId", refEntity: "customers" },
  { local: "location_id", cloud: "locationId", refEntity: "locations", refNotNull: true },
  { local: "employee_id", cloud: "employeeId", refEntity: "employees", refNotNull: true },
  { local: "status", cloud: "status" },
  { local: "subtotal_cents", cloud: "subtotalCents" },
  { local: "discount_amount_cents", cloud: "discountAmountCents" },
  { local: "tax_amount_cents", cloud: "taxAmountCents" },
  { local: "grand_total_cents", cloud: "grandTotalCents" },
  { local: "valid_until", cloud: "validUntil" },
  { local: "notes", cloud: "notes" },
  { local: "converted_sale_id", cloud: "convertedSaleId", refEntity: "sales" },
  { local: "converted_at", cloud: "convertedAt" }
];

/** Same nested-document pattern as applySalePulledRow, including the same quotation_id-keyed
 * extras (sale_service_charges/delivery_notes) — see migrate.ts v38's own trigger comments for why
 * those two tables need BOTH a sale_id-keyed and quotation_id-keyed re-enqueue trigger. */
function applyQuotationPulledRow(row: Record<string, unknown>, force: boolean): void {
  runInTransaction(() => {
    const id = row.id as string;
    const localTenantId = upsertDocumentHeader("quotations", QUOTATION_HEADER_COLUMNS, [], row, force);
    if (!localTenantId) return;

    const db = getDatabase();
    // Follow-up UPDATE rather than folded into QUOTATION_HEADER_COLUMNS — that array has no "bool"
    // type concept (unlike the generic ColumnMap/toLocalValue path other entities use), so a raw JS
    // true/false would otherwise get bound straight to node:sqlite for an INTEGER column. Only runs
    // when the header upsert above actually applied (guarded by the !localTenantId return), so a
    // skipped-as-stale pull never overwrites this separately. Missing on an older device's
    // pre-this-feature payload defaults to 1, matching the column's own DEFAULT 1.
    db.prepare("UPDATE quotations SET include_tax_breakdown = ? WHERE id = ?").run(
      row.includeTaxBreakdown === false ? 0 : 1,
      id
    );
    db.prepare("UPDATE quotations SET include_business_info = ? WHERE id = ?").run(
      row.includeBusinessInfo === false ? 0 : 1,
      id
    );

    db.prepare("DELETE FROM quotation_items WHERE quotation_id = ?").run(id);
    const items = (row.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      db.prepare(
        `INSERT INTO quotation_items (id, quotation_id, product_id, quantity, unit_price_cents, discount_amount_cents, tax_type, tax_amount_cents, line_total_cents, is_locally_sourced, local_cost_cents, local_supplier_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.id as string,
        id,
        resolveRef("products", item.productId) as string,
        item.quantity as number,
        item.unitPriceCents as number,
        (item.discountAmountCents as number | undefined) ?? 0,
        (item.taxType as string | undefined) ?? "vat",
        (item.taxAmountCents as number | undefined) ?? 0,
        item.lineTotalCents as number,
        // Older device's payload predates this field entirely, same fallback reasoning as taxType —
        // see applySalePulledRow's own identical comment for sale_items.
        item.isLocallySourced ? 1 : 0,
        (item.localCostCents as number | null | undefined) ?? null,
        resolveRefOrNull("suppliers", (item.localSupplierId as string | null | undefined) ?? null) as string | null,
        item.createdAt as string
      );
    }

    db.prepare("DELETE FROM sale_service_charges WHERE quotation_id = ?").run(id);
    const serviceCharges = (row.serviceCharges as Array<Record<string, unknown>>) ?? [];
    for (const charge of serviceCharges) {
      db.prepare(
        `INSERT INTO sale_service_charges (id, tenant_id, sale_id, quotation_id, name, fee_cents, cost_cents, created_at, sync_status)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'synced')`
      ).run(
        charge.id as string,
        localTenantId,
        id,
        charge.name as string,
        charge.feeCents as number,
        (charge.costCents as number | undefined) ?? 0,
        charge.createdAt as string
      );
    }

    db.prepare("DELETE FROM delivery_notes WHERE quotation_id = ?").run(id);
    const delivery = row.delivery as Record<string, unknown> | null;
    if (delivery) {
      insertPulledDeliveryNote(db, {
        id: delivery.id as string,
        tenantId: localTenantId,
        deliveryNoteNumber: delivery.deliveryNoteNumber as string,
        saleId: null,
        quotationId: id,
        riderId: resolveRefOrNull("riders", delivery.riderId) as string | null,
        recipientName: delivery.recipientName as string,
        country: delivery.country as string | null,
        town: delivery.town as string | null,
        physicalAddress: delivery.physicalAddress as string,
        notes: delivery.notes as string | null,
        feeCents: delivery.feeCents as number,
        costCents: (delivery.costCents as number | undefined) ?? 0,
        isDelivered: delivery.isDelivered ? 1 : 0,
        deliveredAt: delivery.deliveredAt as string | null,
        createdAt: delivery.createdAt as string,
        updatedAt: delivery.updatedAt as string
      });
    }
  });
}

const PURCHASE_HEADER_COLUMNS: Array<{ local: string; cloud: string; refEntity?: SyncEntity; refNotNull?: boolean }> = [
  { local: "purchase_number", cloud: "purchaseNumber" },
  // Same missing-tag bug as SALE_HEADER_COLUMNS' customer_id — fixed identically.
  { local: "supplier_id", cloud: "supplierId", refEntity: "suppliers", refNotNull: true },
  { local: "supplier_invoice_number", cloud: "supplierInvoiceNumber" },
  { local: "location_id", cloud: "locationId", refEntity: "locations", refNotNull: true },
  { local: "status", cloud: "status" },
  { local: "tax_type", cloud: "taxType" },
  { local: "subtotal_cents", cloud: "subtotalCents" },
  { local: "discount_amount_cents", cloud: "discountAmountCents" },
  { local: "tax_amount_cents", cloud: "taxAmountCents" },
  { local: "shipping_cost_cents", cloud: "shippingCostCents" },
  { local: "grand_total_cents", cloud: "grandTotalCents" },
  { local: "payment_method_id", cloud: "paymentMethodId", refEntity: "payment_methods" },
  { local: "payment_reference", cloud: "paymentReference" },
  { local: "payment_status", cloud: "paymentStatus" },
  { local: "amount_paid_cents", cloud: "amountPaidCents" },
  { local: "notes", cloud: "notes" },
  { local: "ordered_at", cloud: "orderedAt" },
  { local: "received_at", cloud: "receivedAt" }
];

function applyPurchasePulledRow(row: Record<string, unknown>, force: boolean): void {
  runInTransaction(() => {
    const id = row.id as string;
    const localTenantId = upsertDocumentHeader(
      "purchases",
      PURCHASE_HEADER_COLUMNS,
      [
        { local: "payments", cloud: "payments" },
        { local: "receiving_events", cloud: "receivingEvents" }
      ],
      row,
      force
    );
    if (!localTenantId) return;

    const db = getDatabase();
    // remaining_quantity is a GENERATED ALWAYS column — never in the insert column list.
    db.prepare("DELETE FROM purchase_items WHERE purchase_id = ?").run(id);
    const items = (row.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      db.prepare(
        `INSERT INTO purchase_items (id, purchase_id, product_id, ordered_quantity, received_quantity, unit_cost_cents, selling_price_cents, discount_amount_cents, tax_type, tax_amount_cents, line_total_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.id as string,
        id,
        resolveRef("products", item.productId) as string,
        item.orderedQuantity as number,
        (item.receivedQuantity as number | undefined) ?? 0,
        item.unitCostCents as number,
        (item.sellingPriceCents as number | undefined) ?? null,
        (item.discountAmountCents as number | undefined) ?? 0,
        (item.taxType as string | undefined) ?? "vat",
        (item.taxAmountCents as number | undefined) ?? 0,
        item.lineTotalCents as number,
        item.createdAt as string,
        item.updatedAt as string
      );
    }
  });
}

const SALE_RETURN_HEADER_COLUMNS: Array<{ local: string; cloud: string; refEntity?: SyncEntity; refNotNull?: boolean }> = [
  { local: "sale_id", cloud: "saleId", refEntity: "sales", refNotNull: true },
  { local: "status", cloud: "status" },
  { local: "reason", cloud: "reason" },
  { local: "notes", cloud: "notes" },
  { local: "requested_by", cloud: "requestedBy", refEntity: "employees", refNotNull: true },
  { local: "requested_at", cloud: "requestedAt" },
  { local: "approved_by", cloud: "approvedBy", refEntity: "employees" },
  { local: "approved_at", cloud: "approvedAt" }
];

function applySaleReturnPulledRow(row: Record<string, unknown>, force: boolean): void {
  runInTransaction(() => {
    const id = row.id as string;
    const localTenantId = upsertDocumentHeader("sale_returns", SALE_RETURN_HEADER_COLUMNS, [], row, force);
    if (!localTenantId) return;

    const db = getDatabase();
    db.prepare("DELETE FROM sale_return_items WHERE sale_return_id = ?").run(id);
    const items = (row.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      db.prepare(
        `INSERT INTO sale_return_items (id, sale_return_id, sale_item_id, product_id, quantity, unit_price_cents, line_total_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.id as string,
        id,
        item.saleItemId as string,
        resolveRef("products", item.productId) as string,
        item.quantity as number,
        item.unitPriceCents as number,
        item.lineTotalCents as number,
        item.createdAt as string
      );
    }
  });
}

/**
 * The one entity that ISN'T a document — stock_movements is an append-only ledger, so pulling one
 * has no "upsert the row" semantics at all: either this device has never seen this movement before
 * (apply it once — insert the ledger row, then adjust local inventory/allocations by its delta), or
 * it already has (do nothing). The existence check by id IS the entire idempotency guard, and it's
 * the only one needed: this handles both "another device's movement, arriving for the first time"
 * AND "this device's own movement, echoed back by a generic pull that doesn't exclude the
 * requester's own rows" — re-applying either would double-count the quantity change, which a plain
 * last-write-wins upsert (fine for every other entity) would not protect against here.
 *
 * Deliberately does NOT reject on insufficient stock the way a brand-new manual entry would
 * (applyValidatedStockMovement's own check) — a movement being replayed already happened, on some
 * device, at some point; refusing to record real history because THIS device's local numbers
 * haven't caught up yet would create permanent, silent divergence, which is strictly worse than a
 * transiently negative number that later movements correct.
 *
 * Does NOT touch main_store_allocations at all (a previous version of this function did, replaying
 * the movement's allocationStorefrontId/allocationExplicit as a bucket delta — removed once that
 * table got its own direct sync, see its migration comment). Replaying it here was only ever an
 * approximation anyway, since reallocateMainStoreStock() never produces a ledger row; now that
 * allocations sync as their own authoritative entity, this function has nothing useful left to add
 * and keeping it would risk the two mechanisms fighting over the same row.
 */
function applyStockMovementPulledRow(row: Record<string, unknown>): void {
  runInTransaction(() => {
    const id = row.id as string;
    const db = getDatabase();

    const alreadyApplied = db.prepare("SELECT 1 FROM stock_movements WHERE id = ?").get(id);
    if (alreadyApplied) return;

    const localTenantId = tenantRepository.findTenantRow()!.id;
    // NOT NULL — same alias-translation reasoning as sale_items.product_id above; stock_movements
    // has no APPLY_CONFIG entry at all, so unlike every other entity it never got this for free.
    const productId = resolveRef("products", row.productId) as string;
    const locationId = resolveRef("locations", row.locationId) as string;
    const quantityChange = row.quantityChange as number;
    // Kept only as historical/audit context on the ledger row itself — no longer replayed into
    // main_store_allocations (see this function's own doc comment).
    const allocationStorefrontId = resolveRef(
      "locations",
      (row.allocationStorefrontId as string | null | undefined) ?? null
    ) as string | null;
    const allocationExplicit = Boolean(row.allocationExplicit);
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO stock_movements (
         id, tenant_id, product_id, location_id, movement_type, quantity_change,
         reference_type, reference_id, performed_by, notes, allocation_storefront_id, allocation_explicit,
         created_at, sync_status, last_synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?)`
    ).run(
      id,
      localTenantId,
      productId,
      locationId,
      row.movementType as string,
      quantityChange,
      (row.referenceType as string | null) ?? null,
      (row.referenceId as string | null) ?? null,
      (row.performedBy as string | null) ?? null,
      (row.notes as string | null) ?? null,
      allocationStorefrontId,
      allocationExplicit ? 1 : 0,
      row.localCreatedAt as string,
      now
    );

    const existingInventory = inventoryRepository.findInventoryRow(productId, locationId);
    inventoryRepository.upsertInventoryQuantity({
      tenantId: localTenantId,
      productId,
      locationId,
      quantity: (existingInventory?.quantity ?? 0) + quantityChange
    });
  });
}

/** supplier_balance_entries' own pull-apply, same shape as applyStockMovementPulledRow just above —
 * an append-only ledger row applied as a DELTA to the local cache (suppliers.balance_cents), never a
 * plain column-map upsert. The existence check by id is the whole idempotency guard: either this
 * device has never seen this entry before (insert it, adjust the cache once) or it already has (do
 * nothing) — covers both "another device's purchase/payment, arriving for the first time" and "this
 * device's own entry, echoed back by a pull that doesn't exclude the requester's own rows". */
function applySupplierBalanceEntryPulledRow(row: Record<string, unknown>): void {
  runInTransaction(() => {
    const id = row.id as string;
    const db = getDatabase();

    const alreadyApplied = db.prepare("SELECT 1 FROM supplier_balance_entries WHERE id = ?").get(id);
    if (alreadyApplied) return;

    const localTenantId = tenantRepository.findTenantRow()!.id;
    const supplierId = resolveRef("suppliers", row.supplierId) as string;
    const amountCents = row.amountCents as number;

    db.prepare(
      `INSERT INTO supplier_balance_entries (
         id, tenant_id, supplier_id, entry_type, amount_cents,
         reference_type, reference_id, notes, performed_by, created_at, sync_status, last_synced_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?)`
    ).run(
      id,
      localTenantId,
      supplierId,
      row.entryType as string,
      amountCents,
      (row.referenceType as string | null) ?? null,
      (row.referenceId as string | null) ?? null,
      (row.notes as string | null) ?? null,
      (row.performedBy as string | null) ?? null,
      row.localCreatedAt as string,
      new Date().toISOString()
    );

    supplierBalanceRepository.adjustSupplierBalanceCents(supplierId, amountCents);
  });
}

const STOCK_REQUEST_HEADER_COLUMNS: Array<{ local: string; cloud: string; refEntity?: SyncEntity; refNotNull?: boolean }> = [
  { local: "request_number", cloud: "requestNumber" },
  { local: "storefront_id", cloud: "storefrontId", refEntity: "locations", refNotNull: true },
  { local: "status", cloud: "status" },
  { local: "notes", cloud: "notes" },
  { local: "rejection_reason", cloud: "rejectionReason" },
  { local: "requested_by", cloud: "requestedBy", refEntity: "employees", refNotNull: true },
  { local: "requested_at", cloud: "requestedAt" },
  { local: "reviewed_by", cloud: "reviewedBy", refEntity: "employees" },
  { local: "reviewed_at", cloud: "reviewedAt" }
];

/** Last entity in "buy a new device, get everything back" — back to the plain document-with-
 * line-items pattern (same shape as applySaleReturnPulledRow): a header upsert via the shared
 * upsertDocumentHeader helper, then replace-all its items. Once created-only, stock_request_items are
 * now also updated in place at approval time (previousQuantity/newQuantity/mainStorePreviousQuantity/
 * mainStoreNewQuantity — see stock-request-service.ts's approveStockRequest) — replace-all on every
 * pull stays safe regardless, since it's driven by whatever the pushing device's item rows currently
 * hold, not by an "only ever inserted once" assumption. */
function applyStockRequestPulledRow(row: Record<string, unknown>, force: boolean): void {
  runInTransaction(() => {
    const id = row.id as string;
    const localTenantId = upsertDocumentHeader("stock_requests", STOCK_REQUEST_HEADER_COLUMNS, [], row, force);
    if (!localTenantId) return;

    const db = getDatabase();
    db.prepare("DELETE FROM stock_request_items WHERE stock_request_id = ?").run(id);
    const items = (row.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      db.prepare(
        `INSERT INTO stock_request_items (
          id, stock_request_id, product_id, quantity_requested, previous_quantity, new_quantity,
          main_store_previous_quantity, main_store_new_quantity, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.id as string,
        id,
        resolveRef("products", item.productId) as string,
        item.quantityRequested as number,
        // Older rows pushed before this feature shipped simply omit these keys entirely — ?? null
        // (not `as number | null`, which would coerce `undefined` into a bound param SQLite rejects)
        // keeps that case a clean NULL rather than a bind error. Same convention as
        // applyStockReceiptPulledRow's own mainStorePreviousQuantity/mainStoreNewQuantity below.
        (item.previousQuantity as number | null | undefined) ?? null,
        (item.newQuantity as number | null | undefined) ?? null,
        (item.mainStorePreviousQuantity as number | null | undefined) ?? null,
        (item.mainStoreNewQuantity as number | null | undefined) ?? null,
        item.createdAt as string
      );
    }
  });
}

const STOCK_RECEIPT_HEADER_COLUMNS: Array<{ local: string; cloud: string; refEntity?: SyncEntity; refNotNull?: boolean }> = [
  { local: "receipt_number", cloud: "receiptNumber" },
  { local: "location_id", cloud: "locationId", refEntity: "locations", refNotNull: true },
  { local: "allocation_storefront_id", cloud: "allocationStorefrontId", refEntity: "locations" },
  { local: "received_by", cloud: "receivedBy", refEntity: "employees", refNotNull: true },
  { local: "notes", cloud: "notes" }
];

/** Same header-with-frozen-line-items pattern as applyStockRequestPulledRow — safe to replace-all
 * the items on every apply because stock_receipt_items are only ever inserted once at creation
 * (create-only entity, no edit/approve flow — see this table's own migrate.ts comment). */
function applyStockReceiptPulledRow(row: Record<string, unknown>, force: boolean): void {
  runInTransaction(() => {
    const id = row.id as string;
    const localTenantId = upsertDocumentHeader("stock_receipts", STOCK_RECEIPT_HEADER_COLUMNS, [], row, force);
    if (!localTenantId) return;

    const db = getDatabase();
    db.prepare("DELETE FROM stock_receipt_items WHERE stock_receipt_id = ?").run(id);
    const items = (row.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items) {
      db.prepare(
        `INSERT INTO stock_receipt_items (
          id, stock_receipt_id, product_id, quantity_received, previous_quantity, new_quantity,
          main_store_previous_quantity, main_store_new_quantity, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.id as string,
        id,
        resolveRef("products", item.productId) as string,
        item.quantityReceived as number,
        item.previousQuantity as number,
        item.newQuantity as number,
        // Older rows pushed before this feature shipped simply omit these two keys entirely — ?? null
        // (not `as number | null`, which would coerce `undefined` into a bound param SQLite rejects)
        // keeps that case a clean NULL rather than a bind error.
        (item.mainStorePreviousQuantity as number | null | undefined) ?? null,
        (item.mainStoreNewQuantity as number | null | undefined) ?? null,
        item.createdAt as string
      );
    }
  });
}

type PullResponse = { rows: Array<Record<string, unknown>>; cursor: string; hasMore: boolean };

async function fetchPull(
  tenantId: string,
  deviceId: string,
  entity: SyncEntity,
  since: string | null
): Promise<PullResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/sync/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, deviceId, entity, since }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return null;
    return (await response.json()) as PullResponse;
  } catch {
    return null;
  }
}

/** A row still failing after this many separate PULL CYCLES (not the 2 in-page passes below) is no
 * longer treated as "just hasn't arrived yet". Combined with ORPHAN_MIN_AGE_MS below — see that
 * constant's own comment for why attempt count ALONE turned out not to be a reliable signal. */
const ORPHAN_QUARANTINE_THRESHOLD = 3;

/** A row isn't quarantined until it's ALSO been failing for at least this long in wall-clock time,
 * not just this many attempts — found live on a brand-new device's first-ever full historical sync:
 * `main_store_allocations` (product_id is a refNotNull field — see resolveRef, which unlike
 * resolveRefOrNull never verifies the referenced row actually exists locally before using it) hit
 * ORPHAN_QUARANTINE_THRESHOLD attempts in under 30 seconds — several sync cycles fired in rapid
 * succession right at cold-start, well before "products" (which syncs first and genuinely did have
 * the referenced rows, confirmed by direct inspection) had realistic time to land relative to a
 * dependent entity synced right after it. A device with months of history across ~20 entities can
 * legitimately take several minutes to fully catch up on its very first sync; 3 rapid-fire attempts
 * inside that window is not the same signal as 3 attempts spread over a device's normal, already-
 * caught-up operation (the case this quarantine mechanism was actually built for — a genuinely
 * deleted cloud reference). Both conditions must hold before giving up on a row.
 *
 * Was 5 minutes — raised after this exact failure mode recurred on a real client's first full sync
 * (hundreds of stock_movements + several small entities), just at larger scale: rows failed their
 * first 3 attempts within the first ~5-6 minutes of a cold start (before "products"/"locations" had
 * fully landed), crossed BOTH thresholds right at that boundary, and were quarantined — permanently
 * excluded from ever pulling again — even though the data they referenced was completely valid and
 * landed locally minutes later. 5 minutes is not a generous enough buffer for a large, established
 * tenant's very first sync; a longer window only delays how fast a GENUINELY dead reference gets
 * flagged, which is a far better trade-off than silently losing real data. See resyncOrphanedEntities
 * below for the recovery path once a row is wrongly quarantined despite this. */
const ORPHAN_MIN_AGE_MS = 20 * 60 * 1000;

/** Records (or bumps the attempt count on) a row that's still failing after the in-page retry below.
 * Table is local-only, diagnostic, and deliberately has no FK constraints of its own — it must be
 * able to hold any orphaned payload without itself becoming a second thing that can fail to insert.
 * Returns the new attempt count and how long ago this row first started failing, so the caller can
 * decide whether to quarantine yet. */
function recordPullOrphanAttempt(
  entity: SyncEntity,
  rowId: string,
  error: unknown,
  payload: Record<string, unknown>
): { attempts: number; ageMs: number } {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT attempts, first_seen_at FROM sync_pull_orphans WHERE entity = ? AND row_id = ?")
    .get(entity, rowId) as { attempts: number; first_seen_at: string } | undefined;
  const attempts = (existing?.attempts ?? 0) + 1;
  const firstSeenAt = existing?.first_seen_at ?? now;
  const errorMessage = error instanceof Error ? error.message : String(error);
  db.prepare(
    `INSERT INTO sync_pull_orphans (entity, row_id, attempts, last_error, payload_json, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity, row_id) DO UPDATE SET
       attempts = excluded.attempts, last_error = excluded.last_error,
       payload_json = excluded.payload_json, last_seen_at = excluded.last_seen_at`
  ).run(entity, rowId, attempts, errorMessage, JSON.stringify(payload), now, now);
  return { attempts, ageMs: new Date(now).getTime() - new Date(firstSeenAt).getTime() };
}

/** Clears any quarantine record for a row that just applied successfully — covers the case where a
 * row had accumulated a few failed cycles (below the threshold) and then its dependency arrived. */
function clearPullOrphan(entity: SyncEntity, rowId: string): void {
  getDatabase().prepare("DELETE FROM sync_pull_orphans WHERE entity = ? AND row_id = ?").run(entity, rowId);
}

async function pullEntity(tenantId: string, deviceId: string, entity: SyncEntity): Promise<void> {
  let since = readCursor(entity);
  let hasMore = true;

  while (hasMore) {
    const response = await fetchPull(tenantId, deviceId, entity, since);
    if (!response) return; // offline/unreachable — resume from the same cursor next cycle.

    // Two passes so same-page dependency ordering resolves itself (e.g. a role that appears after
    // an employee referencing it, or a child category before its parent). A row still failing after
    // both passes is logged and retried again on a LATER pull cycle — see below for why the cursor
    // deliberately does not advance past it (until ORPHAN_QUARANTINE_THRESHOLD is hit).
    let remaining = response.rows;
    const lastErrors = new Map<string, unknown>();
    for (let pass = 0; pass < 2 && remaining.length > 0; pass++) {
      const stillFailing: Array<Record<string, unknown>> = [];
      for (const row of remaining) {
        try {
          applyPulledRow(entity, row);
          clearPullOrphan(entity, row.id as string);
        } catch (err) {
          lastErrors.set(row.id as string, err);
          stillFailing.push(row);
          if (pass === 1) {
            console.warn(`[sync] ${entity} row ${row.id as string} still failing after 2 passes, will retry next cycle:`, err);
          }
        }
      }
      remaining = stillFailing;
    }

    // Only advance past this page if EVERY row in it actually applied (or has since been quarantined
    // below). Advancing unconditionally (the original behavior) turned a transient failure into a
    // PERMANENT one: since the cursor is `syncedAt`-based, not per-row, a page containing even one
    // still-failing row would have that row skipped forever the moment the cursor moved past its
    // syncedAt — found live via two-device testing, where a role-name collision (see APPLY_CONFIG's
    // naturalKey reconciliation above) silently and permanently blocked that role, and every employee
    // referencing it, from ever pulling again. Re-fetching the same page next cycle is safe — applying
    // an already-succeeded row again is a harmless no-op update — and correct: once whatever was
    // blocking it resolves (a dependency lands, a reconciliation fix applies), the retry on a later
    // cycle succeeds.
    //
    // But that same "never advance past a bad row" rule, applied to a row that will NEVER resolve
    // (its FK target is permanently gone from the cloud, not just running behind), instead freezes
    // this entity's cursor forever — every future row behind it, however unrelated, silently never
    // arrives either. That's the failure mode this quarantine step exists to break: past
    // ORPHAN_QUARANTINE_THRESHOLD cycles of the identical failure, give up on that one row specifically
    // (it's excluded from the local table it belongs to, so its effect on inventory/totals is simply
    // never applied — the same outcome as if it never existed, matching the reality that its target
    // doesn't exist either) and let every other row keep syncing.
    if (remaining.length > 0) {
      const stillBlocking: Array<Record<string, unknown>> = [];
      for (const row of remaining) {
        const rowId = row.id as string;
        const { attempts, ageMs } = recordPullOrphanAttempt(entity, rowId, lastErrors.get(rowId), row);
        if (attempts >= ORPHAN_QUARANTINE_THRESHOLD && ageMs >= ORPHAN_MIN_AGE_MS) {
          console.error(
            `[sync] ${entity} row ${rowId} permanently quarantined after ${attempts} pull cycles over ` +
              `${Math.round(ageMs / 1000)}s of the same failure — it references data that no longer exists in ` +
              `the cloud. Skipping it so the rest of ${entity} can keep syncing; see sync_pull_orphans for details.`
          );
        } else {
          stillBlocking.push(row);
        }
      }
      if (stillBlocking.length > 0) {
        return;
      }
    }

    since = response.cursor;
    writeCursor(entity, since);
    hasMore = response.hasMore;
  }
}

/** Count of rows currently quarantined by the ORPHAN_QUARANTINE_THRESHOLD path in pullEntity above —
 * surfaced in the Cloud Sync tab so a permanent, unresolvable gap (e.g. a movement referencing a
 * deleted storefront) is visible to a human instead of only ever appearing in main-process logs. */
export function getPullOrphanCount(): number {
  const row = getDatabase().prepare("SELECT COUNT(*) as count FROM sync_pull_orphans").get() as { count: number };
  return row.count;
}

/**
 * Recovery path for rows quarantined by pullEntity's ORPHAN_QUARANTINE_THRESHOLD path above — there
 * was previously no way back from that state short of manual SQL surgery. Once a row is quarantined,
 * the entity's cursor has already advanced past its cloud `syncedAt` (see pullEntity: quarantining a
 * row is what LETS the cursor advance past an otherwise-blocked page), so the server's delta-pull
 * query (`syncedAt > cursor`) will never return it again — clicking "Sync Now" a hundred times does
 * nothing, by design, for a row in this state. This is intentionally a blunt full reset, not a precise
 * rewind to just before the earliest orphan: rewinding to the exact right instant per entity is easy
 * to get subtly wrong (an off-by-one leaves the same row excluded again), whereas re-pulling an
 * entity from scratch is always safe — every apply path here is idempotent (stock_movements' own
 * `alreadyApplied` check, every other entity's plain upsert-by-id) and cheap for the entity sizes this
 * has actually been needed for. Clears sync_pull_orphans for exactly the entities being reset so their
 * attempt/age counters start clean, not fresh reattempts warp against stale history.
 */
export function resyncOrphanedEntities(): { entities: SyncEntity[] } {
  const db = getDatabase();
  const rows = db.prepare("SELECT DISTINCT entity FROM sync_pull_orphans").all() as Array<{ entity: SyncEntity }>;
  const entities = rows.map((row) => row.entity);

  for (const entity of entities) {
    writeCursor(entity, new Date(0).toISOString());
    db.prepare("DELETE FROM sync_pull_orphans WHERE entity = ?").run(entity);
  }

  return { entities };
}

export async function pullDeltas(): Promise<void> {
  const identity = getCloudIdentity();
  if (!identity) return;

  for (const entity of SYNC_ENTITIES) {
    await pullEntity(identity.tenantId, identity.deviceId, entity);
  }

  writeSetting("sync_last_pull_at", new Date().toISOString());
}

// ---------------------------------------------------------------------------------------------
// DRIFT CHECK — local vs. remote row counts, reconciliation signal only
// ---------------------------------------------------------------------------------------------

export type DriftReport = Partial<Record<SyncEntity, DriftEntry>>;

/** A local-vs-remote count mismatch per entity is purely a SIGNAL for a human to investigate or
 * manually re-sync — this never auto-heals anything, per the explicit design constraint ("if the
 * count is different, something is wrong"). Persisted to app_settings so the Cloud Sync UI (and
 * getSyncSnapshot()) can show the last known drift without re-checking on every render. */
export async function checkDrift(): Promise<DriftReport | null> {
  const identity = getCloudIdentity();
  if (!identity) return null;

  const localCounts: Partial<Record<SyncEntity, number>> = {};
  for (const entity of SYNC_ENTITIES) {
    // A merely-held sale (sale_status = 'pending') deliberately never reaches the outbox at all —
    // see trg_sales_sync_ai/au's own WHEN clause in migrate.ts — so it will never exist in the
    // cloud either, by design, for as long as it's just sitting open in Checkout. Counting it here
    // would report a permanent false "drift" any time a cashier has an open ticket at the moment of
    // the check, indistinguishable from a genuine stuck row.
    const where = entity === "sales" ? " WHERE sale_status != 'pending'" : "";
    const row = getDatabase().prepare(`SELECT COUNT(*) as count FROM ${entity}${where}`).get() as { count: number };
    localCounts[entity] = row.count;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/sync/counts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: identity.tenantId, deviceId: identity.deviceId, entities: SYNC_ENTITIES }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as { counts: Partial<Record<SyncEntity, number>> } | null;
  if (!body) return null;

  const drift: DriftReport = {};
  for (const entity of SYNC_ENTITIES) {
    const local = localCounts[entity] ?? 0;
    const remote = body.counts[entity] ?? 0;
    if (local !== remote) {
      drift[entity] = { local, remote };
    }
  }

  writeSetting("sync_last_drift_check_at", new Date().toISOString());
  writeSetting("sync_drift_report", drift);
  return drift;
}

/** Always-visible per-entity status table for the Cloud Sync page (distinct from checkDrift() above,
 * which is a reconciliation SIGNAL that only surfaces entities where local/remote actually disagree).
 * Local figures (localCount/pendingCount/lastSyncedAt) are always cheap local reads — every synced
 * table already carries its own `sync_status`/`last_synced_at` columns (updated by markOutboxSynced),
 * so no new bookkeeping was needed. remoteCount is a best-effort live fetch off the same `/sync/counts`
 * endpoint checkDrift() uses; it stays `null` (never 0) if it can't be obtained (not activated,
 * offline, timeout) so the UI can render "—" instead of a misleading zero. */
export async function getEntitySyncOverview(): Promise<EntitySyncOverviewRow[]> {
  const db = getDatabase();
  const rows: EntitySyncOverviewRow[] = SYNC_ENTITIES.map((entity) => {
    // Same carve-out as checkDrift() above, for the same reason: a merely-held sale (sale_status =
    // 'pending') deliberately never reaches the outbox at all (see trg_sales_sync_ai/au's own WHEN
    // clause in migrate.ts), so it never has a remote counterpart to compare against — counting it
    // here inflated BOTH localCount and pendingCount for "sales" by however many open tickets happen
    // to be sitting in Checkout at read time, which is exactly what made this table disagree with
    // checkDrift()'s own banner just above it despite both claiming to describe the same moment.
    const where = entity === "sales" ? " WHERE sale_status != 'pending'" : "";
    const pendingExtra = entity === "sales" ? " AND sale_status != 'pending'" : "";
    const localRow = db.prepare(`SELECT COUNT(*) as count FROM ${entity}${where}`).get() as { count: number };
    const pendingRow = db
      .prepare(`SELECT COUNT(*) as count FROM ${entity} WHERE sync_status != 'synced'${pendingExtra}`)
      .get() as { count: number };
    const lastSyncedRow = db
      .prepare(`SELECT MAX(last_synced_at) as lastSyncedAt FROM ${entity}`)
      .get() as { lastSyncedAt: string | null };
    return {
      entity,
      localCount: localRow.count,
      remoteCount: null,
      pendingCount: pendingRow.count,
      lastSyncedAt: lastSyncedRow.lastSyncedAt
    };
  });

  const identity = getCloudIdentity();
  if (!identity) return rows;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/sync/counts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: identity.tenantId, deviceId: identity.deviceId, entities: SYNC_ENTITIES }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    return rows;
  }
  if (!response.ok) return rows;

  const body = (await response.json().catch(() => null)) as { counts: Partial<Record<SyncEntity, number>> } | null;
  if (!body) return rows;

  return rows.map((row) => ({ ...row, remoteCount: body.counts[row.entity] ?? 0 }));
}

// ---------------------------------------------------------------------------------------------
// Entry point — used by both the interval timer (bootstrap.ts) and the manual "Sync Now" button.
// ---------------------------------------------------------------------------------------------

/** Pull THEN push, always coupled — replaces what used to be two independently-scheduled timers
 * (push every 20s, pull every 10 minutes). Found live via real two-device testing that the pull
 * interval, not the push interval, is what actually bounds how long it takes another device to see
 * a change — with pull at 10 minutes, a second cashier blocks away could wait up to 10 minutes to
 * see a sale, and the same gap widens the window for the stock-request/sale-void double-approval
 * race. Pull-before-push (not the other order) means this device sees the latest cloud state before
 * deciding what it still needs to send, for whatever that's worth once a row-level natural-key
 * collision is at stake. Both push and pull are already fast no-ops the moment there's nothing to
 * do, so running them back-to-back on one 20-second timer costs nothing when idle. */
export async function syncCycle(): Promise<void> {
  // Covers BOTH the automatic timer (bootstrap.ts) and the manual "Sync Now" button (syncNow()
  // below calls this directly) uniformly — a lapsed tenant can't just repeatedly click Sync Now to
  // route around the intended pressure to pay. checkInWithServer() (the license heartbeat) is
  // deliberately NOT gated here — it must keep running so this device can learn a payment landed and
  // re-enable itself, not just from a fresh app restart.
  if (isSyncDisabledByGracePeriod()) return;

  // Each half runs independently and never lets the other's failure vanish silently — bootstrap.ts
  // calls this via `void syncCycle()` with no .catch, so an uncaught throw here would previously
  // become an unhandled promise rejection: invisible, and it would also skip pushOutbox() entirely
  // whenever pullDeltas() failed first. Caught live: a failure partway through applying one push
  // result used to propagate all the way up through here with zero logging.
  try {
    await pullDeltas();
  } catch (err) {
    console.error("[sync] pullDeltas failed:", err);
  }
  try {
    await pushOutbox();
  } catch (err) {
    console.error("[sync] pushOutbox failed:", err);
  }
  try {
    clearStalePhantomConflicts();
  } catch (err) {
    console.error("[sync] clearStalePhantomConflicts failed:", err);
  }
}

export async function syncNow(): Promise<void> {
  await syncCycle();
  await checkDrift();
}

// ---------------------------------------------------------------------------------------------
// CONFLICTS — Phase 2's manual-resolution surface (see sync-service.ts's pushRows on the SERVER
// for how a conflict is actually detected; markOutboxConflict above for how it's recorded).
// ---------------------------------------------------------------------------------------------

/** Per-entity human-readable label — used by both the Conflicts tab and the reconciliation-history
 * list below. Falls back to the bare id for any entity without one — extend as needed, not every
 * entity needs a friendly label to be useful here. */
const CONFLICT_LABEL_BUILDERS: Partial<Record<SyncEntity, (entityId: string) => string>> = {
  products: (id) => {
    const row = productRepository.findProductRowById(id);
    return row ? `${row.name} (${row.sku})` : id;
  },
  roles: (id) => {
    const row = roleRepository.findRoleRowById(id);
    return row ? row.role_name : id;
  },
  working_hours: (id) => {
    const row = workingHoursRepository.findWorkingHoursRowById(id);
    if (!row) return id;
    const location = locationRepository.findLocationRowById(row.location_id);
    return location ? `Working Hours — ${location.location_name}` : id;
  },
  employees: (id) => {
    const row = employeeRepository.findEmployeeRowById(id);
    return row ? `${row.first_name} ${row.last_name} (${row.employee_code})` : id;
  },
  payment_methods: (id) => {
    const row = paymentMethodRepository.findPaymentMethodRowById(id);
    return row ? row.name : id;
  },
  expense_categories: (id) => {
    const row = expenseCategoryRepository.findExpenseCategoryRowById(id);
    return row ? row.name : id;
  },
  locations: (id) => {
    const row = locationRepository.findLocationRowById(id);
    return row ? row.location_name : id;
  },
  categories: (id) => {
    const row = categoryRepository.findCategoryRowById(id);
    return row ? row.name : id;
  },
  riders: (id) => {
    const row = riderRepository.findRiderRowById(id);
    return row ? row.name : id;
  },
  suppliers: (id) => {
    const row = supplierRepository.findSupplierRowById(id);
    return row ? row.business_name : id;
  },
  customers: (id) => {
    const row = customerRepository.findCustomerRowById(id);
    return row ? row.name : id;
  },
  sales: (id) => {
    const row = saleRepository.findSaleRowById(id);
    if (!row) return id;
    return row.invoice_number ?? row.receipt_number ?? "Sale";
  },
  quotations: (id) => {
    const row = quotationRepository.findQuotationRowById(id);
    return row ? row.quotation_number : id;
  },
  purchases: (id) => {
    const row = purchaseRepository.findPurchaseRowById(id);
    return row ? row.purchase_number : id;
  },
  stock_requests: (id) => {
    const row = stockRequestRepository.findStockRequestRowById(id);
    return row ? row.request_number : id;
  },
  stock_receipts: (id) => {
    const row = stockReceiptRepository.findStockReceiptRowById(id);
    return row ? row.receipt_number : id;
  },
  expenses: (id) => {
    const row = expenseRepository.findExpenseRowById(id);
    return row ? row.expense_number : id;
  },
  salaries: (id) => {
    const row = salaryRepository.findSalaryRowById(id);
    return row ? `Payslip ${row.payslip_number}` : id;
  },
  recurring_bills: (id) => {
    const row = recurringBillRepository.findRecurringBillRowById(id);
    return row ? row.name : id;
  },
  sale_returns: (id) => {
    const row = saleReturnRepository.findSaleReturnDetailRowById(id);
    return row ? `Return — Receipt ${row.receipt_number ?? "?"}` : id;
  },
  sale_voids: (id) => {
    const row = saleVoidRepository.findSaleVoidDetailRowById(id);
    return row ? `Void — Receipt ${row.receipt_number ?? "?"}` : id;
  },
  invoice_cancellations: (id) => {
    const row = invoiceCancellationRepository.findInvoiceCancellationDetailRowById(id);
    return row ? `Cancellation — Invoice ${row.invoice_number ?? "?"}` : id;
  },
  // Stock movements and Main Store allocations have no document number of their own — the most
  // useful identifying label is which product moved and where, same information a person reading
  // the Stock Ledger would look for first.
  stock_movements: (id) => {
    const row = stockMovementRepository.findStockMovementRowById(id);
    if (!row) return id;
    const productName = productRepository.findProductRowById(row.product_id)?.name ?? "Unknown product";
    const sign = row.quantity_change > 0 ? "+" : "";
    return `Stock Movement — ${productName} (${sign}${row.quantity_change}) at ${row.location_name}`;
  },
  main_store_allocations: (id) => {
    const row = mainStoreAllocationRepository.findAllocationRowById(id);
    if (!row) return id;
    const productName = productRepository.findProductRowById(row.product_id)?.name ?? "Unknown product";
    const bucket = row.storefront_id ? (locationRepository.findLocationRowById(row.storefront_id)?.location_name ?? "a storefront") : "Unallocated";
    return `Main Store Allocation — ${productName} (${bucket})`;
  }
};

function labelFor(entity: SyncEntity, entityId: string): string {
  return CONFLICT_LABEL_BUILDERS[entity]?.(entityId) ?? entityId;
}

/** stock_movements/main_store_allocations sync directly against their own table, never through the
 * generic header-column machinery refColumnsFor (above) reads from — so they need their own short,
 * hand-written ref-field list here instead. Every other entity is already fully covered by
 * refColumnsFor. */
const EXTRA_CONFLICT_REF_FIELDS: Partial<Record<SyncEntity, Array<{ cloud: string; refEntity: SyncEntity }>>> = {
  stock_movements: [
    { cloud: "productId", refEntity: "products" },
    { cloud: "locationId", refEntity: "locations" },
    { cloud: "allocationStorefrontId", refEntity: "locations" }
  ],
  main_store_allocations: [
    { cloud: "productId", refEntity: "products" },
    { cloud: "storefrontId", refEntity: "locations" }
  ]
};

/** Replaces every ref-shaped field's raw id with the same human label labelFor uses for the
 * conflict's own row label — this is specifically what turns a diff row that used to read
 * "locationId: loc_8f3a... → loc_9d4e..." into "Location: Nairobi CBD → Westlands". Applied to BOTH
 * snapshots (they're already in the same id-space at this point — see this function's own caller for
 * why); a field whose id doesn't resolve to a local row falls back to the bare id, same as labelFor
 * everywhere else — not worse than the unresolved case, just not improved. */
function humanizeConflictSnapshot(entity: SyncEntity, snapshot: Record<string, unknown>): Record<string, unknown> {
  const refFields = [...refColumnsFor(entity), ...(EXTRA_CONFLICT_REF_FIELDS[entity] ?? [])];
  if (refFields.length === 0) return snapshot;
  const result = { ...snapshot };
  for (const field of refFields) {
    const value = result[field.cloud];
    if (typeof value === "string") {
      result[field.cloud] = labelFor(field.refEntity, value);
    }
  }
  return result;
}

type ConflictRow = {
  id: string;
  entity: SyncEntity;
  entity_id: string;
  remote_snapshot_json: string | null;
  updated_at: string;
};

/** Pure bookkeeping/timestamp fields every conflict-aware payload carries — expected to differ even
 * when the actual DATA is identical, so ignored when deciding whether a conflict has become moot.
 * Mirrors CloudSyncRoute.tsx's own DIFF_IGNORED_FIELDS exactly (kept in sync by hand — both are
 * short, stable lists that only change if a conflict-aware payload shape itself changes). */
const CONFLICT_IGNORED_FIELDS = new Set(["id", "tenantId", "deviceId", "syncedAt", "baseUpdatedAt", "localCreatedAt", "localUpdatedAt"]);

function snapshotsEffectivelyMatch(local: Record<string, unknown>, remote: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    if (CONFLICT_IGNORED_FIELDS.has(key)) continue;
    if (JSON.stringify(local[key]) !== JSON.stringify(remote[key])) return false;
  }
  return true;
}

/**
 * A 'conflict' outbox row can outlive whatever it was actually about: markOutboxSynced (called
 * after every FRESH successful push) deliberately only matches status IN ('queued', 'failed'), not
 * 'conflict' — a still-open conflict must never be silently clobbered by an unrelated push landing
 * for the same row. But that means once the real disagreement resolves through some OTHER path (a
 * later edit that happens to push clean, or a normal pull that lands the same data another way),
 * the ORIGINAL 'conflict' marker is left behind with nothing left to actually decide — caught live:
 * a product's Conflicts card showing only a name/category/timestamp and an EMPTY diff table, because
 * local and the stored remote snapshot had already become byte-identical on every real field. Rather
 * than chase every possible path that can make a conflict moot, this just checks the one fact that
 * actually matters — do local and remote now agree — and clears it if so. Run once at boot and again
 * after every sync cycle (see syncCycle's own call), so a phantom conflict never has to wait for a
 * person to notice and manually dismiss something there was nothing left to decide.
 */
function clearStalePhantomConflicts(): void {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT id, entity, entity_id, remote_snapshot_json, updated_at FROM sync_outbox WHERE status = 'conflict'`)
    .all() as ConflictRow[];

  for (const row of rows) {
    if (!row.remote_snapshot_json) continue;
    const rawPayload = PAYLOAD_BUILDERS[row.entity](row.entity_id);
    if (!rawPayload) continue;
    const localSnapshot = resolvePayloadRefsForPush(row.entity, rawPayload) as Record<string, unknown>;
    const remoteSnapshot = JSON.parse(row.remote_snapshot_json) as Record<string, unknown>;
    if (!snapshotsEffectivelyMatch(localSnapshot, remoteSnapshot)) continue;

    db.prepare(
      `UPDATE sync_outbox SET status = 'synced', remote_snapshot_json = NULL, updated_at = ?
       WHERE entity = ? AND entity_id = ? AND status = 'conflict'`
    ).run(new Date().toISOString(), row.entity, row.entity_id);
  }
}

/**
 * "Yours" is computed LIVE from the local row via PAYLOAD_BUILDERS — the exact same function push
 * itself uses — rather than read back from the outbox row's own payload_json column. That column
 * is a red herring: enqueueUnsyncedRows() always inserts it as the literal placeholder '{}' (see
 * its own INSERT statement), and nothing ever writes a real value into it afterward — payloads are
 * always built just-in-time at push time and never persisted back to the outbox row itself (see
 * pushOutbox's own doc comment: "not replayed from whatever the trigger captured at write time").
 * Caught live: every entry in the Conflicts tab showed a completely empty "Yours" column, for every
 * entity, not just the one that happened to surface it — the local row is deliberately left
 * untouched until the user resolves the conflict (see markOutboxConflict's own comment), so reading
 * it live at render time is always accurate, with no need to have captured anything at
 * conflict-detection time in the first place. Also run through resolvePayloadRefsForPush so any
 * ref-shaped field (e.g. roleId) shows the same cloud-resolved value "theirs" already does,
 * instead of a false-looking mismatch. */
export function listConflicts(): SyncConflictItem[] {
  // One row per (entity, entity_id), not one per raw sync_outbox row — a product edited twice
  // locally before a conflicting push leaves TWO 'queued' breadcrumb rows behind (each edit's own
  // AFTER UPDATE trigger insert; harmless for pushOutbox itself, which already groups by entity_id
  // via loadPendingOutboxGroups), and markOutboxConflict's WHERE clause has no LIMIT — it marks
  // every one of them 'conflict' in one UPDATE. Without this dedup, that showed as two (or more)
  // identical conflict cards for what a person experiences as ONE disagreement to resolve — caught
  // live: a product with no manual edit that day still carried an old queued breadcrumb from
  // earlier testing, and clicking "Keep Mine" on one card left the other still sitting there
  // looking unresolved (see resolveConflict's own matching fix, just below, for that half of it).
  const rows = getDatabase()
    .prepare(
      `SELECT so.id, so.entity, so.entity_id, so.remote_snapshot_json, so.updated_at
       FROM sync_outbox so
       JOIN (
         SELECT entity, entity_id, MAX(id) AS latest_id
         FROM sync_outbox
         WHERE status = 'conflict'
         GROUP BY entity, entity_id
       ) latest ON latest.latest_id = so.id
       ORDER BY so.updated_at DESC`
    )
    .all() as ConflictRow[];

  return rows.map((row) => {
    const rawPayload = PAYLOAD_BUILDERS[row.entity](row.entity_id);
    const localSnapshot = rawPayload ? (resolvePayloadRefsForPush(row.entity, rawPayload) as Record<string, unknown>) : {};
    const remoteSnapshot = row.remote_snapshot_json ? (JSON.parse(row.remote_snapshot_json) as Record<string, unknown>) : {};
    return {
      id: row.id,
      entity: row.entity,
      entityId: row.entity_id,
      label: labelFor(row.entity, row.entity_id),
      localSnapshot: humanizeConflictSnapshot(row.entity, localSnapshot),
      remoteSnapshot: humanizeConflictSnapshot(row.entity, remoteSnapshot),
      detectedAt: row.updated_at
    };
  });
}

/** Every natural-key reconciliation that's happened so far (see recordIdAlias/sync_id_aliases) —
 * two devices independently created what turned out to be the same real-world reference-data row,
 * merged instead of colliding, entirely silently until now. Purely informational: nothing here
 * needs a decision the way a Conflict does, it's just a "here's what got merged and when" trail so
 * a role's fields changing on their own doesn't look like a mystery. */
export function listRecentReconciliations(limit = 20): SyncReconciliationItem[] {
  const rows = getDatabase()
    .prepare(`SELECT entity, local_id, created_at FROM sync_id_aliases ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as Array<{ entity: SyncEntity; local_id: string; created_at: string }>;

  return rows.map((row) => ({
    entity: row.entity,
    localId: row.local_id,
    label: labelFor(row.entity, row.local_id),
    detectedAt: row.created_at
  }));
}

/** "theirs": applies the stored server snapshot locally with force:true (see applyPulledRow's own
 * comment on why this specific case needs to skip its usual "don't overwrite newer local" guard),
 * marks the outbox row synced. "mine": bumps the local row's own updated_at to now — a deliberate,
 * conscious supersede, distinct from the original edit time — and caches the remote snapshot's
 * localUpdatedAt as the new baseline (the server's actual current value), so the very next push
 * cycle succeeds unconditionally instead of conflicting again; puts the outbox row back to
 * 'queued' so that push actually happens. Either way remote_snapshot_json is cleared — the
 * conflict is resolved either direction. */
export function resolveConflict(outboxId: string, resolution: ConflictResolution): void {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT entity, entity_id, remote_snapshot_json FROM sync_outbox WHERE id = ? AND status = 'conflict'`)
    .get(outboxId) as { entity: SyncEntity; entity_id: string; remote_snapshot_json: string | null } | undefined;
  if (!row) return;

  const remoteSnapshot = row.remote_snapshot_json
    ? (JSON.parse(row.remote_snapshot_json) as Record<string, unknown>)
    : null;
  const now = new Date().toISOString();

  // Every row this WHERE matches, not just outboxId itself — listConflicts() only ever shows ONE
  // card per (entity, entity_id) (see its own comment on why more than one 'conflict' row can exist
  // for the same real row), so resolving that one card must clear every sibling breadcrumb sharing
  // its entity/entity_id too. Without this, clicking "Keep Mine"/"Keep Theirs" only touched the
  // single representative row listConflicts() happened to pick, leaving any duplicate still sitting
  // at status='conflict' — invisible until the next listConflicts() call re-surfaced it, looking
  // exactly like the conflict had never actually been resolved.
  if (resolution === "theirs") {
    if (remoteSnapshot) {
      applyPulledRow(row.entity, remoteSnapshot, true);
    }
    db.prepare(
      `UPDATE sync_outbox SET status = 'synced', remote_snapshot_json = NULL, updated_at = ?
       WHERE entity = ? AND entity_id = ? AND status = 'conflict'`
    ).run(now, row.entity, row.entity_id);
    return;
  }

  // table name === entity name for every synced entity (generic AND bespoke — documents included
  // now that they're conflict-aware too), so this needs no APPLY_CONFIG lookup at all.
  const table = row.entity;
  const remoteLocalUpdatedAt = remoteSnapshot?.localUpdatedAt as string | undefined;
  if (remoteLocalUpdatedAt) {
    db.prepare(`UPDATE ${table} SET synced_updated_at = ? WHERE id = ?`).run(remoteLocalUpdatedAt, row.entity_id);
  }
  db.prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(now, row.entity_id);
  db.prepare(
    `UPDATE sync_outbox SET status = 'queued', remote_snapshot_json = NULL, updated_at = ?
     WHERE entity = ? AND entity_id = ? AND status = 'conflict'`
  ).run(now, row.entity, row.entity_id);
}
