import { useMemo } from "react";
import { useAuthStore } from "@renderer/shared/stores/auth-store";
import type { AuthSession } from "@shared/types/auth";
import type { PermissionAction, PermissionModuleKey } from "@shared/types/role";

export type PermissionsApi = {
  session: AuthSession | null;
  can: (module: PermissionModuleKey, action: PermissionAction) => boolean;
};

/** Reactive permission checks derived from the current session — re-renders when it changes. */
export function usePermissions(): PermissionsApi {
  const session = useAuthStore((state) => state.session);

  return useMemo(
    () => ({
      session,
      can: (module: PermissionModuleKey, action: PermissionAction) =>
        Boolean(session?.permissions[module]?.includes(action))
    }),
    [session]
  );
}
