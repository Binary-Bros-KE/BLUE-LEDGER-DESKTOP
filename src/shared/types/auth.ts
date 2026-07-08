import type { LogoRatio } from "./logo";
import type { PermissionsMap } from "./role";

export type AuthEmployeeSummary = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  photoPath: string | null;
};

export type AuthRoleSummary = {
  id: string;
  roleName: string;
} | null;

export type AuthBranchSummary = {
  id: string;
  locationName: string;
  logoPath: string | null;
  logoRatio: LogoRatio | null;
} | null;

/** The authenticated session held in the main process and mirrored into the renderer. */
export type AuthSession = {
  tenantId: string;
  employee: AuthEmployeeSummary;
  role: AuthRoleSummary;
  branch: AuthBranchSummary;
  permissions: PermissionsMap;
};
