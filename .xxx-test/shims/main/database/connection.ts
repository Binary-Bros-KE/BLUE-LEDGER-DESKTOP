import { DatabaseSync } from "node:sqlite";

let database: DatabaseSync | null = null;

export function getDatabasePath(): string {
  const p = process.env.HARNESS_DB_PATH;
  if (!p) throw new Error("HARNESS_DB_PATH env var not set");
  return p;
}

export function getDatabase(): DatabaseSync {
  if (database) return database;
  const dbPath = getDatabasePath();
  database = new DatabaseSync(dbPath, {
    enableForeignKeyConstraints: true,
    timeout: 5000
  });
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");
  return database;
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
