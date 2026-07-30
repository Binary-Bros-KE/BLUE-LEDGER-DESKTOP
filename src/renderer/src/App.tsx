import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { AppShell } from "@renderer/app/layouts/AppShell";
import { navItemsByKey } from "@renderer/app/layouts/navigation";
import { AccessDeniedRoute } from "@renderer/app/routes/AccessDeniedRoute";
import { ActivationRoute } from "@renderer/app/routes/ActivationRoute";
import { ApprovalsRoute } from "@renderer/app/routes/ApprovalsRoute";
import { BusinessProfileRoute } from "@renderer/app/routes/BusinessProfileRoute";
import { CategoriesRoute } from "@renderer/app/routes/CategoriesRoute";
import { CheckoutRoute } from "@renderer/app/routes/CheckoutRoute";
import { CloudSyncRoute } from "@renderer/app/routes/CloudSyncRoute";
import { CustomersRoute } from "@renderer/app/routes/CustomersRoute";
import { DashboardRoute } from "@renderer/app/routes/DashboardRoute";
import { EmployeesRoute } from "@renderer/app/routes/EmployeesRoute";
import { ExpensesRoute } from "@renderer/app/routes/ExpensesRoute";
import { ImportRoute } from "@renderer/app/routes/ImportRoute";
import { InvoicesRoute } from "@renderer/app/routes/InvoicesRoute";
import { LicenseBlockedRoute } from "@renderer/app/routes/LicenseBlockedRoute";
import { LoginRoute } from "@renderer/app/routes/LoginRoute";
import { MainStoreRoute } from "@renderer/app/routes/MainStoreRoute";
import { PaymentMethodsRoute } from "@renderer/app/routes/PaymentMethodsRoute";
import { PlaceholderRoute } from "@renderer/app/routes/PlaceholderRoute";
import { SalesReportRoute } from "@renderer/app/routes/SalesReportRoute";
import { InventoryReportRoute } from "@renderer/app/routes/InventoryReportRoute";
import { ProductsReportRoute } from "@renderer/app/routes/ProductsReportRoute";
import { CustomersReportRoute } from "@renderer/app/routes/CustomersReportRoute";
import { SuppliersReportRoute } from "@renderer/app/routes/SuppliersReportRoute";
import { ProductsRoute } from "@renderer/app/routes/ProductsRoute";
import { PurchasesRoute } from "@renderer/app/routes/PurchasesRoute";
import { QuotationsRoute } from "@renderer/app/routes/QuotationsRoute";
import { ReceiptsRoute } from "@renderer/app/routes/ReceiptsRoute";
import { RidersRoute } from "@renderer/app/routes/RidersRoute";
import { RolesRoute } from "@renderer/app/routes/RolesRoute";
import { SalariesRoute } from "@renderer/app/routes/SalariesRoute";
import { SettingsRoute } from "@renderer/app/routes/SettingsRoute";
import { StockLedgerRoute } from "@renderer/app/routes/StockLedgerRoute";
import { StockRequestsRoute } from "@renderer/app/routes/StockRequestsRoute";
import { StorefrontsRoute } from "@renderer/app/routes/StorefrontsRoute";
import { SuppliersRoute } from "@renderer/app/routes/SuppliersRoute";
import { TransactionsRoute } from "@renderer/app/routes/TransactionsRoute";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { useAuthStore } from "@renderer/shared/stores/auth-store";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import { computeGraceStatus } from "@shared/lib/grace-period";

