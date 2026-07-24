import type { AppContext, TenantContext, TenantRecord } from "./tenant";
import type { PaymentHistoryResult } from "./subscription-payment";
import type { BrandTheme } from "./theme";
import type { AuthSession } from "./auth";
import type { Category, CategoryStatus } from "./category";
import type { Customer, CustomerStatus } from "./customer";
import type { Employee, EmployeeListItem, EmployeeStatus } from "./employee";
import type { InventoryBalance, LocationStockLevel } from "./inventory";
import type { InventoryReportData } from "./inventory-report";
import type { InvoiceListItem, InvoiceSummary } from "./invoice";
import type { Location, LocationStatus } from "./location";
import type { PaymentMethod } from "./payment-method";
import type { MainStoreAllocationSummary, MainStoreProductDetail, MainStoreProductRow } from "./main-store";
import type { Product, ProductListItem, ProductStatus, ProductStockSummary } from "./product";
import type { ProductSalesHistoryEntry, ProductsPerformanceReport } from "./product-report";
import type { CustomerPurchaseHistoryEntry, OutstandingInvoicesSummary, TopCustomerRow } from "./customer-report";
import type { OutstandingPurchasesSummary, SupplierPurchaseHistoryEntry, SupplierSpendRow } from "./supplier-report";
import type { PrinterActionResult, PrinterSettings } from "./printer";
import type { Expense, ExpenseSummary } from "./expense";
import type { ExportListRequest } from "./export";
import type { ReportExportRequest } from "./report-export";
import type { ExpenseCategory, ExpenseCategoryStatus } from "./expense-category";
import type { Purchase, PurchaseListItem, PurchaseSummary } from "./purchase";
import type { Salary } from "./salary";
import type {
  CancelledPurchasesReport,
  DateRangeInput,
  MySaleEntry,
  PaymentTransactionRow,
  SalesByEmployeeRow,
  SalesByPaymentMethodRow,
  SalesByStorefrontRow,
  SalesFinancialOverview,
  SalesTransactionRow,
  SalesTrendWindowInput,
  SalesTrendWindowResult,
} from "./report";
import type { Quotation, QuotationListItem, QuotationStatus, QuotationStockCheckItem, QuotationSummary } from "./quotation";
import type { Role, RoleListItem, RolePickerItem } from "./role";
import type { Supplier, SupplierStatus } from "./supplier";
import type { Rider, RiderStatus } from "./rider";
import type { PendingSaleListItem, Sale, SaleDelivery, SaleListItem } from "./sale";
import type { SaleReturn } from "./sale-return";
import type { SaleVoid } from "./sale-void";
import type { RecurringBill } from "./recurring-bill";
import type { StockMovement, StockMovementFeedItem, StockTransferResult } from "./stock-movement";
import type { StockRequest, StockRequestListItem } from "./stock-request";
import type {
  ConflictResolution,
  EntitySyncOverviewRow,
  SyncConflictItem,
  SyncQueueItem,
  SyncReconciliationItem,
  SyncSnapshot
} from "./sync";
import type {
  ImportCommitRequest,
  ImportCommitResult,
  ImportEntityType,
  ImportParsedFile,
  ImportPreviewRequest,
  ImportPreviewResult
} from "./import";
import type { ShareDocumentEntity } from "./share";

