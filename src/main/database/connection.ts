import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import electron from "electron";

const { app } = electron;

let database: DatabaseSync | null = null;

export function getDatabasePath(): string {
  return join(app.getPath("userData"), "data", "blue-ledger.sqlite");
}

export function getDatabase(): DatabaseSync {
  if (database) {
    return database;
  }

  const dbPath = getDatabasePath();
  mkdirSync(dirname(dbPath), { recursive: true });

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