export function App(): React.JSX.Element {
  const context = useAppStore((state) => state.context);
  const hydrate = useAppStore((state) => state.hydrate);
  const authStatus = useAuthStore((state) => state.status);
  const hydrateAuth = useAuthStore((state) => state.hydrate);
  const activeNavKey = useUiStore((state) => state.activeNavKey);
  const { can } = usePermissions();

  useEffect(() => {
    void hydrate();
    void hydrateAuth();

    // The main process re-checks the license with the server on its own timer (see
    // license-service.ts / bootstrap.ts) — this just re-reads whatever it last cached, so an
    // already-open app eventually notices a suspension without needing a restart. Bounded,
    // reasonable propagation delay; never blocks anything while it's pending.
    const interval = setInterval(() => void hydrate(), 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [hydrate, hydrateAuth]);

  if (!context || authStatus === "loading") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-app text-muted">
        <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  // A fresh install can't be used at all until this succeeds — checked before even the employee
  // login screen, since there's nothing to log into yet without a real tenant identity.
  if (!context.tenant.activated) {
    return <ActivationRoute />;
  }

  // The actual enforcement point for a revoked license — this status only ever comes from a real
  // server response (activation or heartbeat), so there's no local way around it.
  if (context.tenant.licenseStatus === "suspended" || context.tenant.licenseStatus === "cancelled") {
    return <LicenseBlockedRoute status={context.tenant.licenseStatus} />;
  }

  // Only a MONTHLY subscription's grace period ever hard-locks the app this way — see
  // shared/lib/grace-period.ts. LIFETIME/CUSTOM tenants never hit this branch (hardLock is always
  // false for them); they only ever see LoginRoute's softer warning banner.
  const grace = computeGraceStatus(context.tenant.nextDueDate, context.tenant.subscriptionType, context.tenant.licenseStatus);
  if (grace.state === "expired" && grace.hardLock) {
    return <LicenseBlockedRoute status="grace_expired" />;
  }

  if (authStatus === "unauthenticated") {
    return <LoginRoute />;
  }

  const activeItem = navItemsByKey[activeNavKey];
  const isDashboard = activeNavKey === "dashboard" || !activeItem;
  const hasAccess = isDashboard || can(activeItem.permissionModule, "view");

  return (
    <AppShell>
      {!hasAccess ? (
        <AccessDeniedRoute pageLabel={activeItem.label} />
      ) : isDashboard ? (
        <DashboardRoute />
      ) : activeNavKey === "business-profile" ? (
        <BusinessProfileRoute />
      ) : activeNavKey === "storefronts" ? (
        <StorefrontsRoute />
      ) : activeNavKey === "categories" ? (
        <CategoriesRoute />
      ) : activeNavKey === "products" ? (
        <ProductsRoute />
      ) : activeNavKey === "main-store" ? (
        <MainStoreRoute />
      ) : activeNavKey === "stock" ? (
        <StockLedgerRoute />
      ) : activeNavKey === "stock-requests" ? (
        <StockRequestsRoute />
      ) : activeNavKey === "employees" ? (
        <EmployeesRoute />
      ) : activeNavKey === "roles" ? (
        <RolesRoute />
      ) : activeNavKey === "salaries" ? (
        <SalariesRoute />
      ) : activeNavKey === "payment-methods" ? (
        <PaymentMethodsRoute />
      ) : activeNavKey === "customers" ? (
        <CustomersRoute />
      ) : activeNavKey === "suppliers" ? (
        <SuppliersRoute />
      ) : activeNavKey === "riders" ? (
        <RidersRoute />
      ) : activeNavKey === "purchases" ? (
        <PurchasesRoute />
      ) : activeNavKey === "expenses" ? (
        <ExpensesRoute />
      ) : activeNavKey === "checkout" ? (
        <CheckoutRoute />
      ) : activeNavKey === "receipts" ? (
        <ReceiptsRoute />
      ) : activeNavKey === "invoices" ? (
        <InvoicesRoute />
      ) : activeNavKey === "quotations" ? (
        <QuotationsRoute />
      ) : activeNavKey === "approvals" ? (
        <ApprovalsRoute />
      ) : activeNavKey === "transactions" ? (
        <TransactionsRoute />
      ) : activeNavKey === "reports-sales" ? (
        <SalesReportRoute />
      ) : activeNavKey === "reports-inventory" ? (
        <InventoryReportRoute />
      ) : activeNavKey === "reports-products" ? (
        <ProductsReportRoute />
      ) : activeNavKey === "reports-customers" ? (
        <CustomersReportRoute />
      ) : activeNavKey === "reports-suppliers" ? (
        <SuppliersReportRoute />
      ) : activeNavKey === "settings" ? (
        <SettingsRoute />
      ) : activeNavKey === "sync" ? (
        <CloudSyncRoute />
      ) : activeNavKey === "data-import" ? (
        <ImportRoute />
      ) : (
        <PlaceholderRoute
          icon={activeItem.icon}
          title={activeItem.label}
          description={activeItem.description}
        />
      )}
    </AppShell>
  );
}
