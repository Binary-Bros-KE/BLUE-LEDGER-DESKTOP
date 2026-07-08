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
  category: {
    list: () => invoke("category:list"),
    get: (id) => invoke("category:get", id),
    create: (input) => invoke("category:create", input),
    update: (id, input) => invoke("category:update", id, input),
    setStatus: (id, status) => invoke("category:set-status", id, status),
    delete: (id) => invoke("category:delete", id)
  },
  product: {
    list: () => invoke("product:list"),
    get: (id) => invoke("product:get", id),
    create: (input) => invoke("product:create", input),
    update: (id, input) => invoke("product:update", id, input),
    setStatus: (id, status) => invoke("product:set-status", id, status),
    pickImage: () => invoke("product:pick-image"),
    readImagePreview: (relativePath) => invoke("product:read-image-preview", relativePath)
  },
  inventory: {
    overview: (productId) => invoke("inventory:overview", productId),
    listForLocation: (locationId) => invoke("inventory:list-for-location", locationId)
  },
  stockMovement: {
    list: (productId, input) => invoke("stock-movement:list", productId, input ?? {}),
    create: (input) => invoke("stock-movement:create", input),
    transfer: (input) => invoke("stock-movement:transfer", input)
  },
  role: {
    list: () => invoke("role:list"),
    get: (id) => invoke("role:get", id),
    create: (input) => invoke("role:create", input),
    update: (id, input) => invoke("role:update", id, input),
    delete: (id) => invoke("role:delete", id)
  },
  employee: {
    list: () => invoke("employee:list"),
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
  customer: {
    list: () => invoke("customer:list"),
    get: (id) => invoke("customer:get", id),
    create: (input) => invoke("customer:create", input),
    update: (id, input) => invoke("customer:update", id, input),
    setStatus: (id, status) => invoke("customer:set-status", id, status)
  },
  sale: {
    list: () => invoke("sale:list"),
    listPending: () => invoke("sale:list-pending"),
    get: (id) => invoke("sale:get", id),
    suspend: (input) => invoke("sale:suspend", input),
    deletePending: (id) => invoke("sale:delete-pending", id),
    complete: (input) => invoke("sale:complete", input)
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
    recordPayment: (id, input) => invoke("invoice:record-payment", id, input),
    cancel: (id) => invoke("invoice:cancel", id),
    markPaid: (id, input) => invoke("invoice:mark-paid", id, input),
    duplicate: (id) => invoke("invoice:duplicate", id)
  },
  quotation: {
    list: () => invoke("quotation:list"),
    summary: () => invoke("quotation:summary"),
    get: (id) => invoke("quotation:get", id),
    create: (input) => invoke("quotation:create", input),
    update: (id, input) => invoke("quotation:update", id, input),
    delete: (id) => invoke("quotation:delete", id),
    setStatus: (id, status) => invoke("quotation:set-status", id, status),
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
    generateInvoicePdf: (saleId) => invoke("printer:generate-invoice-pdf", saleId),
    printInvoiceDocument: (saleId) => invoke("printer:print-invoice-document", saleId),
    generateQuotationPdf: (quotationId) => invoke("printer:generate-quotation-pdf", quotationId),
    printQuotationDocument: (quotationId) => invoke("printer:print-quotation-document", quotationId)
  },
  sync: {
    getSnapshot: () => invoke("sync:get-snapshot"),
    listQueue: (input) => invoke("sync:list-queue", input ?? {})
  },
  theme: {
    save: (theme) => invoke("theme:save", theme)
  }
};

contextBridge.exposeInMainWorld("blueLedger", api);
