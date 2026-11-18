import { closeSync, openSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { openDatabase } from './connection.js';

export interface DatabaseProbeReport {
  readonly sqliteVersion: string;
  readonly checks: {
    readonly commit: true;
    readonly rollback: true;
    readonly foreignKeys: true;
    readonly wal: true;
    readonly reopen: true;
    readonly drizzleBinding: true;
    readonly drizzleTransaction: true;
    readonly drizzleRollback: true;
  };
}

const fixture = sqliteTable('foundation_probe_parent', {
  id: integer('id').primaryKey(),
  label: text('label').notNull(),
});

function requireCheck(condition: boolean, name: string): void {
  if (!condition) throw new Error(`SQLite compatibility check failed: ${name}`);
}

/**
 * Destructive fixtures belong only in a fresh caller-owned temporary file.
 * Exclusive file creation prevents this probe from opening an existing database.
 * The caller removes its temporary directory after the probe completes.
 */
export function probeDatabase(filePath: string): DatabaseProbeReport {
  closeSync(openSync(filePath, 'wx'));
  const connection = openDatabase(filePath);
  let sqliteVersion: string;
  try {
    const { sqlite, db } = connection;
    const version = sqlite.prepare('SELECT sqlite_version() AS version').get()?.['version'];
    if (typeof version !== 'string') throw new Error('Invalid SQLite version response');
    sqliteVersion = version;
    requireCheck(sqlite.prepare('PRAGMA journal_mode').get()?.['journal_mode'] === 'wal', 'WAL');
    sqlite.exec(`
      CREATE TABLE foundation_probe_parent (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
      CREATE TABLE foundation_probe_child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES foundation_probe_parent(id)
      );
      BEGIN IMMEDIATE;
      INSERT INTO foundation_probe_parent VALUES (1, 'committed');
      COMMIT;
      BEGIN IMMEDIATE;
      INSERT INTO foundation_probe_parent VALUES (2, 'rolled back');
      ROLLBACK;
    `);
    requireCheck(sqlite.prepare('SELECT label FROM foundation_probe_parent WHERE id = 1').get()?.['label'] === 'committed', 'commit');
    requireCheck(sqlite.prepare('SELECT id FROM foundation_probe_parent WHERE id = 2').get() === undefined, 'rollback');

    let rejectedForeignKey = false;
    try {
      sqlite.prepare('INSERT INTO foundation_probe_child VALUES (?, ?)').run(1, 999);
    } catch {
      rejectedForeignKey = true;
    }
    requireCheck(rejectedForeignKey, 'foreign keys');
    sqlite.prepare('INSERT INTO foundation_probe_child VALUES (?, ?)').run(2, 1);

    const boundLabel = "literal '; DROP TABLE foundation_probe_parent; --";
    db.insert(fixture).values({ id: 3, label: boundLabel }).run();
    requireCheck(db.select().from(fixture).where(sql`${fixture.id} = ${3}`).get()?.label === boundLabel, 'Drizzle parameter binding');

    db.transaction((transaction) => {
      transaction.insert(fixture).values({ id: 4, label: 'drizzle commit' }).run();
    });
    requireCheck(db.select().from(fixture).where(sql`${fixture.id} = ${4}`).get()?.label === 'drizzle commit', 'Drizzle commit');

    const rollbackSignal = new Error('intentional compatibility rollback');
    let rolledBack = false;
    try {
      db.transaction((transaction) => {
        transaction.insert(fixture).values({ id: 5, label: 'drizzle rollback' }).run();
        throw rollbackSignal;
      });
    } catch (error) {
      if (error !== rollbackSignal) throw error;
      rolledBack = true;
    }
    requireCheck(rolledBack && db.select().from(fixture).where(sql`${fixture.id} = ${5}`).get() === undefined, 'Drizzle rollback');
  } finally {
    connection.close();
  }

  const reopened = openDatabase(filePath);
  try {
    requireCheck(reopened.sqlite.prepare('SELECT COUNT(*) AS count FROM foundation_probe_parent').get()?.['count'] === 3, 'reopen');
    requireCheck(reopened.sqlite.prepare('SELECT COUNT(*) AS count FROM foundation_probe_child').get()?.['count'] === 1, 'foreign key persisted');
  } finally {
    reopened.close();
  }

  return {
    sqliteVersion,
    checks: {
      commit: true,
      rollback: true,
      foreignKeys: true,
      wal: true,
      reopen: true,
      drizzleBinding: true,
      drizzleTransaction: true,
      drizzleRollback: true,
    },
  };
}
