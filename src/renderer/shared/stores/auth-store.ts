import { create } from "zustand";
import type { AuthSession } from "@shared/types/auth";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthStore = {
  session: AuthSession | null;
  status: AuthStatus;
  error: string | null;
  hydrate: () => Promise<void>;
  login: (employeeCode: string, pin: string) => Promise<boolean>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthStore>((set) => ({
  session: null,
  status: "loading",
  error: null,
  hydrate: async () => {
    try {
      const session = await window.blueLedger.auth.getSession();
      set({ session, status: session ? "authenticated" : "unauthenticated" });
    } catch {
      set({ session: null, status: "unauthenticated" });
    }
  },
  login: async (employeeCode, pin) => {
    set({ error: null });
    try {
      const session = await window.blueLedger.auth.login({ employeeCode, pin });
      set({ session, status: "authenticated" });
      return true;
    } catch (err) {
      set({
        session: null,
        status: "unauthenticated",
        error: err instanceof Error ? err.message : "Failed to sign in"
      });
      return false;
    }
  },
  logout: async () => {
    await window.blueLedger.auth.logout();
    set({ session: null, status: "unauthenticated", error: null });
  }
}));
