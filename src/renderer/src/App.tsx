import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { AppShell } from "@renderer/app/layouts/AppShell";
import { navItemsByKey } from "@renderer/app/layouts/navigation";
import { AccessDeniedRoute } from "@renderer/app/routes/AccessDeniedRoute";
import { ApprovalsRoute } from "@renderer/app/routes/ApprovalsRoute";
import { BusinessProfileRoute } from "@renderer/app/routes/BusinessProfileRoute";
import { CategoriesRoute } from "@renderer/app/routes/CategoriesRoute";
import { CheckoutRoute } from "@renderer/app/routes/CheckoutRoute";
import { CustomersRoute } from "@renderer/app/routes/CustomersRoute";
import { DashboardRoute } from "@renderer/app/routes/DashboardRoute";
import { EmployeesRoute } from "@renderer/app/routes/EmployeesRoute";
import { ExpensesRoute } from "@renderer/app/routes/ExpensesRoute";
import { InvoicesRoute } from "@renderer/app/routes/InvoicesRoute";
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

export function App(): React.JSX.Element {
  const hydrate = useAppStore((state) => state.hydrate);
  const authStatus = useAuthStore((state) => state.status);
  const hydrateAuth = useAuthStore((state) => state.hydrate);
  const activeNavKey = useUiStore((state) => state.activeNavKey);
  const { can } = usePermissions();

  useEffect(() => {
    void hydrate();
    void hydrateAuth();
  }, [hydrate, hydrateAuth]);

  if (authStatus === "loading") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-app text-muted">
        <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      </div>
    );
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
