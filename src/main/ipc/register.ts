import electron from "electron";
import { getSession, login, logout } from "@main/services/auth-service";
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  setCategoryStatus,
  updateCategory
} from "@main/services/category-service";
import {
  createCustomer,
  getCustomer,
  listCustomers,
  setCustomerStatus,
  updateCustomer
} from "@main/services/customer-service";
import {
  createEmployee,
  deleteEmployee,
  getEmployee,
  listEmployees,
  setEmployeeStatus,
  updateEmployee
} from "@main/services/employee-service";
import {
  pickAndStoreEmployeePhoto,
  pickAndStoreLocationLogo,
  pickAndStoreProductImage,
  readManagedBusinessLogoPreview,
  readManagedEmployeePhotoPreview,
  readManagedLocationLogoPreview,
  readManagedProductImagePreview
} from "@main/services/image-service";
import {
  cancelInvoice,
  createInvoice,
  duplicateInvoice,
  getInvoiceSummary,
  listInvoices,
  markInvoicePaid,
  recordInvoicePayment
} from "@main/services/invoice-service";
import {
  getInventoryOverview,
  listInventoryForLocation,
  listStockMovements,
  recordStockMovement,
  recordStockTransfer
} from "@main/services/inventory-service";
import {
  createLocation,
  getLocation,
  listLocations,
  setLocationStatus,
  updateLocation
} from "@main/services/location-service";
import {
  createPaymentMethod,
  deletePaymentMethod,
  getPaymentMethod,
  listPaymentMethods,
  setPaymentMethodActive,
  updatePaymentMethod
} from "@main/services/payment-method-service";
import {
  generateInvoicePdf,
  generateQuotationPdf,
  generateReceiptPdf,
  getPrinterSettings,
  printInvoiceDocument,
  printQuotationDocument,
  printReceipt,
  savePrinterSettings,
  testPrinterConnection
} from "@main/services/printer-service";
import {
  createProduct,
  getProduct,
  listProducts,
  setProductStatus,
  updateProduct
} from "@main/services/product-service";
import {
  checkQuotationStock,
  convertQuotationToInvoice,
  convertQuotationToSale,
  createQuotation,
  deleteQuotation,
  getQuotation,
  getQuotationSummary,
  listQuotations,
  setQuotationStatus,
  updateQuotation
} from "@main/services/quotation-service";
import { createRole, deleteRole, getRole, listRoles, updateRole } from "@main/services/role-service";
import {
  approveSaleReturn,
  getSaleReturn,
  listSaleReturns,
  rejectSaleReturn,
  requestSaleReturn
} from "@main/services/sale-return-service";
import {
  completeSale,
  deletePendingSale,
  getSale,
  listPendingSales,
  listSales,
  suspendSale
} from "@main/services/sale-service";
import {
  approveSaleVoid,
  getSaleVoid,
  listSaleVoids,
  rejectSaleVoid,
  requestSaleVoid
} from "@main/services/sale-void-service";
import {
  getAppContext,
  getCurrentTenant,
  getTenantProfile,
  pickBusinessLogoPath,
  updateTenantProfile
} from "@main/services/tenant-service";
import { getSyncSnapshot, listSyncQueue } from "@main/services/sync-service";
import { saveTheme } from "@main/services/theme-service";
import { brandThemeSchema } from "@shared/schemas/theme";
import type { CategoryStatus } from "@shared/types/category";
import type { CustomerStatus } from "@shared/types/customer";
import type { EmployeeStatus } from "@shared/types/employee";
import type { LocationStatus } from "@shared/types/location";
import type { ProductStatus } from "@shared/types/product";
import type { QuotationStatus } from "@shared/types/quotation";
import { ipcChannels } from "./channels";

const { ipcMain } = electron;

