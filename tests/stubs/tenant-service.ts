// Stand-in for src/main/services/tenant-service.ts: the one tenant row the test inserted.
import { getDatabase } from "./connection.ts";

export function getCurrentTenant(): { tenantId: string; businessName: string } {
  const row = getDatabase().prepare("SELECT id, business_name FROM tenant LIMIT 1").get() as { id: string; business_name: string } | undefined;
  if (!row) throw new Error("Tenant has not been initialized yet");
  return { tenantId: row.id, businessName: row.business_name };
}
