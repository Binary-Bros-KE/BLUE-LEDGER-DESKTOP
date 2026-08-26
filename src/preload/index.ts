import electron from "electron";
import type { BlueLedgerApi, IpcInvokeMap } from "@shared/types/ipc";

const { contextBridge, ipcRenderer } = electron;

function invoke<TChannel extends keyof IpcInvokeMap>(
  channel: TChannel,
  ...args: IpcInvokeMap[TChannel]["args"]
): Promise<IpcInvokeMap[TChannel]["result"]> {
  return ipcRenderer.invoke(channel, ...args);
}

const api: BlueLedgerApi = {
  app: {
    getContext: () => invoke("app:get-context")
  },
  update: {
    getStatus: () => invoke("update:get-status"),
    checkNow: () => invoke("update:check-now"),
    installNow: () => invoke("update:install-now")
  },
  activation: {
    activate: (licenseKey) => invoke("activation:activate", licenseKey),
    heartbeat: () => invoke("activation:heartbeat"),
    payments: () => invoke("activation:payments"),
    paymentSchedule: () => invoke("activation:payment-schedule")
  },
  billingMpesa: {
    sendStkPush: (input) => invoke("billing-mpesa:send-stk-push", input),
    getStkStatus: (checkoutRequestId) => invoke("billing-mpesa:get-stk-status", checkoutRequestId),
    checkStkStatus: (checkoutRequestId) => invoke("billing-mpesa:check-stk-status", checkoutRequestId)
  },
  billingPesapal: {
    submitOrder: (input) => invoke("billing-pesapal:submit-order", input),
    getStatus: (orderTrackingId) => invoke("billing-pesapal:get-status", orderTrackingId),
    checkStatus: (orderTrackingId) => invoke("billing-pesapal:check-status", orderTrackingId),
    openRedirect: (redirectUrl) => invoke("billing-pesapal:open-redirect", redirectUrl)
  },
  auth: {
    login: (input) => invoke("auth:login", input),
    logout: () => invoke("auth:logout"),
    getSession: () => invoke("auth:get-session")
  },
  tenant: {
    getCurrent: () => invoke("tenant:get-current"),
    getProfile: () => invoke("tenant:get-profile"),
    updateProfile: (input) => invoke("tenant:update-profile", input),
    pickLogo: () => invoke("tenant:pick-logo"),
    readImagePreview: (path) => invoke("tenant:read-image-preview", path)
  },
  location: {
    list: () => invoke("location:list"),
    get: (id) => invoke("location:get", id),
    create: (input) => invoke("location:create", input),
    update: (id, input) => invoke("location:update", id, input),
    setStatus: (id, status) => invoke("location:set-status", id, status),
    pickLogo: () => invoke("location:pick-logo"),
    readLogoPreview: (relativePath) => invoke("location:read-logo-preview", relativePath)
  },
  mpesa: {
    getSettings: (locationId) => invoke("mpesa:get-settings", locationId),
    saveSettings: (locationId, input) => invoke("mpesa:save-settings", locationId, input),
    isConfigured: (locationId) => invoke("mpesa:is-configured", locationId),
    sendStkPush: (input) => invoke("mpesa:send-stk-push", input),
    getStkStatus: (checkoutRequestId) => invoke("mpesa:get-stk-status", checkoutRequestId),
    checkStkStatus: (checkoutRequestId) => invoke("mpesa:check-stk-status", checkoutRequestId)
  },
  category: {
    list: () => invoke("category:list"),
    get: (id) => invoke("category:get", id),
    create: (input) => invoke("category:create", input),
    update: (id, input) => invoke("category:update", id, input),
    setStatus: (id, status) => invoke("category:set-status", id, status),
    delete: (id) => invoke("category:delete", id)
  },
  product: {
    list: (storefrontId) => invoke("product:list", storefrontId),
    nextSku: () => invoke("product:next-sku"),
    stockSummary: (id) => invoke("product:stock-summary", id),
    get: (id) => invoke("product:get", id),
    create: (input) => invoke("product:create", input),
    update: (id, input) => invoke("product:update", id, input),
    setStatus: (id, status) => invoke("product:set-status", id, status),
    bulkSetTaxType: (input) => invoke("product:bulk-set-tax-type", input),
    pickImage: () => invoke("product:pick-image"),
    readImagePreview: (relativePath) => invoke("product:read-image-preview", relativePath)
  },
  mainStore: {
    listProducts: (locationId) => invoke("main-store:product-list", locationId),
    allocationSummary: () => invoke("main-store:allocation-summary"),
    listProductRows: () => invoke("main-store:product-rows"),
    getProductDetail: (productId) => invoke("main-store:product-detail", productId),
    receive: (input) => invoke("main-store:receive", input),
    distribute: (input) => invoke("main-store:distribute", input),
    returnStock: (input) => invoke("main-store:return", input),
    reallocate: (input) => invoke("main-store:reallocate", input),
    damage: (input) => invoke("main-store:damage", input),
    adjust: (input) => invoke("main-store:adjust", input)
  },
  inventory: {
    overview: (productId) => invoke("inventory:overview", productId),
    listForLocation: (locationId) => invoke("inventory:list-for-location", locationId)
  },
  stockMovement: {
    list: (productId, input) => invoke("stock-movement:list", productId, input ?? {}),
    listAll: (input) => invoke("stock-movement:list-all", input ?? {}),
    create: (input) => invoke("stock-movement:create", input),
    transfer: (input) => invoke("stock-movement:transfer", input)
  },
  role: {
    list: () => invoke("role:list"),
    listForPicker: () => invoke("role:list-for-picker"),
    get: (id) => invoke("role:get", id),
    create: (input) => invoke("role:create", input),
    update: (id, input) => invoke("role:update", id, input),
    delete: (id) => invoke("role:delete", id)
  },
  employee: {
    list: () => invoke("employee:list"),
    listForSalaryPicker: () => invoke("employee:list-for-salary-picker"),
    get: (id) => invoke("employee:get", id),
    create: (input) => invoke("employee:create", input),
    update: (id, input) => invoke("employee:update", id, input),
    setStatus: (id, status) => invoke("employee:set-status", id, status),
    delete: (id) => invoke("employee:delete", id),
    pickPhoto: () => invoke("employee:pick-photo"),
    readPhotoPreview: (relativePath) => invoke("employee:read-photo-preview", relativePath)
  },
  paymentMethod: {
    list: () => invoke("payment-method:list"),
    get: (id) => invoke("payment-method:get", id),
    create: (input) => invoke("payment-method:create", input),
    update: (id, input) => invoke("payment-method:update", id, input),
    setActive: (id, isActive) => invoke("payment-method:set-active", id, isActive),
    delete: (id) => invoke("payment-method:delete", id)
  },
  workingHours: {
    list: () => invoke("working-hours:list"),
    get: (locationId) => invoke("working-hours:get", locationId),
    upsert: (locationId, input) => invoke("working-hours:upsert", locationId, input),
    setManualLock: (locationId, locked) => invoke("working-hours:set-manual-lock", locationId, locked),
    getMyLockStatus: () => invoke("working-hours:get-my-lock-status")
  },
  customer: {
    list: () => invoke("customer:list"),
    get: (id) => invoke("customer:get", id),
    create: (input) => invoke("customer:create", input),
    update: (id, input) => invoke("customer:update", id, input),
    setStatus: (id, status) => invoke("customer:set-status", id, status)
  },
  supplier: {
    list: () => invoke("supplier:list"),
    get: (id) => invoke("supplier:get", id),
    create: (input) => invoke("supplier:create", input),
    update: (id, input) => invoke("supplier:update", id, input),
    setStatus: (id, status) => invoke("supplier:set-status", id, status)
  },
  rider: {
    list: () => invoke("rider:list"),
    get: (id) => invoke("rider:get", id),
    create: (input) => invoke("rider:create", input),
    update: (id, input) => invoke("rider:update", id, input),
    setStatus: (id, status) => invoke("rider:set-status", id, status)
  },
  purchase: {
    list: () => invoke("purchase:list"),
    summary: () => invoke("purchase:summary"),
    get: (id) => invoke("purchase:get", id),
    create: (input) => invoke("purchase:create", input),
    update: (id, input) => invoke("purchase:update", id, input),
    markOrdered: (id) => invoke("purchase:mark-ordered", id),
    cancel: (id) => invoke("purchase:cancel", id),
    receiveGoods: (id, input) => invoke("purchase:receive-goods", id, input),
    recordPayment: (id, input) => invoke("purchase:record-payment", id, input),
    markPaid: (id, input) => invoke("purchase:mark-paid", id, input),
    pickAttachment: () => invoke("purchase:pick-attachment"),
    openAttachment: (relativePath) => invoke("purchase:open-attachment", relativePath)
  },
  expenseCategory: {
    list: () => invoke("expense-category:list"),
    create: (input) => invoke("expense-category:create", input),
    update: (id, input) => invoke("expense-category:update", id, input),
    setStatus: (id, status) => invoke("expense-category:set-status", id, status)
  },
  expense: {
    list: () => invoke("expense:list"),
    summary: () => invoke("expense:summary"),
    get: (id) => invoke("expense:get", id),
    create: (input) => invoke("expense:create", input),
    update: (id, input) => invoke("expense:update", id, input),
    archive: (id) => invoke("expense:archive", id),
    restore: (id) => invoke("expense:restore", id),
    delete: (id) => invoke("expense:delete", id),
    pickAttachment: () => invoke("expense:pick-attachment"),
    openAttachment: (relativePath) => invoke("expense:open-attachment", relativePath)
  },
  localPurchase: {
    list: () => invoke("local-purchase:list"),
    summary: () => invoke("local-purchase:summary"),
    get: (id) => invoke("local-purchase:get", id),
    create: (input) => invoke("local-purchase:create", input),
    update: (id, input) => invoke("local-purchase:update", id, input),
    archive: (id) => invoke("local-purchase:archive", id),
    restore: (id) => invoke("local-purchase:restore", id),
    delete: (id) => invoke("local-purchase:delete", id),
    pickAttachment: () => invoke("local-purchase:pick-attachment"),
    openAttachment: (relativePath) => invoke("local-purchase:open-attachment", relativePath)
  },
  salary: {
    list: () => invoke("salary:list"),
    get: (id) => invoke("salary:get", id),
    create: (input) => invoke("salary:create", input),
    createAdvance: (input) => invoke("salary:create-advance", input),
    complete: (id, input) => invoke("salary:complete", id, input),
    deleteAdvance: (id) => invoke("salary:delete-advance", id),
    void: (id) => invoke("salary:void", id),
    restore: (id) => invoke("salary:restore", id)
  },
  sale: {
    list: () => invoke("sale:list"),
    listPending: () => invoke("sale:list-pending"),
    get: (id) => invoke("sale:get", id),
    suspend: (input) => invoke("sale:suspend", input),
    deletePending: (id) => invoke("sale:delete-pending", id),
    complete: (input) => invoke("sale:complete", input),
    setIncludeTaxBreakdown: (id, includeTaxBreakdown) => invoke("sale:set-include-tax-breakdown", id, includeTaxBreakdown),
    setIncludeBusinessInfo: (id, includeBusinessInfo) => invoke("sale:set-include-business-info", id, includeBusinessInfo)
  },
  saleVoid: {
    list: () => invoke("sale-void:list"),
    get: (id) => invoke("sale-void:get", id),
    request: (input) => invoke("sale-void:request", input),
    approve: (id, input) => invoke("sale-void:approve", id, input),
    reject: (id, input) => invoke("sale-void:reject", id, input)
  },
  saleReturn: {
    list: () => invoke("sale-return:list"),
    get: (id) => invoke("sale-return:get", id),
    request: (input) => invoke("sale-return:request", input),
    approve: (id, input) => invoke("sale-return:approve", id, input),
    reject: (id, input) => invoke("sale-return:reject", id, input)
  },
  invoice: {
    list: () => invoke("invoice:list"),
    summary: () => invoke("invoice:summary"),
    create: (input) => invoke("invoice:create", input),
    update: (id, input) => invoke("invoice:update", id, input),
    recordPayment: (id, input) => invoke("invoice:record-payment", id, input),
    cancel: (id, input) => invoke("invoice:cancel", id, input),
    markPaid: (id, input) => invoke("invoice:mark-paid", id, input),
    duplicate: (id) => invoke("invoice:duplicate", id)
  },
  invoiceCancellation: {
    list: () => invoke("invoice-cancellation:list"),
    get: (id) => invoke("invoice-cancellation:get", id),
    request: (input) => invoke("invoice-cancellation:request", input),
    approve: (id, input) => invoke("invoice-cancellation:approve", id, input),
    reject: (id, input) => invoke("invoice-cancellation:reject", id, input)
  },
  quotation: {
    list: () => invoke("quotation:list"),
    summary: () => invoke("quotation:summary"),
    get: (id) => invoke("quotation:get", id),
    create: (input) => invoke("quotation:create", input),
    update: (id, input) => invoke("quotation:update", id, input),
    delete: (id) => invoke("quotation:delete", id),
    setStatus: (id, status) => invoke("quotation:set-status", id, status),
    setIncludeTaxBreakdown: (id, includeTaxBreakdown) =>
      invoke("quotation:set-include-tax-breakdown", id, includeTaxBreakdown),
    setIncludeBusinessInfo: (id, includeBusinessInfo) =>
      invoke("quotation:set-include-business-info", id, includeBusinessInfo),
    checkStock: (id) => invoke("quotation:check-stock", id),
    convertToSale: (id, input) => invoke("quotation:convert-to-sale", id, input),
    convertToInvoice: (id, input) => invoke("quotation:convert-to-invoice", id, input)
  },
  printer: {
    getSettings: () => invoke("printer:get-settings"),
    saveSettings: (input) => invoke("printer:save-settings", input),
    testConnection: () => invoke("printer:test-connection"),
    printReceipt: (saleId) => invoke("printer:print-receipt", saleId),
    generateReceiptPdf: (saleId) => invoke("printer:generate-receipt-pdf", saleId),
    previewReceiptPdf: (saleId) => invoke("printer:preview-receipt-pdf", saleId),
    generateInvoicePdf: (saleId) => invoke("printer:generate-invoice-pdf", saleId),
    previewInvoicePdf: (saleId) => invoke("printer:preview-invoice-pdf", saleId),
    printInvoiceDocument: (saleId) => invoke("printer:print-invoice-document", saleId),
    printInvoiceThermal: (saleId) => invoke("printer:print-invoice-thermal", saleId),
    generateQuotationPdf: (quotationId) => invoke("printer:generate-quotation-pdf", quotationId),
    previewQuotationPdf: (quotationId) => invoke("printer:preview-quotation-pdf", quotationId),
    printQuotationDocument: (quotationId) => invoke("printer:print-quotation-document", quotationId),
    printQuotationThermal: (quotationId) => invoke("printer:print-quotation-thermal", quotationId),
    generateSalaryPdf: (salaryId) => invoke("printer:generate-salary-pdf", salaryId),
    previewSalaryPdf: (salaryId) => invoke("printer:preview-salary-pdf", salaryId),
    shareSalaryPayslip: (salaryId) => invoke("printer:share-salary-payslip", salaryId),
    printDeliveryNote: (deliveryNoteId) => invoke("printer:print-delivery-note", deliveryNoteId),
    printDeliveryNoteThermal: (deliveryNoteId) => invoke("printer:print-delivery-note-thermal", deliveryNoteId),
    generateDeliveryNotePdf: (deliveryNoteId) => invoke("printer:generate-delivery-note-pdf", deliveryNoteId),
    previewDeliveryNotePdf: (deliveryNoteId) => invoke("printer:preview-delivery-note-pdf", deliveryNoteId),
    generateStatementPdf: (customerId) => invoke("printer:generate-statement-pdf", customerId),
    previewStatementPdf: (customerId) => invoke("printer:preview-statement-pdf", customerId),
    printStatementDocument: (customerId) => invoke("printer:print-statement-document", customerId),
    generateStockReceiptPdf: (stockReceiptId) => invoke("printer:generate-stock-receipt-pdf", stockReceiptId),
    previewStockReceiptPdf: (stockReceiptId) => invoke("printer:preview-stock-receipt-pdf", stockReceiptId),
    printStockReceiptDocument: (stockReceiptId) => invoke("printer:print-stock-receipt-document", stockReceiptId),
    getPdfPreviewData: (previewId) => invoke("printer:get-pdf-preview-data", previewId),
    printPdfPreview: (previewId) => invoke("printer:print-pdf-preview", previewId),
    downloadPdfPreview: (previewId) => invoke("printer:download-pdf-preview", previewId)
  },
  statement: {
    getForCustomer: (customerId) => invoke("statement:get-for-customer", customerId)
  },
  deliveryNote: {
    get: (id) => invoke("delivery-note:get", id),
    getForSale: (saleId) => invoke("delivery-note:get-for-sale", saleId),
    getForQuotation: (quotationId) => invoke("delivery-note:get-for-quotation", quotationId),
    setDelivered: (id, delivered) => invoke("delivery-note:set-delivered", id, delivered),
    attachToSale: (saleId, input) => invoke("delivery-note:attach-to-sale", saleId, input),
    attachToQuotation: (quotationId, input) => invoke("delivery-note:attach-to-quotation", quotationId, input)
  },
  export: {
    toPdf: (request) => invoke("export:to-pdf", request),
    toCsv: (request) => invoke("export:to-csv", request),
    toExcel: (request) => invoke("export:to-excel", request)
  },
  reportExport: {
    toPdf: (request) => invoke("report-export:to-pdf", request),
    toExcel: (request) => invoke("report-export:to-excel", request)
  },
  stockRequest: {
    list: () => invoke("stock-request:list"),
    get: (id) => invoke("stock-request:get", id),
    create: (input) => invoke("stock-request:create", input),
    approve: (id) => invoke("stock-request:approve", id),
    reject: (id, input) => invoke("stock-request:reject", id, input)
  },
  stockReceipt: {
    list: () => invoke("stock-receipt:list"),
    get: (id) => invoke("stock-receipt:get", id),
    create: (input) => invoke("stock-receipt:create", input)
  },
  recurringBill: {
    list: () => invoke("recurring-bill:list"),
    get: (id) => invoke("recurring-bill:get", id),
    create: (input) => invoke("recurring-bill:create", input),
    update: (id, input) => invoke("recurring-bill:update", id, input),
    setStatus: (id, status) => invoke("recurring-bill:set-status", id, status),
    advance: (id) => invoke("recurring-bill:advance", id),
    markPaid: (id, input) => invoke("recurring-bill:mark-paid", id, input),
    delete: (id) => invoke("recurring-bill:delete", id)
  },
  sync: {
    getSnapshot: () => invoke("sync:get-snapshot"),
    listQueue: (input) => invoke("sync:list-queue", input ?? {}),
    runNow: () => invoke("sync:run-now"),
    retryOrphans: () => invoke("sync:retry-orphans"),
    listConflicts: () => invoke("sync:list-conflicts"),
    resolveConflict: (id, resolution) => invoke("sync:resolve-conflict", id, resolution),
    listReconciliations: () => invoke("sync:list-reconciliations"),
    getEntityOverview: () => invoke("sync:get-entity-overview")
  },
  import: {
    pickFile: (entityType) => invoke("import:pick-file", entityType),
    preview: (request) => invoke("import:preview", request),
    commit: (request) => invoke("import:commit", request)
  },
  share: {
    createLink: (entity, entityId, includePreview) => invoke("share:create-link", entity, entityId, includePreview),
    createDeliveryLink: (entity, entityId, includePreview) =>
      invoke("share:create-delivery-link", entity, entityId, includePreview)
  },
  theme: {
    save: (theme) => invoke("theme:save", theme)
  },
  report: {
    salesFinancialOverview: (range) => invoke("report:sales-financial-overview", range),
    salesTransactions: (range) => invoke("report:sales-transactions", range),
    cancelledPurchases: (range) => invoke("report:cancelled-purchases", range),
    paymentTransactions: (range) => invoke("report:payment-transactions", range),
    mySales: (range) => invoke("report:my-sales", range),
    salesTrendWindow: (input) => invoke("report:sales-trend-window", input),
    salesByStorefront: (range) => invoke("report:sales-by-storefront", range),
    salesByEmployee: (range) => invoke("report:sales-by-employee", range),
    salesByPaymentMethod: (range) => invoke("report:sales-by-payment-method", range),
    inventoryData: (input) => invoke("report:inventory-data", input),
    productsPerformance: (range) => invoke("report:products-performance", range),
    productSalesHistory: (input) => invoke("report:product-sales-history", input),
    topCustomers: (range) => invoke("report:top-customers", range),
    customerPurchaseHistory: (input) => invoke("report:customer-purchase-history", input),
    outstandingInvoices: (input) => invoke("report:outstanding-invoices", input),
    outstandingPurchases: (input) => invoke("report:outstanding-purchases", input),
    supplierPurchaseHistory: (input) => invoke("report:supplier-purchase-history", input),
    supplierSpendBreakdown: (input) => invoke("report:supplier-spend-breakdown", input),
    taxBreakdown: (range) => invoke("report:tax-breakdown", range),
    localSourcing: (range) => invoke("report:local-sourcing", range)
  }
};

contextBridge.exposeInMainWorld("blueLedger", api);
