import type { AppContext, TenantRecord } from "./tenant";
import type { BrandTheme } from "./theme";
import type { AuthSession } from "./auth";
import type { Category, CategoryStatus } from "./category";
import type { Customer, CustomerStatus } from "./customer";
import type { Employee, EmployeeListItem, EmployeeStatus } from "./employee";
import type { InventoryBalance, LocationStockLevel } from "./inventory";
import type { Location, LocationStatus } from "./location";
import type { PaymentMethod } from "./payment-method";
import type { Product, ProductListItem, ProductStatus } from "./product";
import type { Role, RoleListItem } from "./role";
import type { PendingSaleListItem, Sale } from "./sale";
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
    listPending: () => Promise<IpcInvokeMap["sale:list-pending"]["result"]>;
    get: (id: string) => Promise<IpcInvokeMap["sale:get"]["result"]>;
    suspend: (input: Record<string, unknown>) => Promise<IpcInvokeMap["sale:suspend"]["result"]>;
    deletePending: (id: string) => Promise<IpcInvokeMap["sale:delete-pending"]["result"]>;
    complete: (input: Record<string, unknown>) => Promise<IpcInvokeMap["sale:complete"]["result"]>;
  };
  sync: {
    getSnapshot: () => Promise<IpcInvokeMap["sync:get-snapshot"]["result"]>;
    listQueue: (input?: { limit?: number }) => Promise<IpcInvokeMap["sync:list-queue"]["result"]>;
  };
  theme: {
    save: (theme: BrandTheme) => Promise<BrandTheme>;
  };
};