export type IpcInvokeMap = {
  "app:get-context": {
    args: [];
    result: AppContext;
  };
  "activation:activate": {
    args: [string];
    result: TenantContext;
  };
  "activation:heartbeat": {
    args: [];
    result: TenantContext;
  };
  "activation:payments": {
    args: [];
    result: PaymentHistoryResult | null;
  };
  "auth:login": {
    args: [Record<string, unknown>];
    result: AuthSession;
  };
  "auth:logout": {
    args: [];
    result: { success: true };
  };
  "auth:get-session": {
    args: [];
    result: AuthSession | null;
  };
  "tenant:get-current": {
    args: [];
    result: AppContext["tenant"];
  };
  "tenant:get-profile": {
    args: [];
    result: TenantRecord;
  };
  "tenant:update-profile": {
    args: [Record<string, unknown>];
    result: TenantRecord;
  };
  "tenant:pick-logo": {
    args: [];
    result: string | null;
  };
  "tenant:read-image-preview": {
    args: [string];
    result: string | null;
  };
  "location:list": {
    args: [];
    result: Location[];
  };
  "location:get": {
    args: [string];
    result: Location;
  };
  "location:create": {
    args: [Record<string, unknown>];
    result: Location;
  };
  "location:update": {
    args: [string, Record<string, unknown>];
    result: Location;
  };
  "location:set-status": {
    args: [string, LocationStatus];
    result: Location;
  };
  "location:pick-logo": {
    args: [];
    result: string | null;
  };
  "location:read-logo-preview": {
    args: [string];
    result: string | null;
  };
  "category:list": {
    args: [];
    result: Category[];
  };
  "category:get": {
    args: [string];
    result: Category;
  };
  "category:create": {
    args: [Record<string, unknown>];
    result: Category;
  };
  "category:update": {
    args: [string, Record<string, unknown>];
    result: Category;
  };
  "category:set-status": {
    args: [string, CategoryStatus];
    result: Category;
  };
  "category:delete": {
    args: [string];
    result: { id: string };
  };
  "product:list": {
    args: [];
    result: ProductListItem[];
  };
  "product:next-sku": {
    args: [];
    result: string;
  };
  "product:stock-summary": {
    args: [string];
    result: ProductStockSummary;
  };
  "product:get": {
    args: [string];
    result: Product;
  };
  "product:create": {
    args: [Record<string, unknown>];
    result: Product;
  };
  "product:update": {
    args: [string, Record<string, unknown>];
    result: Product;
  };
  "product:set-status": {
    args: [string, ProductStatus];
    result: Product;
  };
  "product:pick-image": {
    args: [];
    result: string | null;
  };
  "product:read-image-preview": {
    args: [string];
    result: string | null;
  };
  "main-store:product-list": {
    args: [string | null];
    result: ProductListItem[];
  };
  "main-store:allocation-summary": {
    args: [];
    result: MainStoreAllocationSummary[];
  };
  "main-store:product-rows": {
    args: [];
    result: MainStoreProductRow[];
  };
  "main-store:product-detail": {
    args: [string];
    result: MainStoreProductDetail;
  };
  "main-store:receive": {
    args: [Record<string, unknown>];
    result: MainStoreProductDetail;
  };
  "main-store:distribute": {
    args: [Record<string, unknown>];
    result: MainStoreProductDetail;
  };
  "main-store:return": {
    args: [Record<string, unknown>];
    result: MainStoreProductDetail;
  };
  "main-store:reallocate": {
    args: [Record<string, unknown>];
    result: MainStoreProductDetail;
  };
  "main-store:damage": {
    args: [Record<string, unknown>];
    result: MainStoreProductDetail;
  };
  "inventory:overview": {
    args: [string];
    result: InventoryBalance[];
  };
  "inventory:list-for-location": {
    args: [string];
    result: LocationStockLevel[];
  };
  "stock-movement:list": {
    args: [string, { limit?: number }];
    result: StockMovement[];
  };
  "stock-movement:list-all": {
    args: [{ limit?: number }];
    result: StockMovementFeedItem[];
  };
  "stock-movement:create": {
    args: [Record<string, unknown>];
    result: StockMovement;
  };
  "stock-movement:transfer": {
    args: [Record<string, unknown>];
    result: StockTransferResult;
  };
  "role:list": {
    args: [];
    result: RoleListItem[];
  };
  "role:list-for-picker": {
    args: [];
    result: RolePickerItem[];
  };
  "role:get": {
    args: [string];
    result: Role;
  };
  "role:create": {
    args: [Record<string, unknown>];
    result: Role;
  };
  "role:update": {
    args: [string, Record<string, unknown>];
    result: Role;
  };
  "role:delete": {
    args: [string];
    result: { id: string };
  };
  "employee:list": {
    args: [];
    result: EmployeeListItem[];
  };
  "employee:list-for-salary-picker": {
    args: [];
    result: EmployeeListItem[];
  };
  "employee:get": {
    args: [string];
    result: Employee;
  };
  "employee:create": {
    args: [Record<string, unknown>];
    result: Employee;
  };
  "employee:update": {
    args: [string, Record<string, unknown>];
    result: Employee;
  };
  "employee:set-status": {
    args: [string, EmployeeStatus];
    result: Employee;
  };
  "employee:delete": {
    args: [string];
    result: { id: string };
  };
  "employee:pick-photo": {
    args: [];
    result: string | null;
  };
  "employee:read-photo-preview": {
    args: [string];
    result: string | null;
  };
  "payment-method:list": {
    args: [];
    result: PaymentMethod[];
  };
  "payment-method:get": {
    args: [string];
    result: PaymentMethod;
  };
  "payment-method:create": {
    args: [Record<string, unknown>];
    result: PaymentMethod;
  };
  "payment-method:update": {
    args: [string, Record<string, unknown>];
    result: PaymentMethod;
  };
  "payment-method:set-active": {
    args: [string, boolean];
    result: PaymentMethod;
  };
  "payment-method:delete": {
    args: [string];
    result: { id: string };
  };
  "customer:list": {
    args: [];
    result: Customer[];
  };
  "customer:get": {
    args: [string];
    result: Customer;
  };
  "customer:create": {
    args: [Record<string, unknown>];
    result: Customer;
  };
  "customer:update": {
    args: [string, Record<string, unknown>];
    result: Customer;
  };
  "customer:set-status": {
    args: [string, CustomerStatus];
    result: Customer;
  };
  "supplier:list": {
    args: [];
    result: Supplier[];
  };
  "supplier:get": {
    args: [string];
    result: Supplier;
  };
  "supplier:create": {
    args: [Record<string, unknown>];
    result: Supplier;
  };
  "supplier:update": {
    args: [string, Record<string, unknown>];
    result: Supplier;
  };
  "supplier:set-status": {
    args: [string, SupplierStatus];
    result: Supplier;
  };
  "rider:list": {
    args: [];
    result: Rider[];
  };
  "rider:get": {
    args: [string];
    result: Rider;
  };
  "rider:create": {
    args: [Record<string, unknown>];
    result: Rider;
  };
  "rider:update": {
    args: [string, Record<string, unknown>];
    result: Rider;
  };
  "rider:set-status": {
    args: [string, RiderStatus];
    result: Rider;
  };
  "purchase:list": {
    args: [];
    result: PurchaseListItem[];
  };
  "purchase:summary": {
    args: [];
    result: PurchaseSummary;
  };
  "purchase:get": {
    args: [string];
    result: Purchase;
  };
  "purchase:create": {
    args: [Record<string, unknown>];
    result: Purchase;
  };
  "purchase:update": {
    args: [string, Record<string, unknown>];
    result: Purchase;
  };
  "purchase:mark-ordered": {
    args: [string];
    result: Purchase;
  };
  "purchase:cancel": {
    args: [string];
    result: Purchase;
  };
  "purchase:receive-goods": {
    args: [string, Record<string, unknown>];
    result: Purchase;
  };
  "purchase:record-payment": {
    args: [string, Record<string, unknown>];
    result: Purchase;
  };
  "purchase:mark-paid": {
    args: [string, Record<string, unknown>];
    result: Purchase;
  };
  "purchase:pick-attachment": {
    args: [];
    result: string | null;
  };
  "purchase:open-attachment": {
    args: [string];
    result: { success: true };
  };
  "expense-category:list": {
    args: [];
    result: ExpenseCategory[];
  };
  "expense-category:create": {
    args: [Record<string, unknown>];
    result: ExpenseCategory;
  };
  "expense-category:update": {
    args: [string, Record<string, unknown>];
    result: ExpenseCategory;
  };
  "expense-category:set-status": {
    args: [string, ExpenseCategoryStatus];
    result: ExpenseCategory;
  };
  "expense:list": {
    args: [];
    result: Expense[];
  };
  "expense:summary": {
    args: [];
    result: ExpenseSummary;
  };
  "expense:get": {
    args: [string];
    result: Expense;
  };
  "expense:create": {
    args: [Record<string, unknown>];
    result: Expense;
  };
  "expense:update": {
    args: [string, Record<string, unknown>];
    result: Expense;
  };
  "expense:archive": {
    args: [string];
    result: Expense;
  };
  "expense:restore": {
    args: [string];
    result: Expense;
  };
  "expense:delete": {
    args: [string];
    result: { id: string };
  };
  "expense:pick-attachment": {
    args: [];
    result: string | null;
  };
  "expense:open-attachment": {
    args: [string];
    result: { success: true };
  };
  "salary:list": {
    args: [];
    result: Salary[];
  };
  "salary:get": {
    args: [string];
    result: Salary;
  };
  "salary:create": {
    args: [Record<string, unknown>];
    result: Salary;
  };
  "salary:create-advance": {
    args: [Record<string, unknown>];
    result: Salary;
  };
  "salary:complete": {
    args: [string, Record<string, unknown>];
    result: Salary;
  };
  "salary:delete-advance": {
    args: [string];
    result: void;
  };
  "salary:void": {
    args: [string];
    result: Salary;
  };
  "salary:restore": {
    args: [string];
    result: Salary;
  };
  "sale:list": {
    args: [];
    result: SaleListItem[];
  };
  "sale:list-pending": {
    args: [];
    result: PendingSaleListItem[];
  };
  "sale:get": {
    args: [string];
    result: Sale;
  };
  "sale:suspend": {
    args: [Record<string, unknown>];
    result: { id: string };
  };
  "sale:delete-pending": {
    args: [string];
    result: { id: string };
  };
  "sale:complete": {
    args: [Record<string, unknown>];
    result: Sale;
  };
  "sale-void:list": {
    args: [];
    result: SaleVoid[];
  };
  "sale-void:get": {
    args: [string];
    result: SaleVoid;
  };
  "sale-void:request": {
    args: [Record<string, unknown>];
    result: SaleVoid;
  };
  "sale-void:approve": {
    args: [string, Record<string, unknown>];
    result: SaleVoid;
  };
  "sale-void:reject": {
    args: [string, Record<string, unknown>];
    result: SaleVoid;
  };
  "sale-return:list": {
    args: [];
    result: SaleReturn[];
  };
  "sale-return:get": {
    args: [string];
    result: SaleReturn;
  };
  "sale-return:request": {
    args: [Record<string, unknown>];
    result: SaleReturn;
  };
  "sale-return:approve": {
    args: [string, Record<string, unknown>];
    result: SaleReturn;
  };
  "sale-return:reject": {
    args: [string, Record<string, unknown>];
    result: SaleReturn;
  };
  "invoice:list": {
    args: [];
    result: InvoiceListItem[];
  };
  "invoice:summary": {
    args: [];
    result: InvoiceSummary;
  };
  "invoice:create": {
    args: [Record<string, unknown>];
    result: Sale;
  };
  "invoice:record-payment": {
    args: [string, Record<string, unknown>];
    result: Sale;
  };
  "invoice:cancel": {
    args: [string];
    result: Sale;
  };
  "invoice:mark-paid": {
    args: [string, Record<string, unknown>];
    result: Sale;
  };
  "invoice:duplicate": {
    args: [string];
    result: Sale;
  };
  "quotation:list": {
    args: [];
    result: QuotationListItem[];
  };
  "quotation:summary": {
    args: [];
    result: QuotationSummary;
  };
  "quotation:get": {
    args: [string];
    result: Quotation;
  };
  "quotation:create": {
    args: [Record<string, unknown>];
    result: Quotation;
  };
  "quotation:update": {
    args: [string, Record<string, unknown>];
    result: Quotation;
  };
  "quotation:delete": {
    args: [string];
    result: { id: string };
  };
  "quotation:set-status": {
    args: [string, QuotationStatus];
    result: Quotation;
  };
  "quotation:check-stock": {
    args: [string];
    result: QuotationStockCheckItem[];
  };
  "quotation:convert-to-sale": {
    args: [string, Record<string, unknown>];
    result: Sale;
  };
  "quotation:convert-to-invoice": {
    args: [string, Record<string, unknown>];
    result: Sale;
  };
  "printer:get-settings": {
    args: [];
    result: PrinterSettings;
  };
  "printer:save-settings": {
    args: [Record<string, unknown>];
    result: PrinterSettings;
  };
  "printer:test-connection": {
    args: [];
    result: PrinterActionResult;
  };
  "printer:print-receipt": {
    args: [string];
    result: PrinterActionResult;
  };
  "printer:generate-receipt-pdf": {
    args: [string];
    result: string | null;
  };
  "printer:generate-invoice-pdf": {
    args: [string];
    result: string | null;
  };
  "printer:print-invoice-document": {
    args: [string];
    result: PrinterActionResult;
  };
  "printer:generate-quotation-pdf": {
    args: [string];
    result: string | null;
  };
  "printer:print-quotation-document": {
    args: [string];
    result: PrinterActionResult;
  };
  "printer:generate-salary-pdf": {
    args: [string];
    result: string | null;
  };
  "printer:share-salary-payslip": {
    args: [string];
    result: PrinterActionResult;
  };
  "printer:print-delivery-note": {
    args: [string];
    result: PrinterActionResult;
  };
  "printer:print-delivery-note-thermal": {
    args: [string];
    result: PrinterActionResult;
  };
  "printer:generate-delivery-note-pdf": {
    args: [string];
    result: string | null;
  };
  "printer:share-delivery-note": {
    args: [string];
    result: PrinterActionResult;
  };
  "delivery-note:get": {
    args: [string];
    result: SaleDelivery;
  };
  "delivery-note:get-for-sale": {
    args: [string];
    result: SaleDelivery | null;
  };
  "delivery-note:get-for-quotation": {
    args: [string];
    result: SaleDelivery | null;
  };
  "delivery-note:set-delivered": {
    args: [string, boolean];
    result: SaleDelivery;
  };
  "export:to-pdf": {
    args: [ExportListRequest];
    result: string | null;
  };
  "export:to-csv": {
    args: [ExportListRequest];
    result: string | null;
  };
  "export:to-excel": {
    args: [ExportListRequest];
    result: string | null;
  };
  "report-export:to-pdf": {
    args: [ReportExportRequest];
    result: string | null;
  };
  "report-export:to-excel": {
    args: [ReportExportRequest];
    result: string | null;
  };
  "stock-request:list": {
    args: [];
    result: StockRequestListItem[];
  };
  "stock-request:get": {
    args: [string];
    result: StockRequest;
  };
  "stock-request:create": {
    args: [Record<string, unknown>];
    result: StockRequest;
  };
  "stock-request:approve": {
    args: [string];
    result: StockRequest;
  };
  "stock-request:reject": {
    args: [string, Record<string, unknown>];
    result: StockRequest;
  };
  "recurring-bill:list": {
    args: [];
    result: RecurringBill[];
  };
  "recurring-bill:get": {
    args: [string];
    result: RecurringBill;
  };
  "recurring-bill:create": {
    args: [Record<string, unknown>];
    result: RecurringBill;
  };
  "recurring-bill:update": {
    args: [string, Record<string, unknown>];
    result: RecurringBill;
  };
  "recurring-bill:set-status": {
    args: [string, "active" | "paused"];
    result: RecurringBill;
  };
  "recurring-bill:advance": {
    args: [string];
    result: RecurringBill;
  };
  "recurring-bill:mark-paid": {
    args: [string, Record<string, unknown>];
    result: { bill: RecurringBill; expense: Expense };
  };
  "recurring-bill:delete": {
    args: [string];
    result: void;
  };
  "sync:get-snapshot": {
    args: [];
    result: SyncSnapshot;
  };
  "sync:list-queue": {
    args: [{ limit?: number }];
    result: SyncQueueItem[];
  };
  "sync:run-now": {
    args: [];
    result: SyncSnapshot;
  };
  "sync:list-conflicts": {
    args: [];
    result: SyncConflictItem[];
  };
  "sync:resolve-conflict": {
    args: [string, ConflictResolution];
    result: { success: true };
  };
  "sync:list-reconciliations": {
    args: [];
    result: SyncReconciliationItem[];
  };
  "sync:get-entity-overview": {
    args: [];
    result: EntitySyncOverviewRow[];
  };
  "import:pick-file": {
    args: [ImportEntityType];
    result: ImportParsedFile | null;
  };
  "import:preview": {
    args: [ImportPreviewRequest];
    result: ImportPreviewResult;
  };
  "import:commit": {
    args: [ImportCommitRequest];
    result: ImportCommitResult;
  };
  "share:create-link": {
    args: [ShareDocumentEntity, string];
    result: string;
  };
  "theme:save": {
    args: [BrandTheme];
    result: BrandTheme;
  };
  "report:sales-financial-overview": {
    args: [DateRangeInput];
    result: SalesFinancialOverview;
  };
  "report:sales-transactions": {
    args: [DateRangeInput];
    result: SalesTransactionRow[];
  };
  "report:cancelled-purchases": {
    args: [DateRangeInput];
    result: CancelledPurchasesReport;
  };
  "report:payment-transactions": {
    args: [DateRangeInput];
    result: PaymentTransactionRow[];
  };
  "report:my-sales": {
    args: [DateRangeInput];
    result: MySaleEntry[];
  };
  "report:sales-trend-window": {
    args: [SalesTrendWindowInput];
    result: SalesTrendWindowResult;
  };
  "report:sales-by-storefront": {
    args: [DateRangeInput];
    result: SalesByStorefrontRow[];
  };
  "report:sales-by-employee": {
    args: [DateRangeInput];
    result: SalesByEmployeeRow[];
  };
  "report:sales-by-payment-method": {
    args: [DateRangeInput];
    result: SalesByPaymentMethodRow[];
  };
  "report:inventory-data": {
    args: [];
    result: InventoryReportData;
  };
  "report:products-performance": {
    args: [DateRangeInput & { slowMovingLimit?: number }];
    result: ProductsPerformanceReport;
  };
  "report:product-sales-history": {
    args: [{ productId: string }];
    result: ProductSalesHistoryEntry[];
  };
  "report:top-customers": {
    args: [DateRangeInput];
    result: TopCustomerRow[];
  };
  "report:customer-purchase-history": {
    args: [{ customerId: string }];
    result: CustomerPurchaseHistoryEntry[];
  };
  "report:outstanding-invoices": {
    args: [];
    result: OutstandingInvoicesSummary;
  };
  "report:outstanding-purchases": {
    args: [];
    result: OutstandingPurchasesSummary;
  };
  "report:supplier-purchase-history": {
    args: [{ supplierId: string }];
    result: SupplierPurchaseHistoryEntry[];
  };
  "report:supplier-spend-breakdown": {
    args: [DateRangeInput];
    result: SupplierSpendRow[];
  };
};

