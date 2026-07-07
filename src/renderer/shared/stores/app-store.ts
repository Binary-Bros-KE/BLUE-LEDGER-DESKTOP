import { create } from "zustand";
import type { AppContext } from "@shared/types/tenant";
import type { SyncSnapshot } from "@shared/types/sync";

type AppStore = {
  context: AppContext | null;
  sync: SyncSnapshot | null;
  hydrate: () => Promise<void>;
};

export const useAppStore = create<AppStore>((set) => ({
  context: null,
  sync: null,
  hydrate: async () => {
    const [context, sync] = await Promise.all([
      window.blueLedger.app.getContext(),
      window.blueLedger.sync.getSnapshot()
    ]);

    set({ context, sync });
  }
}));
