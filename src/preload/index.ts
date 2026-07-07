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
    setStatus: (id, status) => invoke("location:set-status", id, status)
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
    overview: (productId) => invoke("inventory:overview", productId)
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
    delete: (id) => invoke("employee:delete", id)
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
