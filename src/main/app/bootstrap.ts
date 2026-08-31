import electron from "electron";
import { migrateDatabase } from "@main/database/migrate";
import { ensureDefaultExpenseCategories } from "@main/services/expense-category-service";
import { ensureExpensesHaveStorefront } from "@main/services/expense-service";
import { registerIpcHandlers } from "@main/ipc/register";
import { ensureDefaultSystemEmployee } from "@main/services/employee-service";
import { ensureMainStoreLocation } from "@main/services/location-service";
import { reconcileMainStoreAllocations } from "@main/services/main-store-service";
import { ensureCreditPaymentMethodDeactivated, ensureDefaultPaymentMethods } from "@main/services/payment-method-service";
import {
  consolidateToFourCoreRoles,
  ensureDataImportPermission,
  ensureDefaultRoles,
  ensureExpensesPermissions,
  ensureLocalPurchasesPermission,
  ensureMainStorePermission,
  ensureManagerEmployeesPermission,
  ensureOwnerAppPermission,
  ensureQuotationsPermission,
  ensureRidersPermission,
  ensureSalariesPermission,
  ensureStockRequestsPermission,
  ensureStorekeeperCategoriesPermission,
  ensureStorekeeperProductPermissions,
  ensureSuperAdminFlag,
  ensureSuperAdminRole,
  fixCashierPermissionDrift,
  restrictReportsToAdminRoles
} from "@main/services/role-service";
import { ensureTenantContext } from "@main/services/tenant-service";
import { checkInWithServer } from "@main/services/license-service";
import { checkDrift, syncCycle } from "@main/services/sync-engine";
import { checkForUpdates, isUpdateInstallInProgress } from "@main/services/update-service";
import { createMainWindow } from "@main/windows/main-window";
import { seedDemoData } from "@main/dev/seed-demo-data";
import { verifyImport } from "@main/dev/verify-import";

const { app, dialog } = electron;

/** The plan's own design calls for pushing "debounced ~5s after the outbox goes non-empty" — but
 * doing that for real would mean instrumenting every one of the 20+ service files that write to a
 * synced table with an explicit "wake up the sync engine" call, which is exactly the
 * hand-instrumentation pain the outbox-via-triggers design was built to avoid in the first place.
 * A short fixed interval gets the same practical outcome (queued changes leave quickly) with zero
 * coupling: syncCycle() itself is a fast no-op the moment there's nothing queued and nothing new to
 * pull.
 *
 * Pull and push used to run on independently-scheduled timers (push every 20s, pull every 10
 * minutes) — found live via real two-device testing that the SLOWER one, pull, is what actually
 * bounds how long another device takes to see a change (up to 10 minutes for a sale to appear on a
 * second till, and the same gap widens the window for the stock-request/sale-void double-approval
 * race). Coupled onto one interval now — see syncCycle() in sync-engine.ts. Chose to keep the
 * interval itself at 20s rather than lengthen it for server load: at the near-term tenant counts
 * this business is actually planning for, a few hundred requests/second (even at ~20,000 tenants) is
 * comfortably within what a modestly-sized VPS handles: the real fix for load at real scale is a
 * server-push notification channel instead of every device polling on a timer, not a slower poll —
 * revisit that once tenant counts are in the hundreds, not by slowing this down pre-emptively.
 *
 * The license/business-profile heartbeat (checkInWithServer) used to run on its OWN separate
 * 4-hour timer — a leftover from when it only checked license validity (genuinely rarely-changing).
 * Once business-profile pull got added to that same heartbeat, that interval became the bottleneck
 * for an edit reaching another device, up to 4 hours later, while every other entity propagates in
 * this same 20s window. Folded onto this one interval instead: a single tenant-row check is far
 * cheaper per request than the entity sync already running here, so it doesn't change the "a modest
 * VPS handles this fine" conclusion above — it's strictly less total work than what already runs on
 * this clock. checkInWithServer() already never throws (see its own doc comment), so calling it
 * alongside syncCycle() needs no extra error isolation. */
