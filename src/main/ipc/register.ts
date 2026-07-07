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
  createEmployee,
  deleteEmployee,
  getEmployee,
  listEmployees,
  setEmployeeStatus,
  updateEmployee
} from "@main/services/employee-service";
import {
  pickAndStoreProductImage,
  readLocalImagePreview,
  readManagedProductImagePreview
} from "@main/services/image-service";
import {
  getInventoryOverview,
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
  createProduct,
  getProduct,
  listProducts,
  setProductStatus,
  updateProduct
} from "@main/services/product-service";
import { createRole, deleteRole, getRole, listRoles, updateRole } from "@main/services/role-service";
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
import type { EmployeeStatus } from "@shared/types/employee";
import type { LocationStatus } from "@shared/types/location";
import type { ProductStatus } from "@shared/types/product";
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
    readLocalImagePreview(path)
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
  ipcMain.handle(ipcChannels.syncGetSnapshot, () => getSyncSnapshot());
  ipcMain.handle(ipcChannels.syncListQueue, (_event, input?: { limit?: number }) =>
    listSyncQueue(input?.limit)
  );
  ipcMain.handle(ipcChannels.themeSave, (_event, theme: unknown) =>
    saveTheme(brandThemeSchema.parse(theme))
  );
}
