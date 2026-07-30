import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BarChart3,
  Bike,
  Boxes,
  Building2,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  FileText,
  FolderTree,
  LayoutDashboard,
  Package,
  PackagePlus,
  Receipt,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  Users,
  UserCog,
  Wallet,
  WalletMinimal,
  Warehouse
} from "lucide-react";
import type { PermissionModuleKey } from "@shared/types/role";

export type NavItem = {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Which permission module governs visibility/access for this item. */
  permissionModule: PermissionModuleKey;
  badge?: string;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        key: "dashboard",
        label: "Dashboard",
        description: "Live snapshot & KPIs",
        icon: LayoutDashboard,
        permissionModule: "dashboard"
      }
    ]
  },
  {
    title: "Sales",
    items: [
      {
        key: "checkout",
        label: "Checkout",
        description: "New sale & payments",
        icon: ShoppingCart,
        permissionModule: "sales"
      },
      {
        key: "receipts",
        label: "Receipts",
        description: "Transaction history",
        icon: ReceiptText,
        permissionModule: "sales"
      },
      {
        key: "invoices",
        label: "Invoices",
        description: "Wholesale billing & payments",
        icon: FileText,
        permissionModule: "sales"
      },
      {
        key: "quotations",
        label: "Quotations",
        description: "Price offers & conversions",
        icon: ClipboardList,
        permissionModule: "quotations"
      },
      {
        key: "customers",
        label: "Customers",
        description: "Customer directory",
        icon: Users,
        permissionModule: "customers"
      },
      {
        key: "riders",
        label: "Riders",
        description: "Delivery couriers",
        icon: Bike,
        permissionModule: "riders"
      },
            {
        key: "payment-methods",
        label: "Payment Methods",
        description: "How customers can pay",
        icon: CreditCard,
        permissionModule: "payment_methods"
      },
      {
        key: "approvals",
        label: "Approvals",
        description: "Returns & voids awaiting sign-off",
        icon: ClipboardCheck,
        permissionModule: "approvals"
      },
      {
        key: "transactions",
        label: "Transactions",
        description: "Every payment, in one place",
        icon: ArrowLeftRight,
        permissionModule: "sales"
      }
    ]
  },
  {
    title: "Inventory",
    items: [
      {
        key: "categories",
        label: "Categories",
        description: "Organize your catalog",
        icon: FolderTree,
        permissionModule: "categories"
      },
      {
        key: "products",
        label: "Products",
        description: "Catalog & pricing",
        icon: Package,
        permissionModule: "products"
      },
      {
        key: "main-store",
        label: "Main Store",
        description: "Central stock & distribution",
        icon: Boxes,
        permissionModule: "main_store"
      },
      {
        key: "stock",
        label: "Stock Ledger",
        description: "Every stock movement, in one feed",
        icon: Warehouse,
        permissionModule: "inventory"
      },
      {
        key: "stock-requests",
        label: "Stock Requests",
        description: "Request stock from Main Store",
        icon: PackagePlus,
        permissionModule: "stock_requests"
      },
      {
        key: "suppliers",
        label: "Suppliers",
        description: "Vendors & purchase orders",
        icon: Truck,
        permissionModule: "suppliers"
      },
      {
        key: "purchases",
        label: "Purchases",
        description: "Purchase orders & receiving",
        icon: ShoppingBag,
        permissionModule: "purchases"
      }
    ]
  },
  {
    title: "Finance",
    items: [
      {
        key: "expenses",
        label: "Expenses",
        description: "Operational costs & spending",
        icon: Wallet,
        permissionModule: "expenses"
      }
    ]
  },
  {
    title: "Insights",
    items: [
      {
        key: "reports-sales",
        label: "Sales Report",
        description: "Daily summary, trends & breakdowns",
        icon: BarChart3,
        permissionModule: "reports"
      },
      {
        key: "reports-inventory",
        label: "Inventory Report",
        description: "Stock levels & movement",
        icon: Boxes,
        permissionModule: "reports"
      },
      {
        key: "reports-products",
        label: "Products Report",
        description: "Performance by product",
        icon: Package,
        permissionModule: "reports"
      },
      {
        key: "reports-customers",
        label: "Customers Report",
        description: "Buying behavior & balances",
        icon: Users,
        permissionModule: "reports"
      },
      {
        key: "reports-suppliers",
        label: "Suppliers Report",
        description: "Purchasing & spend by supplier",
        icon: Truck,
        permissionModule: "reports"
      }
    ]
  },
    {
    title: "Team",
    items: [
      {
        key: "employees",
        label: "Employees",
        description: "Staff accounts & access",
        icon: UserCog,
        permissionModule: "employees"
      },
      {
        key: "roles",
        label: "Roles & Permissions",
        description: "Permission groups",
        icon: ShieldCheck,
        permissionModule: "roles"
      },
      {
        key: "salaries",
        label: "Employee Salaries",
        description: "Process payroll & payslips",
        icon: WalletMinimal,
        permissionModule: "salaries"
      }
    ]
  },
  {
    title: "Business",
    items: [
      {
        key: "business-profile",
        label: "Business Profile",
        description: "Business & license info",
        icon: Building2,
        permissionModule: "business_profile"
      },
      {
        key: "storefronts",
        label: "Storefronts",
        description: "Branches & warehouses",
        icon: Store,
        permissionModule: "locations"
      },
      {
        key: "data-import",
        label: "Data Import",
        description: "Bulk import products, customers & suppliers",
        icon: FileSpreadsheet,
        permissionModule: "data_import"
      }
    ]
  },

  {
    title: "System",
    items: [
      {
        key: "sync",
        label: "Cloud Sync",
        description: "Sync status & queue",
        icon: RefreshCw,
        permissionModule: "cloud_sync"
      },
      {
        key: "settings",
        label: "Settings",
        description: "Preferences & theme",
        icon: Settings,
        permissionModule: "settings"
      },
      {
        key: "payments",
        label: "Payments",
        description: "Subscription invoices & payment history",
        icon: Receipt,
        // Same gating as when this lived inside Business Profile — preserves the exact same
        // effective access for every existing role, no role/permission data needs to change.
        permissionModule: "business_profile"
      }
    ]
  }
];

export const navItemsByKey: Record<string, NavItem> = Object.fromEntries(
  navGroups.flatMap((group) => group.items.map((item) => [item.key, item]))
);
