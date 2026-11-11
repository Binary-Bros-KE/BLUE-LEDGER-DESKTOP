// Stand-in for src/main/database/connection.ts: the same API on an in-memory database, so tests run
// the app's real migrations and repositories without Electron or a file on disk.
import { DatabaseSync } from "node:sqlite";

let database: DatabaseSync | null = null;

export function getDatabasePath(): string {
  return ":memory:";
}

export function getDatabase(): DatabaseSync {
  if (!database) {
    database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
    database.exec("PRAGMA foreign_keys = ON;");
  }
  return database;
}

/** A brand new empty database for the next test file. */
export function resetTestDatabase(): void {
  database?.close();
  database = null;
}

export function runInTransaction<T>(callback: () => T): T {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = callback();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}
