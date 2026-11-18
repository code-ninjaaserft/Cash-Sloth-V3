import { DatabaseSync } from 'node:sqlite';
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';

export interface DatabaseConnection {
  readonly sqlite: DatabaseSync;
  readonly db: NodeSQLiteDatabase;
  close(): void;
}

/** Open a host-owned database. Callers create and select the environment directory. */
export function openDatabase(path: string): DatabaseConnection {
  const sqlite = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    allowExtension: false,
  });

  try {
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      PRAGMA trusted_schema = OFF;
    `);
    if (sqlite.prepare('PRAGMA foreign_keys').get()?.['foreign_keys'] !== 1) {
      throw new Error('SQLite foreign-key enforcement is unavailable');
    }
    if (sqlite.prepare('PRAGMA journal_mode').get()?.['journal_mode'] !== 'wal') {
      throw new Error('SQLite WAL mode is required; use an on-disk database');
    }

    const db = drizzle({ client: sqlite, logger: false, paramsInErrors: false });
    let closed = false;
    return {
      sqlite,
      db,
      close() {
        if (!closed) {
          sqlite.close();
          closed = true;
        }
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

