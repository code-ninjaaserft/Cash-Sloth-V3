import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseConnection } from './connection.js';
import { probeDatabase } from './probe.js';

describe('on-disk Node SQLite and Drizzle integration', () => {
  let directory: string;
  let filePath: string;
  const connections: DatabaseConnection[] = [];

  function connect(): DatabaseConnection {
    const connection = openDatabase(filePath);
    connections.push(connection);
    return connection;
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cash-sloth-sqlite-'));
    filePath = join(directory, 'fixture.sqlite');
  });

  afterEach(() => {
    for (const connection of connections.splice(0)) connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('enforces foreign keys, WAL and durable synchronous writes on every connection', () => {
    const { sqlite } = connect();
    expect(sqlite.prepare('PRAGMA foreign_keys').get()?.['foreign_keys']).toBe(1);
    expect(sqlite.prepare('PRAGMA journal_mode').get()?.['journal_mode']).toBe('wal');
    expect(sqlite.prepare('PRAGMA synchronous').get()?.['synchronous']).toBe(2);
    expect(sqlite.prepare('PRAGMA busy_timeout').get()?.['timeout']).toBe(5000);
    expect(sqlite.prepare('PRAGMA trusted_schema').get()?.['trusted_schema']).toBe(0);
  });

  it('commits a Drizzle transaction and reads its durable result after reopening', () => {
    const first = connect();
    first.db.run(sql`CREATE TABLE fixture (id INTEGER PRIMARY KEY, label TEXT NOT NULL)`);
    first.db.transaction((transaction) => {
      transaction.run(sql`INSERT INTO fixture (id, label) VALUES (${1}, ${'saved'})`);
    });
    first.close();

    const second = connect();
    expect(second.db.get(sql`SELECT id, label FROM fixture WHERE id = ${1}`)).toEqual({
      id: 1,
      label: 'saved',
    });
  });

  it('rolls back all Drizzle writes when a transaction callback fails', () => {
    const { db } = connect();
    db.run(sql`CREATE TABLE fixture (id INTEGER PRIMARY KEY)`);
    const failure = new Error('abort fixture transaction');
    expect(() => db.transaction((transaction) => {
      transaction.run(sql`INSERT INTO fixture (id) VALUES (${1})`);
      transaction.run(sql`INSERT INTO fixture (id) VALUES (${2})`);
      throw failure;
    })).toThrow(failure);
    expect(db.get(sql`SELECT COUNT(*) AS count FROM fixture`)).toEqual({ count: 0 });
    db.transaction((transaction) => {
      transaction.run(sql`INSERT INTO fixture (id) VALUES (${3})`);
    });
    expect(db.get(sql`SELECT id FROM fixture`)).toEqual({ id: 3 });
  });

  it('rejects orphan records and rolls back earlier writes in that transaction', () => {
    const { sqlite, db } = connect();
    sqlite.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id));
    `);
    expect(() => db.transaction((transaction) => {
      transaction.run(sql`INSERT INTO parent (id) VALUES (${1})`);
      transaction.run(sql`INSERT INTO child (id, parent_id) VALUES (${1}, ${999})`);
    })).toThrow();
    expect(db.get(sql`SELECT COUNT(*) AS count FROM parent`)).toEqual({ count: 0 });
    expect(db.get(sql`SELECT COUNT(*) AS count FROM child`)).toEqual({ count: 0 });
  });

  it('binds untrusted values without interpreting their SQL-looking contents', () => {
    const { db } = connect();
    db.run(sql`CREATE TABLE fixture (id INTEGER PRIMARY KEY, label TEXT NOT NULL)`);
    const label = "Robert'); DROP TABLE fixture; --";
    db.run(sql`INSERT INTO fixture (id, label) VALUES (${1}, ${label})`);
    expect(db.get(sql`SELECT label FROM fixture WHERE id = ${1}`)).toEqual({ label });
    expect(db.get(sql`SELECT COUNT(*) AS count FROM fixture`)).toEqual({ count: 1 });
  });

  it('fails explicitly rather than silently using non-WAL in-memory storage', () => {
    expect(() => openDatabase(':memory:')).toThrow('SQLite WAL mode is required');
  });

  it('runs the same compatibility probe used by the Electron main-process smoke', () => {
    const report = probeDatabase(filePath);
    expect(report.sqliteVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.checks).toEqual({
      commit: true,
      rollback: true,
      foreignKeys: true,
      wal: true,
      reopen: true,
      drizzleBinding: true,
      drizzleTransaction: true,
      drizzleRollback: true,
    });
  });

  it('refuses to probe an existing file and leaves its contents unchanged', () => {
    const contents = 'caller-owned existing data';
    writeFileSync(filePath, contents);
    expect(() => probeDatabase(filePath)).toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(contents);
  });
});
