import type { BlueLedgerApi } from "@shared/types/ipc";

declare global {
  interface Window {
    blueLedger: BlueLedgerApi;
  }
}

export {};