const SYNC_INTERVAL_MS = 20 * 1000;
const SYNC_DRIFT_CHECK_INTERVAL_MS = 30 * 60 * 1000;
// A new app version isn't urgent the way license/data sync is — this only needs to notice within a
// few hours of a release going out, not seconds. Deliberately its own interval, not folded onto
// SYNC_INTERVAL_MS the way checkInWithServer was — update checks are a genuinely separate concern
// (a release feed, not billing/data state) and don't need to run every 20 seconds.
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export async function bootstrap(): Promise<void> {
  await app.whenReady();

  // Absolute first thing after whenReady — before the database, before any window. See
  // update-service.ts's own doc comment for the real field failure this guards against: this
  // process could be the OLD version's exe, relaunched by the user seconds after clicking
  // "Restart & Update", while the NSIS installer it triggered is still mid-write to this exact
  // install directory. Backing off here (never touching the DB, never opening a window) is what
  // keeps that collision from corrupting the install — the installer gets the files to itself.
  if (isUpdateInstallInProgress()) {
    dialog.showMessageBoxSync({
      type: "info",
      title: "Blue Ledger POS",
      message: "Blue Ledger is finishing an update.",
      detail: "This only takes a few seconds — please try opening it again shortly."
    });
    app.exit(0);
    return;
  }

  app.setAppUserModelId("com.blueledger.desktop");

  migrateDatabase();
  const tenant = ensureTenantContext();
  ensureDefaultRoles(tenant.tenantId);
  ensureSuperAdminRole(tenant.tenantId);
  ensureSuperAdminFlag(tenant.tenantId);
  consolidateToFourCoreRoles(tenant.tenantId);
  ensureQuotationsPermission(tenant.tenantId);
  ensureStorekeeperProductPermissions(tenant.tenantId);
  ensureStorekeeperCategoriesPermission(tenant.tenantId);
  ensureExpensesPermissions(tenant.tenantId);
  ensureSalariesPermission(tenant.tenantId);
  ensureRidersPermission(tenant.tenantId);
  ensureLocalPurchasesPermission(tenant.tenantId);
  ensureStockRequestsPermission(tenant.tenantId);
  ensureMainStorePermission(tenant.tenantId);
  ensureManagerEmployeesPermission(tenant.tenantId);
  ensureDataImportPermission(tenant.tenantId);
  ensureOwnerAppPermission(tenant.tenantId);
  restrictReportsToAdminRoles(tenant.tenantId);
  fixCashierPermissionDrift(tenant.tenantId);
  ensureMainStoreLocation(tenant.tenantId);
  reconcileMainStoreAllocations(tenant.tenantId);
  ensureDefaultSystemEmployee(tenant.tenantId);
  ensureDefaultPaymentMethods(tenant.tenantId);
  ensureCreditPaymentMethodDeactivated(tenant.tenantId);
  ensureDefaultExpenseCategories(tenant.tenantId);
  ensureExpensesHaveStorefront(tenant.tenantId);

  if (process.env.BLUE_LEDGER_SEED_DEMO === "1") {
    try {
      await seedDemoData();
    } catch (error) {
      console.error("[seed] FAILED:", error);
    } finally {
      app.quit();
    }
    return;
  }

  // Temporary verification scaffolding for the bulk Import feature — see verify-import.ts's own
  // doc comment. Only ever point BLUE_LEDGER_DATA_DIR at a scratch copy of the DB when using this.
  if (process.env.BLUE_LEDGER_VERIFY_IMPORT === "1") {
    try {
      await verifyImport();
    } catch (error) {
      console.error("[verify-import] FAILED:", error);
    } finally {
      app.quit();
    }
    return;
  }

  registerIpcHandlers();

  // Best-effort, non-blocking — never delay app startup on a network call. Every one of these is a
  // silent no-op when offline or not yet activated (see license-service.ts / sync-engine.ts's
  // getCloudIdentity()). Each also runs immediately at boot, not just on its interval — without
  // this, a freshly-activated device (its very first launch, nothing pulled yet) would sit with an
  // empty local database for up to SYNC_INTERVAL_MS before its first pull ever fired, since
  // setInterval's first tick only happens AFTER the interval elapses. A real device found this
  // live: a second install activated against an existing tenant couldn't log in (no employees
  // pulled yet) and had no way to know a pull was even coming.
  void checkInWithServer();
  void syncCycle();
  void checkDrift();
  void checkForUpdates();
  setInterval(() => {
    void checkInWithServer();
    void syncCycle();
  }, SYNC_INTERVAL_MS);
  // reconcileMainStoreAllocations rides the SAME interval as checkDrift (not just once at boot) —
  // its own root cause (main_store_allocations is a conflict-aware, separately-synced table that can
  // silently miss an update a two-device race touches, unlike the always-correct append-only ledger
  // — see its own doc comment) isn't itself patched, only its effect self-healed here, and a real POS
  // terminal can stay open for a full business day between restarts. Never awaited/blocking, and a
  // pure local DB operation with no network dependency, so tying it to checkDrift's cadence is just
  // reusing an existing "periodically re-verify correctness" clock, not a real coupling between them.
  setInterval(() => {
    void checkDrift();
    try {
      reconcileMainStoreAllocations(tenant.tenantId);
    } catch (err) {
      console.error("[bootstrap] reconcileMainStoreAllocations failed:", err);
    }
  }, SYNC_DRIFT_CHECK_INTERVAL_MS);
  setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);

  await createMainWindow();

  app.on("activate", async () => {
    if (process.platform === "darwin") {
      await createMainWindow();
    }
  });
}
