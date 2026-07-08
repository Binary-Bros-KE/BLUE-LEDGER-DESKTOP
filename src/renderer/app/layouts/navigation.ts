import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Building2,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  FolderTree,
  LayoutDashboard,
  Package,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  Users,
  UserCog,
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
        key: "stock",
        label: "Stock Ledger",
        description: "Levels & stock takes",
        icon: Warehouse,
        permissionModule: "inventory"
      },
      {
        key: "suppliers",
        label: "Suppliers",
        description: "Vendors & purchase orders",
        icon: Truck,
        permissionModule: "suppliers"
      }
    ]
  },
  {
    title: "Insights",
    items: [
      {
        key: "reports",
        label: "Reports",
        description: "Sales & performance",
        icon: BarChart3,
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
      }
    ]
  }
];

export const navItemsByKey: Record<string, NavItem> = Object.fromEntries(
  navGroups.flatMap((group) => group.items.map((item) => [item.key, item]))
);
