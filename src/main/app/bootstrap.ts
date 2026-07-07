import electron from "electron";
import { migrateDatabase } from "@main/database/migrate";
import { registerIpcHandlers } from "@main/ipc/register";
import { ensureDefaultSystemEmployee } from "@main/services/employee-service";
import { ensureDefaultPaymentMethods } from "@main/services/payment-method-service";
import { ensureDefaultRoles } from "@main/services/role-service";
import { ensureTenantContext } from "@main/services/tenant-service";
import { createMainWindow } from "@main/windows/main-window";

const { app } = electron;

export async function bootstrap(): Promise<void> {
  await app.whenReady();

  app.setAppUserModelId("com.blueledger.desktop");

  migrateDatabase();
  const tenant = ensureTenantContext();
  ensureDefaultRoles(tenant.tenantId);
  ensureDefaultSystemEmployee(tenant.tenantId);
  ensureDefaultPaymentMethods(tenant.tenantId);
  registerIpcHandlers();

  await createMainWindow();

  app.on("activate", async () => {
    if (process.platform === "darwin") {
      await createMainWindow();
    }
  });
}