export type IpcChannel = keyof IpcInvokeMap;

export type BlueLedgerApi = {
  app: {
    getContext: () => Promise<IpcInvokeMap["app:get-context"]["result"]>;
  };
  activation: {
    activate: (licenseKey: string) => Promise<IpcInvokeMap["activation:activate"]["result"]>;
    heartbeat: () => Promise<IpcInvokeMap["activation:heartbeat"]["result"]>;
    payments: () => Promise<IpcInvokeMap["activation:payments"]["result"]>;
  };
  auth: {
    login: (input: Record<string, unknown>) => Promise<IpcInvokeMap["auth:login"]["result"]>;
    logout: () => Promise<IpcInvokeMap["auth:logout"]["result"]>;
    getSession: () => Promise<IpcInvokeMap["auth:get-session"]["result"]>;
  };
  tenant: {
    getCurrent: () => Promise<IpcInvokeMap["tenant:get-current"]["result"]>;
    getProfile: () => Promise<IpcInvokeMap["tenant:get-profile"]["result"]>;
    updateProfile: (
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["tenant:update-profile"]["result"]>;
    pickLogo: () => Promise<IpcInvokeMap["tenant:pick-logo"]["result"]>;
    readImagePreview: (
      path: string
    ) => Promise<IpcInvokeMap["tenant:read-image-preview"]["result"]>;
  };
  location: {
    list: () => Promise<IpcInvokeMap["location:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["location:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["location:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["location:update"]["result"]>;
    setStatus: (
      id: string,
      status: LocationStatus
    ) => Promise<IpcInvokeMap["location:set-status"]["result"]>;
    pickLogo: () => Promise<IpcInvokeMap["location:pick-logo"]["result"]>;
    readLogoPreview: (relativePath: string) => Promise<IpcInvokeMap["location:read-logo-preview"]["result"]>;
  };
  category: {
    list: () => Promise<IpcInvokeMap["category:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["category:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["category:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["category:update"]["result"]>;
    setStatus: (
      id: string,
      status: CategoryStatus
    ) => Promise<IpcInvokeMap["category:set-status"]["result"]>;
    delete: (id: string) => Promise<IpcInvokeMap["category:delete"]["result"]>;
  };
  product: {
    list: () => Promise<IpcInvokeMap["product:list"]["result"]>;
    nextSku: () => Promise<IpcInvokeMap["product:next-sku"]["result"]>;
    stockSummary: (id: string) => Promise<IpcInvokeMap["product:stock-summary"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["product:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["product:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["product:update"]["result"]>;
    setStatus: (
      id: string,
      status: ProductStatus
    ) => Promise<IpcInvokeMap["product:set-status"]["result"]>;
    pickImage: () => Promise<IpcInvokeMap["product:pick-image"]["result"]>;
    readImagePreview: (
      relativePath: string
    ) => Promise<IpcInvokeMap["product:read-image-preview"]["result"]>;
  };
  mainStore: {
    listProducts: (
      locationId: string | null
    ) => Promise<IpcInvokeMap["main-store:product-list"]["result"]>;
    allocationSummary: () => Promise<IpcInvokeMap["main-store:allocation-summary"]["result"]>;
    listProductRows: () => Promise<IpcInvokeMap["main-store:product-rows"]["result"]>;
    getProductDetail: (productId: string) => Promise<IpcInvokeMap["main-store:product-detail"]["result"]>;
    receive: (input: Record<string, unknown>) => Promise<IpcInvokeMap["main-store:receive"]["result"]>;
    distribute: (input: Record<string, unknown>) => Promise<IpcInvokeMap["main-store:distribute"]["result"]>;
    returnStock: (input: Record<string, unknown>) => Promise<IpcInvokeMap["main-store:return"]["result"]>;
    reallocate: (input: Record<string, unknown>) => Promise<IpcInvokeMap["main-store:reallocate"]["result"]>;
    damage: (input: Record<string, unknown>) => Promise<IpcInvokeMap["main-store:damage"]["result"]>;
  };
  inventory: {
    overview: (productId: string) => Promise<IpcInvokeMap["inventory:overview"]["result"]>;
    listForLocation: (
      locationId: string
    ) => Promise<IpcInvokeMap["inventory:list-for-location"]["result"]>;
  };
  stockMovement: {
    list: (
      productId: string,
      input?: { limit?: number }
    ) => Promise<IpcInvokeMap["stock-movement:list"]["result"]>;
    listAll: (input?: { limit?: number }) => Promise<IpcInvokeMap["stock-movement:list-all"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["stock-movement:create"]["result"]>;
    transfer: (
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["stock-movement:transfer"]["result"]>;
  };
  role: {
    list: () => Promise<IpcInvokeMap["role:list"]["result"]>;
    listForPicker: () => Promise<IpcInvokeMap["role:list-for-picker"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["role:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["role:create"]["result"]>;
    update: (id: string, input: Record<string, unknown>) => Promise<IpcInvokeMap["role:update"]["result"]>;
    delete: (id: string) => Promise<IpcInvokeMap["role:delete"]["result"]>;
  };
  employee: {
    list: () => Promise<IpcInvokeMap["employee:list"]["result"]>;
    listForSalaryPicker: () => Promise<IpcInvokeMap["employee:list-for-salary-picker"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["employee:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["employee:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["employee:update"]["result"]>;
    setStatus: (
      id: string,
      status: EmployeeStatus
    ) => Promise<IpcInvokeMap["employee:set-status"]["result"]>;
    delete: (id: string) => Promise<IpcInvokeMap["employee:delete"]["result"]>;
    pickPhoto: () => Promise<IpcInvokeMap["employee:pick-photo"]["result"]>;
    readPhotoPreview: (
      relativePath: string
    ) => Promise<IpcInvokeMap["employee:read-photo-preview"]["result"]>;
  };
  paymentMethod: {
    list: () => Promise<IpcInvokeMap["payment-method:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["payment-method:get"]["result"]>;
    create: (
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["payment-method:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["payment-method:update"]["result"]>;
    setActive: (
      id: string,
      isActive: boolean
    ) => Promise<IpcInvokeMap["payment-method:set-active"]["result"]>;
    delete: (id: string) => Promise<IpcInvokeMap["payment-method:delete"]["result"]>;
  };
  customer: {
    list: () => Promise<IpcInvokeMap["customer:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["customer:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["customer:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["customer:update"]["result"]>;
    setStatus: (
      id: string,
      status: CustomerStatus
    ) => Promise<IpcInvokeMap["customer:set-status"]["result"]>;
  };
  supplier: {
    list: () => Promise<IpcInvokeMap["supplier:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["supplier:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["supplier:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["supplier:update"]["result"]>;
    setStatus: (
      id: string,
      status: SupplierStatus
    ) => Promise<IpcInvokeMap["supplier:set-status"]["result"]>;
  };
  rider: {
    list: () => Promise<IpcInvokeMap["rider:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["rider:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["rider:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["rider:update"]["result"]>;
    setStatus: (
      id: string,
      status: RiderStatus
    ) => Promise<IpcInvokeMap["rider:set-status"]["result"]>;
  };
  purchase: {
    list: () => Promise<IpcInvokeMap["purchase:list"]["result"]>;
    summary: () => Promise<IpcInvokeMap["purchase:summary"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["purchase:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["purchase:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["purchase:update"]["result"]>;
    markOrdered: (id: string) => Promise<IpcInvokeMap["purchase:mark-ordered"]["result"]>;
    cancel: (id: string) => Promise<IpcInvokeMap["purchase:cancel"]["result"]>;
    receiveGoods: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["purchase:receive-goods"]["result"]>;
    recordPayment: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["purchase:record-payment"]["result"]>;
    markPaid: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["purchase:mark-paid"]["result"]>;
    pickAttachment: () => Promise<IpcInvokeMap["purchase:pick-attachment"]["result"]>;
    openAttachment: (relativePath: string) => Promise<IpcInvokeMap["purchase:open-attachment"]["result"]>;
  };
  expenseCategory: {
    list: () => Promise<IpcInvokeMap["expense-category:list"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["expense-category:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["expense-category:update"]["result"]>;
    setStatus: (
      id: string,
      status: ExpenseCategoryStatus
    ) => Promise<IpcInvokeMap["expense-category:set-status"]["result"]>;
  };
  expense: {
    list: () => Promise<IpcInvokeMap["expense:list"]["result"]>;
    summary: () => Promise<IpcInvokeMap["expense:summary"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["expense:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["expense:create"]["result"]>;
    update: (id: string, input: Record<string, unknown>) => Promise<IpcInvokeMap["expense:update"]["result"]>;
    archive: (id: string) => Promise<IpcInvokeMap["expense:archive"]["result"]>;
    restore: (id: string) => Promise<IpcInvokeMap["expense:restore"]["result"]>;
    delete: (id: string) => Promise<IpcInvokeMap["expense:delete"]["result"]>;
    pickAttachment: () => Promise<IpcInvokeMap["expense:pick-attachment"]["result"]>;
    openAttachment: (relativePath: string) => Promise<IpcInvokeMap["expense:open-attachment"]["result"]>;
  };
  salary: {
    list: () => Promise<IpcInvokeMap["salary:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["salary:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["salary:create"]["result"]>;
    createAdvance: (input: Record<string, unknown>) => Promise<IpcInvokeMap["salary:create-advance"]["result"]>;
    complete: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["salary:complete"]["result"]>;
    deleteAdvance: (id: string) => Promise<IpcInvokeMap["salary:delete-advance"]["result"]>;
    void: (id: string) => Promise<IpcInvokeMap["salary:void"]["result"]>;
    restore: (id: string) => Promise<IpcInvokeMap["salary:restore"]["result"]>;
  };
  sale: {
    list: () => Promise<IpcInvokeMap["sale:list"]["result"]>;
    listPending: () => Promise<IpcInvokeMap["sale:list-pending"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["sale:get"]["result"]>;
    suspend: (input: Record<string, unknown>) => Promise<IpcInvokeMap["sale:suspend"]["result"]>;
    deletePending: (id: string) => Promise<IpcInvokeMap["sale:delete-pending"]["result"]>;
    complete: (input: Record<string, unknown>) => Promise<IpcInvokeMap["sale:complete"]["result"]>;
  };
  saleVoid: {
    list: () => Promise<IpcInvokeMap["sale-void:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["sale-void:get"]["result"]>;
    request: (input: Record<string, unknown>) => Promise<IpcInvokeMap["sale-void:request"]["result"]>;
    approve: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["sale-void:approve"]["result"]>;
    reject: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["sale-void:reject"]["result"]>;
  };
  saleReturn: {
    list: () => Promise<IpcInvokeMap["sale-return:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["sale-return:get"]["result"]>;
    request: (input: Record<string, unknown>) => Promise<IpcInvokeMap["sale-return:request"]["result"]>;
    approve: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["sale-return:approve"]["result"]>;
    reject: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["sale-return:reject"]["result"]>;
  };
  invoice: {
    list: () => Promise<IpcInvokeMap["invoice:list"]["result"]>;
    summary: () => Promise<IpcInvokeMap["invoice:summary"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["invoice:create"]["result"]>;
    recordPayment: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["invoice:record-payment"]["result"]>;
    cancel: (id: string) => Promise<IpcInvokeMap["invoice:cancel"]["result"]>;
    markPaid: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["invoice:mark-paid"]["result"]>;
    duplicate: (id: string) => Promise<IpcInvokeMap["invoice:duplicate"]["result"]>;
  };
  quotation: {
    list: () => Promise<IpcInvokeMap["quotation:list"]["result"]>;
    summary: () => Promise<IpcInvokeMap["quotation:summary"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["quotation:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["quotation:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["quotation:update"]["result"]>;
    delete: (id: string) => Promise<IpcInvokeMap["quotation:delete"]["result"]>;
    setStatus: (
      id: string,
      status: QuotationStatus
    ) => Promise<IpcInvokeMap["quotation:set-status"]["result"]>;
    checkStock: (id: string) => Promise<IpcInvokeMap["quotation:check-stock"]["result"]>;
    convertToSale: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["quotation:convert-to-sale"]["result"]>;
    convertToInvoice: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["quotation:convert-to-invoice"]["result"]>;
  };
  printer: {
    getSettings: () => Promise<IpcInvokeMap["printer:get-settings"]["result"]>;
    saveSettings: (input: Record<string, unknown>) => Promise<IpcInvokeMap["printer:save-settings"]["result"]>;
    testConnection: () => Promise<IpcInvokeMap["printer:test-connection"]["result"]>;
    printReceipt: (saleId: string) => Promise<IpcInvokeMap["printer:print-receipt"]["result"]>;
    generateReceiptPdf: (saleId: string) => Promise<IpcInvokeMap["printer:generate-receipt-pdf"]["result"]>;
    generateInvoicePdf: (saleId: string) => Promise<IpcInvokeMap["printer:generate-invoice-pdf"]["result"]>;
    printInvoiceDocument: (
      saleId: string
    ) => Promise<IpcInvokeMap["printer:print-invoice-document"]["result"]>;
    generateQuotationPdf: (
      quotationId: string
    ) => Promise<IpcInvokeMap["printer:generate-quotation-pdf"]["result"]>;
    printQuotationDocument: (
      quotationId: string
    ) => Promise<IpcInvokeMap["printer:print-quotation-document"]["result"]>;
    generateSalaryPdf: (salaryId: string) => Promise<IpcInvokeMap["printer:generate-salary-pdf"]["result"]>;
    shareSalaryPayslip: (salaryId: string) => Promise<IpcInvokeMap["printer:share-salary-payslip"]["result"]>;
    printDeliveryNote: (
      deliveryNoteId: string
    ) => Promise<IpcInvokeMap["printer:print-delivery-note"]["result"]>;
    printDeliveryNoteThermal: (
      deliveryNoteId: string
    ) => Promise<IpcInvokeMap["printer:print-delivery-note-thermal"]["result"]>;
    generateDeliveryNotePdf: (
      deliveryNoteId: string
    ) => Promise<IpcInvokeMap["printer:generate-delivery-note-pdf"]["result"]>;
    shareDeliveryNote: (
      deliveryNoteId: string
    ) => Promise<IpcInvokeMap["printer:share-delivery-note"]["result"]>;
  };
  deliveryNote: {
    get: (id: string) => Promise<IpcInvokeMap["delivery-note:get"]["result"]>;
    getForSale: (saleId: string) => Promise<IpcInvokeMap["delivery-note:get-for-sale"]["result"]>;
    getForQuotation: (
      quotationId: string
    ) => Promise<IpcInvokeMap["delivery-note:get-for-quotation"]["result"]>;
    setDelivered: (
      id: string,
      delivered: boolean
    ) => Promise<IpcInvokeMap["delivery-note:set-delivered"]["result"]>;
  };
  export: {
    toPdf: (request: ExportListRequest) => Promise<IpcInvokeMap["export:to-pdf"]["result"]>;
    toCsv: (request: ExportListRequest) => Promise<IpcInvokeMap["export:to-csv"]["result"]>;
    toExcel: (request: ExportListRequest) => Promise<IpcInvokeMap["export:to-excel"]["result"]>;
  };
  reportExport: {
    toPdf: (request: ReportExportRequest) => Promise<IpcInvokeMap["report-export:to-pdf"]["result"]>;
    toExcel: (request: ReportExportRequest) => Promise<IpcInvokeMap["report-export:to-excel"]["result"]>;
  };
  stockRequest: {
    list: () => Promise<IpcInvokeMap["stock-request:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["stock-request:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["stock-request:create"]["result"]>;
    approve: (id: string) => Promise<IpcInvokeMap["stock-request:approve"]["result"]>;
    reject: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["stock-request:reject"]["result"]>;
  };
  recurringBill: {
    list: () => Promise<IpcInvokeMap["recurring-bill:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["recurring-bill:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["recurring-bill:create"]["result"]>;
    update: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["recurring-bill:update"]["result"]>;
    setStatus: (
      id: string,
      status: "active" | "paused"
    ) => Promise<IpcInvokeMap["recurring-bill:set-status"]["result"]>;
    advance: (id: string) => Promise<IpcInvokeMap["recurring-bill:advance"]["result"]>;
    markPaid: (
      id: string,
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["recurring-bill:mark-paid"]["result"]>;
    delete: (id: string) => Promise<IpcInvokeMap["recurring-bill:delete"]["result"]>;
  };
  sync: {
    getSnapshot: () => Promise<IpcInvokeMap["sync:get-snapshot"]["result"]>;
    listQueue: (input?: { limit?: number }) => Promise<IpcInvokeMap["sync:list-queue"]["result"]>;
    runNow: () => Promise<IpcInvokeMap["sync:run-now"]["result"]>;
    listConflicts: () => Promise<IpcInvokeMap["sync:list-conflicts"]["result"]>;
    resolveConflict: (
      id: string,
      resolution: ConflictResolution
    ) => Promise<IpcInvokeMap["sync:resolve-conflict"]["result"]>;
    listReconciliations: () => Promise<IpcInvokeMap["sync:list-reconciliations"]["result"]>;
    getEntityOverview: () => Promise<IpcInvokeMap["sync:get-entity-overview"]["result"]>;
  };
  import: {
    pickFile: (entityType: ImportEntityType) => Promise<IpcInvokeMap["import:pick-file"]["result"]>;
    preview: (request: ImportPreviewRequest) => Promise<IpcInvokeMap["import:preview"]["result"]>;
    commit: (request: ImportCommitRequest) => Promise<IpcInvokeMap["import:commit"]["result"]>;
  };
  share: {
    createLink: (
      entity: ShareDocumentEntity,
      entityId: string
    ) => Promise<IpcInvokeMap["share:create-link"]["result"]>;
  };
  theme: {
    save: (theme: BrandTheme) => Promise<BrandTheme>;
  };
  report: {
    salesFinancialOverview: (range: DateRangeInput) => Promise<SalesFinancialOverview>;
    salesTransactions: (range: DateRangeInput) => Promise<SalesTransactionRow[]>;
    cancelledPurchases: (range: DateRangeInput) => Promise<CancelledPurchasesReport>;
    paymentTransactions: (range: DateRangeInput) => Promise<PaymentTransactionRow[]>;
    mySales: (range: DateRangeInput) => Promise<MySaleEntry[]>;
    salesTrendWindow: (input: SalesTrendWindowInput) => Promise<SalesTrendWindowResult>;
    salesByStorefront: (range: DateRangeInput) => Promise<SalesByStorefrontRow[]>;
    salesByEmployee: (range: DateRangeInput) => Promise<SalesByEmployeeRow[]>;
    salesByPaymentMethod: (range: DateRangeInput) => Promise<SalesByPaymentMethodRow[]>;
    inventoryData: () => Promise<InventoryReportData>;
    productsPerformance: (
      range: DateRangeInput & { slowMovingLimit?: number }
    ) => Promise<ProductsPerformanceReport>;
    productSalesHistory: (input: { productId: string }) => Promise<ProductSalesHistoryEntry[]>;
    topCustomers: (range: DateRangeInput) => Promise<TopCustomerRow[]>;
    customerPurchaseHistory: (input: { customerId: string }) => Promise<CustomerPurchaseHistoryEntry[]>;
    outstandingInvoices: () => Promise<OutstandingInvoicesSummary>;
    outstandingPurchases: () => Promise<OutstandingPurchasesSummary>;
    supplierPurchaseHistory: (input: { supplierId: string }) => Promise<SupplierPurchaseHistoryEntry[]>;
    supplierSpendBreakdown: (input: DateRangeInput) => Promise<SupplierSpendRow[]>;
  };
};
