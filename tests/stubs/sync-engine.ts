// Stand-in for src/main/services/sync-engine.ts: the one call the approval services make before deciding
// (asking the cloud whether another device already decided). Tests run offline, so nothing has.
export async function assertNotAlreadyDecidedRemotely(_entity: string, _id: string, _expectedStatus: string): Promise<void> {}
