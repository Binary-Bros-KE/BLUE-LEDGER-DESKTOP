import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { PERMISSION_ACTIONS } from "@shared/types/role";

const permissionActionSchema = z.enum(PERMISSION_ACTIONS);

/** Loosely-typed here — role-service.ts sanitizes this against PERMISSION_MODULES before persisting. */
export const permissionsInputSchema = z.record(z.string(), z.array(permissionActionSchema)).default({});

export const roleInputSchema = z.object({
  roleName: z.string().trim().min(1, "Role name is required").max(100),
  description: optionalText(500),
  permissions: permissionsInputSchema
});

export type RoleInput = z.infer<typeof roleInputSchema>;
