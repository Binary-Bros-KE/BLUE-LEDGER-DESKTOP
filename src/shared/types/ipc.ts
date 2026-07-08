import type { AppContext, TenantRecord } from "./tenant";
import type { BrandTheme } from "./theme";
import type { AuthSession } from "./auth";
import type { Category, CategoryStatus } from "./category";
import type { Customer, CustomerStatus } from "./customer";
import type { Employee, EmployeeListItem, EmployeeStatus } from "./employee";
import type { InventoryBalance, LocationStockLevel } from "./inventory";
import type { InvoiceListItem, InvoiceSummary } from "./invoice";
import type { Location, LocationStatus } from "./location";
import type { PaymentMethod } from "./payment-method";
import type { Product, ProductListItem, ProductStatus } from "./product";
import type { PrinterActionResult, PrinterSettings } from "./printer";
import type { Quotation, QuotationListItem, QuotationStatus, QuotationStockCheckItem, QuotationSummary } from "./quotation";
import type { Role, RoleListItem } from "./role";
import type { PendingSaleListItem, Sale, SaleListItem } from "./sale";
import type { SaleReturn } from "./sale-return";
import type { SaleVoid } from "./sale-void";
import type { StockMovement, StockTransferResult } from "./stock-movement";
import type { SyncQueueItem, SyncSnapshot } from "./sync";

export type IpcInvokeMap = {
  "app:get-context": {
    args: [];
    result: AppContext;
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
  "sync:get-snapshot": {
    args: [];
    result: SyncSnapshot;
  };
  "sync:list-queue": {
    args: [{ limit?: number }];
    result: SyncQueueItem[];
  };
  "theme:save": {
    args: [BrandTheme];
    result: BrandTheme;
  };
};

export type IpcChannel = keyof IpcInvokeMap;

export type BlueLedgerApi = {
  app: {
    getContext: () => Promise<IpcInvokeMap["app:get-context"]["result"]>;
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
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["stock-movement:create"]["result"]>;
    transfer: (
      input: Record<string, unknown>
    ) => Promise<IpcInvokeMap["stock-movement:transfer"]["result"]>;
  };
  role: {
    list: () => Promise<IpcInvokeMap["role:list"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["role:get"]["result"]>;
    create: (input: Record<string, unknown>) => Promise<IpcInvokeMap["role:create"]["result"]>;
    update: (id: string, input: Record<string, unknown>) => Promise<IpcInvokeMap["role:update"]["result"]>;
    delete: (id: string) => Promise<IpcInvokeMap["role:delete"]["result"]>;
  };
  employee: {
    list: () => Promise<IpcInvokeMap["employee:list"]["result"]>;
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
  };
  sync: {
    getSnapshot: () => Promise<IpcInvokeMap["sync:get-snapshot"]["result"]>;
    listQueue: (input?: { limit?: number }) => Promise<IpcInvokeMap["sync:list-queue"]["result"]>;
  };
  theme: {
    save: (theme: BrandTheme) => Promise<BrandTheme>;
  };
};