export function registerIpcHandlers(): void {
  ipcMain.handle(ipcChannels.appGetContext, () => getAppContext());
  ipcMain.handle(ipcChannels.authLogin, (_event, input: unknown) => login(input));
  ipcMain.handle(ipcChannels.authLogout, () => {
    logout();
    return { success: true as const };
  });
  ipcMain.handle(ipcChannels.authGetSession, () => getSession());
  ipcMain.handle(ipcChannels.tenantGetCurrent, () => getCurrentTenant());
  ipcMain.handle(ipcChannels.tenantGetProfile, () => getTenantProfile());
  ipcMain.handle(ipcChannels.tenantUpdateProfile, (_event, input: unknown) =>
    updateTenantProfile(input)
  );
  ipcMain.handle(ipcChannels.tenantPickLogo, () => pickBusinessLogoPath());
  ipcMain.handle(ipcChannels.tenantReadImagePreview, (_event, path: string) =>
    readManagedBusinessLogoPreview(path)
  );
  ipcMain.handle(ipcChannels.locationList, () => listLocations());
  ipcMain.handle(ipcChannels.locationGet, (_event, id: string) => getLocation(id));
  ipcMain.handle(ipcChannels.locationCreate, (_event, input: unknown) => createLocation(input));
  ipcMain.handle(ipcChannels.locationUpdate, (_event, id: string, input: unknown) =>
    updateLocation(id, input)
  );
  ipcMain.handle(ipcChannels.locationSetStatus, (_event, id: string, status: LocationStatus) =>
    setLocationStatus(id, status)
  );
  ipcMain.handle(ipcChannels.locationPickLogo, () => pickAndStoreLocationLogo());
  ipcMain.handle(ipcChannels.locationReadLogoPreview, (_event, relativePath: string) =>
    readManagedLocationLogoPreview(relativePath)
  );
  ipcMain.handle(ipcChannels.categoryList, () => listCategories());
  ipcMain.handle(ipcChannels.categoryGet, (_event, id: string) => getCategory(id));
  ipcMain.handle(ipcChannels.categoryCreate, (_event, input: unknown) => createCategory(input));
  ipcMain.handle(ipcChannels.categoryUpdate, (_event, id: string, input: unknown) =>
    updateCategory(id, input)
  );
  ipcMain.handle(ipcChannels.categorySetStatus, (_event, id: string, status: CategoryStatus) =>
    setCategoryStatus(id, status)
  );
  ipcMain.handle(ipcChannels.categoryDelete, (_event, id: string) => deleteCategory(id));
  ipcMain.handle(ipcChannels.productList, () => listProducts());
  ipcMain.handle(ipcChannels.productGet, (_event, id: string) => getProduct(id));
  ipcMain.handle(ipcChannels.productCreate, (_event, input: unknown) => createProduct(input));
  ipcMain.handle(ipcChannels.productUpdate, (_event, id: string, input: unknown) =>
    updateProduct(id, input)
  );
  ipcMain.handle(ipcChannels.productSetStatus, (_event, id: string, status: ProductStatus) =>
    setProductStatus(id, status)
  );
  ipcMain.handle(ipcChannels.productPickImage, () => pickAndStoreProductImage());
  ipcMain.handle(ipcChannels.productReadImagePreview, (_event, relativePath: string) =>
    readManagedProductImagePreview(relativePath)
  );
  ipcMain.handle(ipcChannels.inventoryOverview, (_event, productId: string) =>
    getInventoryOverview(productId)
  );
  ipcMain.handle(ipcChannels.inventoryListForLocation, (_event, locationId: string) =>
    listInventoryForLocation(locationId)
  );
  ipcMain.handle(ipcChannels.stockMovementList, (_event, productId: string, input?: { limit?: number }) =>
    listStockMovements(productId, input?.limit)
  );
  ipcMain.handle(ipcChannels.stockMovementCreate, (_event, input: unknown) => recordStockMovement(input));
  ipcMain.handle(ipcChannels.stockMovementTransfer, (_event, input: unknown) => recordStockTransfer(input));
  ipcMain.handle(ipcChannels.roleList, () => listRoles());
  ipcMain.handle(ipcChannels.roleGet, (_event, id: string) => getRole(id));
  ipcMain.handle(ipcChannels.roleCreate, (_event, input: unknown) => createRole(input));
  ipcMain.handle(ipcChannels.roleUpdate, (_event, id: string, input: unknown) => updateRole(id, input));
  ipcMain.handle(ipcChannels.roleDelete, (_event, id: string) => deleteRole(id));
  ipcMain.handle(ipcChannels.employeeList, () => listEmployees());
  ipcMain.handle(ipcChannels.employeeGet, (_event, id: string) => getEmployee(id));
  ipcMain.handle(ipcChannels.employeeCreate, (_event, input: unknown) => createEmployee(input));
  ipcMain.handle(ipcChannels.employeeUpdate, (_event, id: string, input: unknown) =>
    updateEmployee(id, input)
  );
  ipcMain.handle(ipcChannels.employeeSetStatus, (_event, id: string, status: EmployeeStatus) =>
    setEmployeeStatus(id, status)
  );
  ipcMain.handle(ipcChannels.employeeDelete, (_event, id: string) => deleteEmployee(id));
  ipcMain.handle(ipcChannels.employeePickPhoto, () => pickAndStoreEmployeePhoto());
  ipcMain.handle(ipcChannels.employeeReadPhotoPreview, (_event, relativePath: string) =>
    readManagedEmployeePhotoPreview(relativePath)
  );
  ipcMain.handle(ipcChannels.paymentMethodList, () => listPaymentMethods());
  ipcMain.handle(ipcChannels.paymentMethodGet, (_event, id: string) => getPaymentMethod(id));
  ipcMain.handle(ipcChannels.paymentMethodCreate, (_event, input: unknown) =>
    createPaymentMethod(input)
  );
  ipcMain.handle(ipcChannels.paymentMethodUpdate, (_event, id: string, input: unknown) =>
    updatePaymentMethod(id, input)
  );
  ipcMain.handle(ipcChannels.paymentMethodSetActive, (_event, id: string, isActive: boolean) =>
    setPaymentMethodActive(id, isActive)
  );
  ipcMain.handle(ipcChannels.paymentMethodDelete, (_event, id: string) => deletePaymentMethod(id));
  ipcMain.handle(ipcChannels.customerList, () => listCustomers());
  ipcMain.handle(ipcChannels.customerGet, (_event, id: string) => getCustomer(id));
  ipcMain.handle(ipcChannels.customerCreate, (_event, input: unknown) => createCustomer(input));
  ipcMain.handle(ipcChannels.customerUpdate, (_event, id: string, input: unknown) =>
    updateCustomer(id, input)
  );
  ipcMain.handle(ipcChannels.customerSetStatus, (_event, id: string, status: CustomerStatus) =>
    setCustomerStatus(id, status)
  );
  ipcMain.handle(ipcChannels.saleList, () => listSales());
  ipcMain.handle(ipcChannels.saleListPending, () => listPendingSales());
  ipcMain.handle(ipcChannels.saleGet, (_event, id: string) => getSale(id));
  ipcMain.handle(ipcChannels.saleSuspend, (_event, input: unknown) => suspendSale(input));
  ipcMain.handle(ipcChannels.saleDeletePending, (_event, id: string) => deletePendingSale(id));
  ipcMain.handle(ipcChannels.saleComplete, (_event, input: unknown) => completeSale(input));
  ipcMain.handle(ipcChannels.saleVoidList, () => listSaleVoids());
  ipcMain.handle(ipcChannels.saleVoidGet, (_event, id: string) => getSaleVoid(id));
  ipcMain.handle(ipcChannels.saleVoidRequest, (_event, input: unknown) => requestSaleVoid(input));
  ipcMain.handle(ipcChannels.saleVoidApprove, (_event, id: string, input: unknown) =>
    approveSaleVoid(id, input)
  );
  ipcMain.handle(ipcChannels.saleVoidReject, (_event, id: string, input: unknown) =>
    rejectSaleVoid(id, input)
  );
  ipcMain.handle(ipcChannels.saleReturnList, () => listSaleReturns());
  ipcMain.handle(ipcChannels.saleReturnGet, (_event, id: string) => getSaleReturn(id));
  ipcMain.handle(ipcChannels.saleReturnRequest, (_event, input: unknown) => requestSaleReturn(input));
  ipcMain.handle(ipcChannels.saleReturnApprove, (_event, id: string, input: unknown) =>
    approveSaleReturn(id, input)
  );
  ipcMain.handle(ipcChannels.saleReturnReject, (_event, id: string, input: unknown) =>
    rejectSaleReturn(id, input)
  );
  ipcMain.handle(ipcChannels.invoiceList, () => listInvoices());
  ipcMain.handle(ipcChannels.invoiceSummary, () => getInvoiceSummary());
  ipcMain.handle(ipcChannels.invoiceCreate, (_event, input: unknown) => createInvoice(input));
  ipcMain.handle(ipcChannels.invoiceRecordPayment, (_event, id: string, input: unknown) =>
    recordInvoicePayment(id, input)
  );
  ipcMain.handle(ipcChannels.invoiceCancel, (_event, id: string) => cancelInvoice(id));
  ipcMain.handle(ipcChannels.invoiceMarkPaid, (_event, id: string, input: unknown) =>
    markInvoicePaid(id, input)
  );
  ipcMain.handle(ipcChannels.invoiceDuplicate, (_event, id: string) => duplicateInvoice(id));
  ipcMain.handle(ipcChannels.quotationList, () => listQuotations());
  ipcMain.handle(ipcChannels.quotationSummary, () => getQuotationSummary());
  ipcMain.handle(ipcChannels.quotationGet, (_event, id: string) => getQuotation(id));
  ipcMain.handle(ipcChannels.quotationCreate, (_event, input: unknown) => createQuotation(input));
  ipcMain.handle(ipcChannels.quotationUpdate, (_event, id: string, input: unknown) =>
    updateQuotation(id, input)
  );
  ipcMain.handle(ipcChannels.quotationDelete, (_event, id: string) => deleteQuotation(id));
  ipcMain.handle(ipcChannels.quotationSetStatus, (_event, id: string, status: QuotationStatus) =>
    setQuotationStatus(id, status)
  );
  ipcMain.handle(ipcChannels.quotationCheckStock, (_event, id: string) => checkQuotationStock(id));
  ipcMain.handle(ipcChannels.quotationConvertToSale, (_event, id: string, input: unknown) =>
    convertQuotationToSale(id, input)
  );
  ipcMain.handle(ipcChannels.quotationConvertToInvoice, (_event, id: string, input: unknown) =>
    convertQuotationToInvoice(id, input)
  );
  ipcMain.handle(ipcChannels.printerGetSettings, () => getPrinterSettings());
  ipcMain.handle(ipcChannels.printerSaveSettings, (_event, input: unknown) => savePrinterSettings(input));
  ipcMain.handle(ipcChannels.printerTestConnection, () => testPrinterConnection());
  ipcMain.handle(ipcChannels.printerPrintReceipt, (_event, saleId: string) => printReceipt(saleId));
  ipcMain.handle(ipcChannels.printerGenerateReceiptPdf, (_event, saleId: string) =>
    generateReceiptPdf(saleId)
  );
  ipcMain.handle(ipcChannels.printerGenerateInvoicePdf, (_event, saleId: string) =>
    generateInvoicePdf(saleId)
  );
  ipcMain.handle(ipcChannels.printerPrintInvoiceDocument, (_event, saleId: string) =>
    printInvoiceDocument(saleId)
  );
  ipcMain.handle(ipcChannels.printerGenerateQuotationPdf, (_event, quotationId: string) =>
    generateQuotationPdf(quotationId)
  );
  ipcMain.handle(ipcChannels.printerPrintQuotationDocument, (_event, quotationId: string) =>
    printQuotationDocument(quotationId)
  );
  ipcMain.handle(ipcChannels.syncGetSnapshot, () => getSyncSnapshot());
  ipcMain.handle(ipcChannels.syncListQueue, (_event, input?: { limit?: number }) =>
    listSyncQueue(input?.limit)
  );
  ipcMain.handle(ipcChannels.themeSave, (_event, theme: unknown) =>
    saveTheme(brandThemeSchema.parse(theme))
  );
}
