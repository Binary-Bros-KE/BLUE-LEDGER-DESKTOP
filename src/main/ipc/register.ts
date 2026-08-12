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
  listEmployeesForSalaryPicker,
  setEmployeeStatus,
  updateEmployee
} from "@main/services/employee-service";
import {
  openManagedExpenseAttachment,
  openManagedPurchaseAttachment,
  pickAndStoreEmployeePhoto,
  pickAndStoreExpenseAttachment,
  pickAndStoreLocationLogo,
  pickAndStoreProductImage,
  pickAndStorePurchaseAttachment,
  readManagedBusinessLogoPreview,
  readManagedEmployeePhotoPreview,
  readManagedLocationLogoPreview,
  readManagedProductImagePreview
} from "@main/services/image-service";
import {
  createInvoice,
  duplicateInvoice,
  getInvoiceSummary,
  listInvoices,
  markInvoicePaid,
  recordInvoicePayment
} from "@main/services/invoice-service";
import {
  approveInvoiceCancel,
  cancelInvoiceDirect,
  getInvoiceCancellation,
  listInvoiceCancellations,
  rejectInvoiceCancel,
  requestInvoiceCancel
} from "@main/services/invoice-cancellation-service";
import {
  getInventoryOverview,
  listAllStockMovements,
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
  checkStkStatus,
  getMpesaTillSettings,
  getStkStatus,
  isMpesaConfigured,
  saveMpesaTillSettings,
  sendStkPush
} from "@main/services/mpesa-service";
import {
  createPaymentMethod,
  deletePaymentMethod,
  getPaymentMethod,
  listPaymentMethods,
  setPaymentMethodActive,
  updatePaymentMethod
} from "@main/services/payment-method-service";
import {
  generateDeliveryNotePdf,
  generateInvoicePdf,
  generateQuotationPdf,
  generateReceiptPdf,
  generateSalaryPdf,
  generateStatementPdf,
  generateStockReceiptPdf,
  getPdfPreviewData,
  getPrinterSettings,
  downloadPdfPreview,
  previewDeliveryNotePdf,
  previewInvoicePdf,
  previewQuotationPdf,
  previewReceiptPdf,
  previewSalaryPdf,
  previewStatementPdf,
  previewStockReceiptPdf,
  printDeliveryNote,
  printDeliveryNoteViaThermal,
  printInvoiceDocument,
  printInvoiceViaThermal,
  printPdfPreview,
  printQuotationDocument,
  printQuotationViaThermal,
  printReceipt,
  printStatementDocument,
  printStockReceipt,
  savePrinterSettings,
  shareSalaryPayslip,
  testPrinterConnection
} from "@main/services/printer-service";
import {
  attachDeliveryToSale,
  getDeliveryNote,
  getDeliveryNoteForQuotation,
  getDeliveryNoteForSale,
  setDeliveryNoteDelivered
} from "@main/services/delivery-note-service";
import { getCustomerStatement } from "@main/services/statement-service";
import { exportListToCsv, exportListToExcel, exportListToPdf } from "@main/services/export-service";
import { exportReportToExcel, exportReportToPdf } from "@main/services/report-export-service";
import { createStockReceipt, getStockReceipt, listStockReceipts } from "@main/services/stock-receipt-service";
import {
  approveStockRequest,
  createStockRequest,
  getStockRequest,
  listStockRequests,
  rejectStockRequest
} from "@main/services/stock-request-service";
import {
  advanceRecurringBill,
  createRecurringBill,
  deleteRecurringBill,
  getRecurringBill,
  listRecurringBills,
  markRecurringBillPaid,
  setRecurringBillStatus,
  updateRecurringBill
} from "@main/services/recurring-bill-service";
import {
  completeSalary,
  createSalary,
  createSalaryAdvance,
  deleteSalaryAdvance,
  getSalary,
  listSalaries,
  restoreSalary,
  voidSalary
} from "@main/services/salary-service";
import {
  bulkSetProductTaxType,
  createProduct,
  getProduct,
  getProductStockSummary,
  listProducts,
  listProductsForStorefront,
  nextProductSku,
  setProductStatus,
  updateProduct
} from "@main/services/product-service";
import {
  distributeFromMainStore,
  getMainStoreAllocationSummary,
  getMainStoreProductDetail,
  listMainStoreProductRows,
  reallocateMainStoreStock,
  receiveMainStoreStock,
  recordMainStoreAdjustment,
  recordMainStoreDamage,
  returnToMainStore
} from "@main/services/main-store-service";
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
import { createRole, deleteRole, getRole, listRoles, listRolesForPicker, updateRole } from "@main/services/role-service";
import {
  createSupplier,
  getSupplier,
  listSuppliers,
  setSupplierStatus,
  updateSupplier
} from "@main/services/supplier-service";
import { createRider, getRider, listRiders, setRiderStatus, updateRider } from "@main/services/rider-service";
import {
  cancelPurchase,
  createPurchase,
  getPurchase,
  getPurchaseSummary,
  listPurchases,
  markPurchaseOrdered,
  markPurchasePaid,
  receivePurchaseGoods,
  recordPurchasePayment,
  updatePurchase
} from "@main/services/purchase-service";
import {
  createExpenseCategory,
  listExpenseCategories,
  setExpenseCategoryStatus,
  updateExpenseCategory
} from "@main/services/expense-category-service";
import {
  archiveExpense,
  createExpense,
  deleteExpense,
  getExpense,
  getExpenseSummary,
  listExpenses,
  restoreExpense,
  updateExpense
} from "@main/services/expense-service";
import {
  archiveLocalPurchase,
  createLocalPurchase,
  deleteLocalPurchase,
  getLocalPurchase,
  getLocalPurchaseSummary,
  listLocalPurchases,
  restoreLocalPurchase,
  updateLocalPurchase
} from "@main/services/local-purchase-service";
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
import { activateInstallation, fetchPaymentHistory, fetchPaymentSchedule, heartbeatAndGetContext } from "@main/services/license-service";
import { checkBillingStkStatus, getBillingStkStatus, sendBillingStkPush } from "@main/services/billing-mpesa-service";
import {
  checkPesapalStatus,
  getPesapalStatus,
  openPesapalCheckout,
  submitBillingPesapalOrder
} from "@main/services/billing-pesapal-service";
import { checkForUpdates, getUpdateStatus, installUpdateNow } from "@main/services/update-service";
import {
  getEntitySyncOverview,
  getSyncSnapshot,
  listConflicts,
  listRecentReconciliations,
  listSyncQueue,
  resolveConflict,
  runSyncNow
} from "@main/services/sync-service";
import { commitImport, pickImportFile, previewImport } from "@main/services/import-service";
import { createDeliveryShareLink, createShareLink } from "@main/services/share-service";
import { saveTheme } from "@main/services/theme-service";
import {
  getCancelledPurchasesInRange,
  getMySales,
  getPaymentTransactions,
  getSalesByEmployee,
  getSalesByPaymentMethod,
  getSalesByStorefront,
  getSalesFinancialOverview,
  getSalesTransactions,
  getSalesTrendWindow,
} from "@main/services/report-service";
import { getInventoryReportData } from "@main/services/inventory-report-service";
import { getProductSalesHistory, getProductsPerformanceReport } from "@main/services/product-report-service";
import { getTaxReport } from "@main/services/tax-report-service";
import { getLocalSourcingReport } from "@main/services/local-sourcing-report-service";
import { getCustomerPurchaseHistory, getOutstandingInvoices, getTopCustomers } from "@main/services/customer-report-service";
import {
  getOutstandingPurchases,
  getSupplierPurchaseHistory,
  getSupplierSpendBreakdown
} from "@main/services/supplier-report-service";
import { brandThemeSchema } from "@shared/schemas/theme";
import type { CategoryStatus } from "@shared/types/category";
import type { CustomerStatus } from "@shared/types/customer";
import type { ExpenseCategoryStatus } from "@shared/types/expense-category";
import type { SupplierStatus } from "@shared/types/supplier";
import type { RiderStatus } from "@shared/types/rider";
import type { ExportListRequest } from "@shared/types/export";
import type { ReportExportRequest } from "@shared/types/report-export";
import type { RecurringBillStatus } from "@shared/types/recurring-bill";
import type { EmployeeStatus } from "@shared/types/employee";
import type { LocationStatus } from "@shared/types/location";
import type { ProductStatus } from "@shared/types/product";
import type { QuotationStatus } from "@shared/types/quotation";
import type { ImportEntityType } from "@shared/types/import";
import type { ShareDocumentEntity } from "@shared/types/share";
import { ZodError } from "zod";
import { ipcChannels } from "./channels";

