import * as draftRepository from "@main/database/repositories/invoice-draft-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { invoiceDraftSaveSchema } from "@shared/schemas/invoice-draft";
import type { InvoiceDraft, InvoiceDraftListItem } from "@shared/types/invoice-draft";

/** Generous ceiling for one form snapshot — a real invoice is a few KB; this only stops a runaway
 * payload from bloating the local database. */
const MAX_FORM_JSON_BYTES = 2_000_000;

function mapListRow(row: draftRepository.InvoiceDraftRow): InvoiceDraftListItem {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    storefrontId: row.storefront_id,
    itemCount: row.item_count,
    estimatedTotalCents: row.estimated_total_cents,
    createdByName: row.created_by_name ?? "—",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Same visibility rule as every branch-scoped document: a storefront's staff see that storefront's
 * drafts (plus storefront-less ones); an unassigned Super Admin sees every draft on this device.
 * "Not found" rather than a permission error for anything outside that, so ids can't be probed. */
function requireVisibleRow(id: string): draftRepository.InvoiceDraftRow {
  const row = draftRepository.findDraftRowById(id);
  const branchScope = getCurrentBranchScope();
  if (
    !row ||
    row.tenant_id !== getCurrentTenant().tenantId ||
    (branchScope && row.storefront_id !== null && row.storefront_id !== branchScope)
  ) {
    throw new Error("Draft not found — it may already have been turned into an invoice or deleted");
  }
  return row;
}

// Drafts are an invoice-creation aid, so they ride the same permission as creating an invoice.

export function listInvoiceDrafts(): InvoiceDraftListItem[] {
  requirePermission("sales", "create");
  return draftRepository.findAllDraftRows(getCurrentTenant().tenantId, getCurrentBranchScope()).map(mapListRow);
}

export function getInvoiceDraft(id: string): InvoiceDraft {
  requirePermission("sales", "create");
  const row = requireVisibleRow(id);
  let form: Record<string, unknown> = {};
  try {
    form = JSON.parse(row.form_json) as Record<string, unknown>;
  } catch {
    // A corrupt snapshot still opens (as an empty form) rather than leaving an undeletable dead row.
  }
  return { ...mapListRow(row), form };
}

export function saveInvoiceDraft(input: unknown): InvoiceDraft {
  requirePermission("sales", "create");
  const parsed = invoiceDraftSaveSchema.parse(input);
  const formJson = JSON.stringify(parsed.form);
  if (formJson.length > MAX_FORM_JSON_BYTES) {
    throw new Error("This draft is too large to save");
  }

  // A branch-scoped user's draft always belongs to their own storefront, same as the invoice it
  // will become; only an unassigned user's chosen storefront (possibly none yet) is taken as sent.
  const fields: draftRepository.DraftFields = {
    customerId: parsed.customerId ?? null,
    customerName: parsed.customerName ?? null,
    storefrontId: getCurrentBranchScope() ?? parsed.storefrontId ?? null,
    itemCount: parsed.itemCount,
    estimatedTotalCents: parsed.estimatedTotalCents,
    formJson
  };

  if (parsed.id) {
    requireVisibleRow(parsed.id);
    draftRepository.updateDraftRow(parsed.id, fields);
    return getInvoiceDraft(parsed.id);
  }
  const id = draftRepository.insertDraftRow(getCurrentTenant().tenantId, getCurrentEmployeeId(), fields);
  return getInvoiceDraft(id);
}

/** A real DELETE — the entire reason drafts are local-only. Deleting one that's already gone is a
 * no-op, so a double-click or a race with "create invoice" never surfaces an error. */
export function deleteInvoiceDraft(id: string): void {
  requirePermission("sales", "create");
  if (!draftRepository.findDraftRowById(id)) return;
  requireVisibleRow(id);
  draftRepository.deleteDraftRow(id);
}
