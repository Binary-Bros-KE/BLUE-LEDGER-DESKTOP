/** Mirrors main/services/update-service.ts's own state shape — polled by the renderer, same
 * pattern as shared/types/sync.ts's SyncSnapshot. */
export type UpdateStatus = "idle" | "checking" | "downloading" | "downloaded" | "not-available" | "error";

export type UpdateStatusResult = {
  status: UpdateStatus;
  version: string | null;
  error: string | null;
  currentVersion: string;
};