const { ipcMain: electronIpcMain } = electron;

/** A ZodError's own .message is a raw JSON blob of every issue (Zod v4 default) — never fit for
 * display. Reduces it to the actual human-readable issue message(s), e.g. "PIN must contain only
 * digits" instead of `[{ "origin": "string", "code": "invalid_format", ... }]`. */
function formatThrownError(err: unknown): Error {
  if (err instanceof ZodError) {
    const messages = err.issues.map((issue) => issue.message).filter(Boolean);
    return new Error(messages.length > 0 ? messages.join("; ") : "Invalid input");
  }
  if (err instanceof Error) {
    return err;
  }
  return new Error("An unexpected error occurred");
}

/**
 * Every service function validates its input via schema.parse(input), and a failure there is the
 * single most common error path in the whole app — this wraps every ipcMain.handle callback so that
 * failure (and any other thrown error) always crosses the IPC boundary as a clean, single-sentence
 * message instead of whatever an error's raw .message happens to contain. Shadows the destructured
 * `ipcMain` below so none of this file's ~180 existing `ipcMain.handle(...)` call sites need to change.
 */
const ipcMain = {
  handle(
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<unknown> | unknown
  ): void {
    electronIpcMain.handle(channel, async (event, ...args) => {
      try {
        return await listener(event, ...args);
      } catch (err) {
        throw formatThrownError(err);
      }
    });
  }
};

export function registerIpcHandlers(): void {
  ipcMain.handle(ipcChannels.appGetContext, () => getAppContext());
  ipcMain.handle(ipcChannels.updateGetStatus, () => getUpdateStatus());
  ipcMain.handle(ipcChannels.updateCheckNow, () => checkForUpdates());
  ipcMain.handle(ipcChannels.updateInstallNow, () => installUpdateNow());
  ipcMain.handle(ipcChannels.activationActivate, (_event, licenseKey: string) => activateInstallation(licenseKey));
  ipcMain.handle(ipcChannels.activationHeartbeat, () => heartbeatAndGetContext());
  ipcMain.handle(ipcChannels.activationPayments, () => fetchPaymentHistory());
  ipcMain.handle(ipcChannels.activationPaymentSchedule, () => fetchPaymentSchedule());
  ipcMain.handle(ipcChannels.billingMpesaSendStkPush, (_event, input: { phone: string; periodCount: number }) =>
    sendBillingStkPush(input)
  );
  ipcMain.handle(ipcChannels.billingMpesaGetStkStatus, (_event, checkoutRequestId: string) =>
    getBillingStkStatus(checkoutRequestId)
  );
  ipcMain.handle(ipcChannels.billingMpesaCheckStkStatus, (_event, checkoutRequestId: string) =>
    checkBillingStkStatus(checkoutRequestId)
  );
  ipcMain.handle(ipcChannels.billingPesapalSubmitOrder, (_event, input: { periodCount: number; enrollAutoBilling: boolean }) =>
    submitBillingPesapalOrder(input)
  );
  ipcMain.handle(ipcChannels.billingPesapalGetStatus, (_event, orderTrackingId: string) => getPesapalStatus(orderTrackingId));
  ipcMain.handle(ipcChannels.billingPesapalCheckStatus, (_event, orderTrackingId: string) => checkPesapalStatus(orderTrackingId));
  ipcMain.handle(ipcChannels.billingPesapalOpenRedirect, (_event, redirectUrl: string) => openPesapalCheckout(redirectUrl));
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
  ipcMain.handle(ipcChannels.mpesaGetSettings, (_event, locationId: string) => getMpesaTillSettings(locationId));
  ipcMain.handle(ipcChannels.mpesaSaveSettings, (_event, locationId: string, input: unknown) =>
    saveMpesaTillSettings(locationId, input)
  );
  ipcMain.handle(ipcChannels.mpesaIsConfigured, (_event, locationId: string) => isMpesaConfigured(locationId));
  ipcMain.handle(ipcChannels.mpesaSendStkPush, (_event, input: { locationId: string; phone: string; amountCents: number }) =>
    sendStkPush(input)
  );
  ipcMain.handle(ipcChannels.mpesaGetStkStatus, (_event, checkoutRequestId: string) => getStkStatus(checkoutRequestId));
  ipcMain.handle(ipcChannels.mpesaCheckStkStatus, (_event, checkoutRequestId: string) => checkStkStatus(checkoutRequestId));
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
  ipcMain.handle(ipcChannels.productList, (_event, storefrontId?: string | null) => listProducts(storefrontId));
  ipcMain.handle(ipcChannels.productNextSku, () => nextProductSku());
  ipcMain.handle(ipcChannels.productStockSummary, (_event, id: string) => getProductStockSummary(id));
  ipcMain.handle(ipcChannels.productGet, (_event, id: string) => getProduct(id));
  ipcMain.handle(ipcChannels.productCreate, (_event, input: unknown) => createProduct(input));
  ipcMain.handle(ipcChannels.productUpdate, (_event, id: string, input: unknown) =>
    updateProduct(id, input)
  );
  ipcMain.handle(ipcChannels.productSetStatus, (_event, id: string, status: ProductStatus) =>
    setProductStatus(id, status)
  );
  ipcMain.handle(ipcChannels.productBulkSetTaxType, (_event, input: unknown) => bulkSetProductTaxType(input));
  ipcMain.handle(ipcChannels.productPickImage, () => pickAndStoreProductImage());
  ipcMain.handle(ipcChannels.productReadImagePreview, (_event, relativePath: string) =>
    readManagedProductImagePreview(relativePath)
  );
  ipcMain.handle(ipcChannels.mainStoreProductList, (_event, locationId: string | null) =>
    listProductsForStorefront(locationId)
  );
  ipcMain.handle(ipcChannels.mainStoreAllocationSummary, () => getMainStoreAllocationSummary());
  ipcMain.handle(ipcChannels.mainStoreProductRows, () => listMainStoreProductRows());
  ipcMain.handle(ipcChannels.mainStoreProductDetail, (_event, productId: string) =>
    getMainStoreProductDetail(productId)
  );
  ipcMain.handle(ipcChannels.mainStoreReceive, (_event, input: unknown) => receiveMainStoreStock(input));
  ipcMain.handle(ipcChannels.mainStoreDistribute, (_event, input: unknown) => distributeFromMainStore(input));
  ipcMain.handle(ipcChannels.mainStoreReturn, (_event, input: unknown) => returnToMainStore(input));
  ipcMain.handle(ipcChannels.mainStoreReallocate, (_event, input: unknown) => reallocateMainStoreStock(input));
  ipcMain.handle(ipcChannels.mainStoreDamage, (_event, input: unknown) => recordMainStoreDamage(input));
  ipcMain.handle(ipcChannels.mainStoreAdjust, (_event, input: unknown) => recordMainStoreAdjustment(input));
  ipcMain.handle(ipcChannels.inventoryOverview, (_event, productId: string) =>
    getInventoryOverview(productId)
  );
  ipcMain.handle(ipcChannels.inventoryListForLocation, (_event, locationId: string) =>
    listInventoryForLocation(locationId)
  );
  ipcMain.handle(ipcChannels.stockMovementList, (_event, productId: string, input?: { limit?: number }) =>
    listStockMovements(productId, input?.limit)
  );
  ipcMain.handle(ipcChannels.stockMovementListAll, (_event, input?: { limit?: number }) =>
    listAllStockMovements(input?.limit)
  );
  ipcMain.handle(ipcChannels.stockMovementCreate, (_event, input: unknown) => recordStockMovement(input));
  ipcMain.handle(ipcChannels.stockMovementTransfer, (_event, input: unknown) => recordStockTransfer(input));
  ipcMain.handle(ipcChannels.roleList, () => listRoles());
  ipcMain.handle(ipcChannels.roleListForPicker, () => listRolesForPicker());
  ipcMain.handle(ipcChannels.roleGet, (_event, id: string) => getRole(id));
  ipcMain.handle(ipcChannels.roleCreate, (_event, input: unknown) => createRole(input));
  ipcMain.handle(ipcChannels.roleUpdate, (_event, id: string, input: unknown) => updateRole(id, input));
  ipcMain.handle(ipcChannels.roleDelete, (_event, id: string) => deleteRole(id));
  ipcMain.handle(ipcChannels.employeeList, () => listEmployees());
  ipcMain.handle(ipcChannels.employeeListForSalaryPicker, () => listEmployeesForSalaryPicker());
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
  ipcMain.handle(ipcChannels.supplierList, () => listSuppliers());
  ipcMain.handle(ipcChannels.supplierGet, (_event, id: string) => getSupplier(id));
  ipcMain.handle(ipcChannels.supplierCreate, (_event, input: unknown) => createSupplier(input));
  ipcMain.handle(ipcChannels.supplierUpdate, (_event, id: string, input: unknown) =>
    updateSupplier(id, input)
  );
  ipcMain.handle(ipcChannels.supplierSetStatus, (_event, id: string, status: SupplierStatus) =>
    setSupplierStatus(id, status)
  );
  ipcMain.handle(ipcChannels.riderList, () => listRiders());
  ipcMain.handle(ipcChannels.riderGet, (_event, id: string) => getRider(id));
  ipcMain.handle(ipcChannels.riderCreate, (_event, input: unknown) => createRider(input));
  ipcMain.handle(ipcChannels.riderUpdate, (_event, id: string, input: unknown) => updateRider(id, input));
  ipcMain.handle(ipcChannels.riderSetStatus, (_event, id: string, status: RiderStatus) =>
    setRiderStatus(id, status)
  );
  ipcMain.handle(ipcChannels.purchaseList, () => listPurchases());
  ipcMain.handle(ipcChannels.purchaseSummary, () => getPurchaseSummary());
  ipcMain.handle(ipcChannels.purchaseGet, (_event, id: string) => getPurchase(id));
  ipcMain.handle(ipcChannels.purchaseCreate, (_event, input: unknown) => createPurchase(input));
  ipcMain.handle(ipcChannels.purchaseUpdate, (_event, id: string, input: unknown) => updatePurchase(id, input));
  ipcMain.handle(ipcChannels.purchaseMarkOrdered, (_event, id: string) => markPurchaseOrdered(id));
  ipcMain.handle(ipcChannels.purchaseCancel, (_event, id: string) => cancelPurchase(id));
  ipcMain.handle(ipcChannels.purchaseReceiveGoods, (_event, id: string, input: unknown) =>
    receivePurchaseGoods(id, input)
  );
  ipcMain.handle(ipcChannels.purchaseRecordPayment, (_event, id: string, input: unknown) =>
    recordPurchasePayment(id, input)
  );
  ipcMain.handle(ipcChannels.purchaseMarkPaid, (_event, id: string, input: unknown) =>
    markPurchasePaid(id, input)
  );
  ipcMain.handle(ipcChannels.purchasePickAttachment, () => pickAndStorePurchaseAttachment());
  ipcMain.handle(ipcChannels.purchaseOpenAttachment, (_event, relativePath: string) =>
    openManagedPurchaseAttachment(relativePath).then(() => ({ success: true as const }))
  );
  ipcMain.handle(ipcChannels.expenseCategoryList, () => listExpenseCategories());
  ipcMain.handle(ipcChannels.expenseCategoryCreate, (_event, input: unknown) => createExpenseCategory(input));
  ipcMain.handle(ipcChannels.expenseCategoryUpdate, (_event, id: string, input: unknown) =>
    updateExpenseCategory(id, input)
  );
  ipcMain.handle(ipcChannels.expenseCategorySetStatus, (_event, id: string, status: ExpenseCategoryStatus) =>
    setExpenseCategoryStatus(id, status)
  );
  ipcMain.handle(ipcChannels.expenseList, () => listExpenses());
  ipcMain.handle(ipcChannels.expenseSummary, () => getExpenseSummary());
  ipcMain.handle(ipcChannels.expenseGet, (_event, id: string) => getExpense(id));
  ipcMain.handle(ipcChannels.expenseCreate, (_event, input: unknown) => createExpense(input));
  ipcMain.handle(ipcChannels.expenseUpdate, (_event, id: string, input: unknown) => updateExpense(id, input));
  ipcMain.handle(ipcChannels.expenseArchive, (_event, id: string) => archiveExpense(id));
  ipcMain.handle(ipcChannels.expenseRestore, (_event, id: string) => restoreExpense(id));
  ipcMain.handle(ipcChannels.expenseDelete, (_event, id: string) => deleteExpense(id));
  ipcMain.handle(ipcChannels.expensePickAttachment, () => pickAndStoreExpenseAttachment());
  ipcMain.handle(ipcChannels.expenseOpenAttachment, (_event, relativePath: string) =>
    openManagedExpenseAttachment(relativePath).then(() => ({ success: true as const }))
  );
  ipcMain.handle(ipcChannels.localPurchaseList, () => listLocalPurchases());
  ipcMain.handle(ipcChannels.localPurchaseSummary, () => getLocalPurchaseSummary());
  ipcMain.handle(ipcChannels.localPurchaseGet, (_event, id: string) => getLocalPurchase(id));
  ipcMain.handle(ipcChannels.localPurchaseCreate, (_event, input: unknown) => createLocalPurchase(input));
  ipcMain.handle(ipcChannels.localPurchaseUpdate, (_event, id: string, input: unknown) =>
    updateLocalPurchase(id, input)
  );
  ipcMain.handle(ipcChannels.localPurchaseArchive, (_event, id: string) => archiveLocalPurchase(id));
  ipcMain.handle(ipcChannels.localPurchaseRestore, (_event, id: string) => restoreLocalPurchase(id));
  ipcMain.handle(ipcChannels.localPurchaseDelete, (_event, id: string) => deleteLocalPurchase(id));
  ipcMain.handle(ipcChannels.localPurchasePickAttachment, () => pickAndStoreExpenseAttachment());
  ipcMain.handle(ipcChannels.localPurchaseOpenAttachment, (_event, relativePath: string) =>
    openManagedExpenseAttachment(relativePath).then(() => ({ success: true as const }))
  );
  ipcMain.handle(ipcChannels.salaryList, () => listSalaries());
  ipcMain.handle(ipcChannels.salaryGet, (_event, id: string) => getSalary(id));
  ipcMain.handle(ipcChannels.salaryCreate, (_event, input: unknown) => createSalary(input));
  ipcMain.handle(ipcChannels.salaryCreateAdvance, (_event, input: unknown) => createSalaryAdvance(input));
  ipcMain.handle(ipcChannels.salaryComplete, (_event, id: string, input: unknown) => completeSalary(id, input));
  ipcMain.handle(ipcChannels.salaryDeleteAdvance, (_event, id: string) => deleteSalaryAdvance(id));
  ipcMain.handle(ipcChannels.salaryVoid, (_event, id: string) => voidSalary(id));
  ipcMain.handle(ipcChannels.salaryRestore, (_event, id: string) => restoreSalary(id));
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
  ipcMain.handle(ipcChannels.invoiceCancel, (_event, id: string, input: unknown) => cancelInvoiceDirect(id, input));
  ipcMain.handle(ipcChannels.invoiceMarkPaid, (_event, id: string, input: unknown) =>
    markInvoicePaid(id, input)
  );
  ipcMain.handle(ipcChannels.invoiceDuplicate, (_event, id: string) => duplicateInvoice(id));
  ipcMain.handle(ipcChannels.invoiceCancellationList, () => listInvoiceCancellations());
  ipcMain.handle(ipcChannels.invoiceCancellationGet, (_event, id: string) => getInvoiceCancellation(id));
  ipcMain.handle(ipcChannels.invoiceCancellationRequest, (_event, input: unknown) => requestInvoiceCancel(input));
  ipcMain.handle(ipcChannels.invoiceCancellationApprove, (_event, id: string, input: unknown) =>
    approveInvoiceCancel(id, input)
  );
  ipcMain.handle(ipcChannels.invoiceCancellationReject, (_event, id: string, input: unknown) =>
    rejectInvoiceCancel(id, input)
  );
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
  ipcMain.handle(ipcChannels.printerPreviewReceiptPdf, (_event, saleId: string) =>
    previewReceiptPdf(saleId)
  );
  ipcMain.handle(ipcChannels.printerGenerateInvoicePdf, (_event, saleId: string) =>
    generateInvoicePdf(saleId)
  );
  ipcMain.handle(ipcChannels.printerPreviewInvoicePdf, (_event, saleId: string) =>
    previewInvoicePdf(saleId)
  );
  ipcMain.handle(ipcChannels.printerPrintInvoiceDocument, (_event, saleId: string) =>
    printInvoiceDocument(saleId)
  );
  ipcMain.handle(ipcChannels.printerPrintInvoiceThermal, (_event, saleId: string) =>
    printInvoiceViaThermal(saleId)
  );
  ipcMain.handle(ipcChannels.printerGenerateQuotationPdf, (_event, quotationId: string) =>
    generateQuotationPdf(quotationId)
  );
  ipcMain.handle(ipcChannels.printerPreviewQuotationPdf, (_event, quotationId: string) =>
    previewQuotationPdf(quotationId)
  );
  ipcMain.handle(ipcChannels.printerPrintQuotationDocument, (_event, quotationId: string) =>
    printQuotationDocument(quotationId)
  );
  ipcMain.handle(ipcChannels.printerPrintQuotationThermal, (_event, quotationId: string) =>
    printQuotationViaThermal(quotationId)
  );
  ipcMain.handle(ipcChannels.printerGenerateSalaryPdf, (_event, salaryId: string) => generateSalaryPdf(salaryId));
  ipcMain.handle(ipcChannels.printerPreviewSalaryPdf, (_event, salaryId: string) => previewSalaryPdf(salaryId));
  ipcMain.handle(ipcChannels.printerShareSalaryPayslip, (_event, salaryId: string) =>
    shareSalaryPayslip(salaryId)
  );
  ipcMain.handle(ipcChannels.printerPrintDeliveryNote, (_event, deliveryNoteId: string) =>
    printDeliveryNote(deliveryNoteId)
  );
  ipcMain.handle(ipcChannels.printerPrintDeliveryNoteThermal, (_event, deliveryNoteId: string) =>
    printDeliveryNoteViaThermal(deliveryNoteId)
  );
  ipcMain.handle(ipcChannels.printerGenerateDeliveryNotePdf, (_event, deliveryNoteId: string) =>
    generateDeliveryNotePdf(deliveryNoteId)
  );
  ipcMain.handle(ipcChannels.printerPreviewDeliveryNotePdf, (_event, deliveryNoteId: string) =>
    previewDeliveryNotePdf(deliveryNoteId)
  );
  ipcMain.handle(ipcChannels.printerGenerateStatementPdf, (_event, customerId: string) =>
    generateStatementPdf(customerId)
  );
  ipcMain.handle(ipcChannels.printerPreviewStatementPdf, (_event, customerId: string) =>
    previewStatementPdf(customerId)
  );
  ipcMain.handle(ipcChannels.printerPrintStatementDocument, (_event, customerId: string) =>
    printStatementDocument(customerId)
  );
  ipcMain.handle(ipcChannels.printerGenerateStockReceiptPdf, (_event, stockReceiptId: string) =>
    generateStockReceiptPdf(stockReceiptId)
  );
  ipcMain.handle(ipcChannels.printerPreviewStockReceiptPdf, (_event, stockReceiptId: string) =>
    previewStockReceiptPdf(stockReceiptId)
  );
  ipcMain.handle(ipcChannels.printerPrintStockReceiptDocument, (_event, stockReceiptId: string) =>
    printStockReceipt(stockReceiptId)
  );
  ipcMain.handle(ipcChannels.printerGetPdfPreviewData, (_event, previewId: string) => getPdfPreviewData(previewId));
  ipcMain.handle(ipcChannels.printerPrintPdfPreview, (_event, previewId: string) => printPdfPreview(previewId));
  ipcMain.handle(ipcChannels.printerDownloadPdfPreview, (_event, previewId: string) => downloadPdfPreview(previewId));
  ipcMain.handle(ipcChannels.statementGetForCustomer, (_event, customerId: string) => getCustomerStatement(customerId));
  ipcMain.handle(ipcChannels.deliveryNoteGet, (_event, id: string) => getDeliveryNote(id));
  ipcMain.handle(ipcChannels.deliveryNoteGetForSale, (_event, saleId: string) => getDeliveryNoteForSale(saleId));
  ipcMain.handle(ipcChannels.deliveryNoteGetForQuotation, (_event, quotationId: string) =>
    getDeliveryNoteForQuotation(quotationId)
  );
  ipcMain.handle(ipcChannels.deliveryNoteSetDelivered, (_event, id: string, delivered: boolean) =>
    setDeliveryNoteDelivered(id, delivered)
  );
  ipcMain.handle(ipcChannels.deliveryNoteAttachToSale, (_event, saleId: string, input: unknown) =>
    attachDeliveryToSale(saleId, input)
  );
  ipcMain.handle(ipcChannels.exportToPdf, (_event, request: ExportListRequest) => exportListToPdf(request));
  ipcMain.handle(ipcChannels.exportToCsv, (_event, request: ExportListRequest) => exportListToCsv(request));
  ipcMain.handle(ipcChannels.exportToExcel, (_event, request: ExportListRequest) => exportListToExcel(request));
  ipcMain.handle(ipcChannels.reportExportToPdf, (_event, request: ReportExportRequest) => exportReportToPdf(request));
  ipcMain.handle(ipcChannels.reportExportToExcel, (_event, request: ReportExportRequest) =>
    exportReportToExcel(request)
  );
  ipcMain.handle(ipcChannels.stockRequestList, () => listStockRequests());
  ipcMain.handle(ipcChannels.stockRequestGet, (_event, id: string) => getStockRequest(id));
  ipcMain.handle(ipcChannels.stockRequestCreate, (_event, input: unknown) => createStockRequest(input));
  ipcMain.handle(ipcChannels.stockRequestApprove, (_event, id: string) => approveStockRequest(id));
  ipcMain.handle(ipcChannels.stockRequestReject, (_event, id: string, input: unknown) => rejectStockRequest(id, input));
  ipcMain.handle(ipcChannels.stockReceiptList, () => listStockReceipts());
  ipcMain.handle(ipcChannels.stockReceiptGet, (_event, id: string) => getStockReceipt(id));
  ipcMain.handle(ipcChannels.stockReceiptCreate, (_event, input: unknown) => createStockReceipt(input));
  ipcMain.handle(ipcChannels.recurringBillList, () => listRecurringBills());
  ipcMain.handle(ipcChannels.recurringBillGet, (_event, id: string) => getRecurringBill(id));
  ipcMain.handle(ipcChannels.recurringBillCreate, (_event, input: unknown) => createRecurringBill(input));
  ipcMain.handle(ipcChannels.recurringBillUpdate, (_event, id: string, input: unknown) => updateRecurringBill(id, input));
  ipcMain.handle(ipcChannels.recurringBillSetStatus, (_event, id: string, status: RecurringBillStatus) =>
    setRecurringBillStatus(id, status)
  );
  ipcMain.handle(ipcChannels.recurringBillAdvance, (_event, id: string) => advanceRecurringBill(id));
  ipcMain.handle(ipcChannels.recurringBillMarkPaid, (_event, id: string, input: unknown) => markRecurringBillPaid(id, input));
  ipcMain.handle(ipcChannels.recurringBillDelete, (_event, id: string) => deleteRecurringBill(id));
  ipcMain.handle(ipcChannels.syncGetSnapshot, () => getSyncSnapshot());
  ipcMain.handle(ipcChannels.syncRunNow, () => runSyncNow());
  ipcMain.handle(ipcChannels.syncListQueue, (_event, input?: { limit?: number }) =>
    listSyncQueue(input?.limit)
  );
  ipcMain.handle(ipcChannels.syncListConflicts, () => listConflicts());
  ipcMain.handle(ipcChannels.syncResolveConflict, (_event, id: string, resolution: "mine" | "theirs") =>
    resolveConflict(id, resolution)
  );
  ipcMain.handle(ipcChannels.syncListReconciliations, () => listRecentReconciliations());
  ipcMain.handle(ipcChannels.syncGetEntityOverview, () => getEntitySyncOverview());
  ipcMain.handle(ipcChannels.importPickFile, (_event, entityType: ImportEntityType) => pickImportFile(entityType));
  ipcMain.handle(ipcChannels.importPreview, (_event, input: unknown) => previewImport(input));
  ipcMain.handle(ipcChannels.importCommit, (_event, input: unknown) => commitImport(input));
  ipcMain.handle(
    ipcChannels.shareCreateLink,
    (_event, entity: ShareDocumentEntity, entityId: string, includePreview: boolean) =>
      createShareLink(entity, entityId, includePreview)
  );
  ipcMain.handle(
    ipcChannels.shareCreateDeliveryLink,
    (_event, entity: ShareDocumentEntity, entityId: string, includePreview: boolean) =>
      createDeliveryShareLink(entity, entityId, includePreview)
  );
  ipcMain.handle(ipcChannels.themeSave, (_event, theme: unknown) =>
    saveTheme(brandThemeSchema.parse(theme))
  );
  ipcMain.handle(ipcChannels.reportSalesFinancialOverview, (_event, range: unknown) =>
    getSalesFinancialOverview(range)
  );
  ipcMain.handle(ipcChannels.reportSalesTransactions, (_event, range: unknown) => getSalesTransactions(range));
  ipcMain.handle(ipcChannels.reportCancelledPurchases, (_event, range: unknown) => getCancelledPurchasesInRange(range));
  ipcMain.handle(ipcChannels.reportPaymentTransactions, (_event, range: unknown) => getPaymentTransactions(range));
  ipcMain.handle(ipcChannels.reportMySales, (_event, range: unknown) => getMySales(range));
  ipcMain.handle(ipcChannels.reportSalesTrendWindow, (_event, input: unknown) => getSalesTrendWindow(input));
  ipcMain.handle(ipcChannels.reportSalesByStorefront, (_event, range: unknown) => getSalesByStorefront(range));
  ipcMain.handle(ipcChannels.reportSalesByEmployee, (_event, range: unknown) => getSalesByEmployee(range));
  ipcMain.handle(ipcChannels.reportSalesByPaymentMethod, (_event, range: unknown) =>
    getSalesByPaymentMethod(range)
  );
  ipcMain.handle(ipcChannels.reportInventoryData, () => getInventoryReportData());
  ipcMain.handle(ipcChannels.reportProductsPerformance, (_event, range: unknown) => getProductsPerformanceReport(range));
  ipcMain.handle(ipcChannels.reportProductSalesHistory, (_event, input: unknown) => getProductSalesHistory(input));
  ipcMain.handle(ipcChannels.reportTopCustomers, (_event, range: unknown) => getTopCustomers(range));
  ipcMain.handle(ipcChannels.reportCustomerPurchaseHistory, (_event, input: unknown) => getCustomerPurchaseHistory(input));
  ipcMain.handle(ipcChannels.reportOutstandingInvoices, () => getOutstandingInvoices());
  ipcMain.handle(ipcChannels.reportOutstandingPurchases, () => getOutstandingPurchases());
  ipcMain.handle(ipcChannels.reportSupplierPurchaseHistory, (_event, input: unknown) => getSupplierPurchaseHistory(input));
  ipcMain.handle(ipcChannels.reportSupplierSpendBreakdown, (_event, input: unknown) => getSupplierSpendBreakdown(input));
  ipcMain.handle(ipcChannels.reportTaxBreakdown, (_event, range: unknown) => getTaxReport(range));
  ipcMain.handle(ipcChannels.reportLocalSourcing, (_event, range: unknown) => getLocalSourcingReport(range));
}
