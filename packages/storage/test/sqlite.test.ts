import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { EventStore, SqliteDatabase } from '@graphit/storage';

const directories: string[] = [];
const handles: { close(): void }[] = [];
function track<T extends { close(): void }>(value: T): T { handles.push(value); return value; }
function path(): string {
  const directory = mkdtempSync(join(tmpdir(), 'graphit-native-'));
  directories.push(directory);
  return join(directory, 'graphit.db');
}
afterEach(() => {
  for (const handle of handles.splice(0).reverse()) handle.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('production SQLite driver compatibility', () => {
  it('opens a real P5 database without changing its ledger, schema, events, blobs or existing FTS index', () => {
    const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-p5.json', import.meta.url), 'utf8')) as {
      project_id: string; events: unknown[]; blob_hash: string; database_gzip_base64: string;
    };
    const file = path();
    writeFileSync(file, gunzipSync(Buffer.from(legacy.database_gzip_base64, 'base64')));
    const db = track(new SqliteDatabase(file));
    const ledger = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    const schema = db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all();
    const source = db.prepare('SELECT * FROM events ORDER BY sequence').all();
    const store = track(new EventStore(file));
    expect(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).toEqual(ledger);
    expect(db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all()).toEqual(schema);
    expect(db.prepare('SELECT * FROM events ORDER BY sequence').all()).toEqual(source);
    expect(store.readEvents(legacy.project_id)).toEqual(legacy.events);
    expect(Array.from(store.readSourceBlob(legacy.blob_hash).content)).toEqual([0, 255, 128, 65, 10]);
    expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    const hits = store.withProjectTransaction(legacy.project_id, tx => tx.search('memory', ['SQLite'], 10));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.id).toBe('fixture-memory');
    expect(hits[0]!.score).toBeLessThan(0);
    const state = store.getState(legacy.project_id);
    db.exec('DELETE FROM checkpoints; DELETE FROM sessions; DELETE FROM projects;');
    store.rebuildProjections();
    expect(store.getState(legacy.project_id)).toEqual(state);
    expect(db.prepare('SELECT * FROM events ORDER BY sequence').all()).toEqual(source);
    store.checkpoint(legacy.project_id, 'native-continuation');
    expect(store.readEvents(legacy.project_id).slice(0, legacy.events.length)).toEqual(legacy.events);
    expect(store.getState(legacy.project_id).last_sequence).toBe(legacy.events.length + 1);
  });

  it('enables FTS5, preserves BM25 order and rolls back FTS writes with savepoints', () => {
    const db = track(new SqliteDatabase(path()));
    expect(db.prepare('PRAGMA compile_options').all().map(row => row.compile_options)).toContain('ENABLE_FTS5');
    db.exec("CREATE VIRTUAL TABLE probe USING fts5(content); INSERT INTO probe VALUES ('sqlite sqlite sqlite'), ('sqlite other words here'), ('unrelated');");
    const query = () => db.prepare("SELECT rowid, bm25(probe) AS score FROM probe WHERE probe MATCH 'sqlite' ORDER BY score, rowid").all();
    const before = query();
    expect(before.map(row => row.rowid)).toEqual([1, 2]);
    expect(before.every(row => typeof row.score === 'number' && row.score < 0)).toBe(true);
    db.exec("BEGIN IMMEDIATE; SAVEPOINT inner_write; INSERT INTO probe VALUES ('sqlite'); ROLLBACK TO inner_write; RELEASE inner_write; COMMIT;");
    expect(query()).toEqual(before);
    db.exec("BEGIN IMMEDIATE; DELETE FROM probe; ROLLBACK;");
    expect(query()).toEqual(before);
  });

  it('rolls back source blobs, events and search projections together on an outer failure', () => {
    const file = path();
    const store = track(new EventStore(file));
    const id = store.initializeProject('/native-test', 'native').project!.id;
    const events = store.readEvents(id);
    const db = track(new SqliteDatabase(file));
    expect(() => store.withProjectTransaction(id, tx => {
      tx.putSourceBlob(Uint8Array.from([0, 128, 255]));
      store.checkpoint(id);
      tx.ensureSearch({ memory: [{ id: 'rollback', content: 'sqlite', entity_type: 'goal', status: 'active' }], code: [] });
      throw new Error('abort outer transaction');
    })).toThrow('abort outer');
    expect(store.readEvents(id)).toEqual(events);
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_blobs').get()?.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM retrieval_memory_fts').get()?.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM checkpoints').get()?.n).toBe(0);
    store.checkpoint(id, 'after-rollback');
    expect(store.getState(id).last_sequence).toBe(events.length + 1);
  });

  it('keeps readonly connections non-mutating and fails closed on unsafe integer results', () => {
    const file = path();
    const db = track(new SqliteDatabase(file));
    db.exec('CREATE TABLE probe (id INTEGER); INSERT INTO probe VALUES (1);');
    const reader = track(new SqliteDatabase(file, { readonly: true }));
    expect(reader.prepare('SELECT id FROM probe').get()?.id).toBe(1);
    expect(() => reader.exec('DELETE FROM probe')).toThrow(/readonly/i);
    expect(() => db.prepare('SELECT 9223372036854775807 AS value').get()).toThrow('safe JavaScript range');
    expect(db.prepare('SELECT ? AS bytes').get(Uint8Array.from([0, 255]))?.bytes).toEqual(Buffer.from([0, 255]));
  });

  it('restores defensive mode after both successful and failed historical schema edits', () => {
    const db = track(new SqliteDatabase(path()));
    const blocked = () => {
      try {
        expect(() => db.exec("PRAGMA writable_schema = ON; UPDATE sqlite_schema SET sql = sql WHERE name = 'probe';")).toThrow(/may not be modified/);
      } finally { db.exec('PRAGMA writable_schema = RESET'); }
    };
    expect(() => db.applySchemaMigration('', () => {})).toThrow('requires a transaction');
    db.exec('CREATE TABLE probe (id INTEGER); BEGIN IMMEDIATE;');
    db.applySchemaMigration("PRAGMA writable_schema = ON; UPDATE sqlite_schema SET sql = sql WHERE name = 'probe';", () => {});
    blocked();
    expect(() => db.applySchemaMigration('PRAGMA writable_schema = ON;', () => { throw new Error('validation failed'); })).toThrow('validation failed');
    blocked();
    db.exec('ROLLBACK;');
    expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
  });

  it('keeps writer connection durability and foreign-key enforcement enabled', () => {
    const store = track(new EventStore(path()));
    const id = store.initializeProject('/pragmas-test', 'pragmas').project!.id;
    store.registerProjection({
      name: 'driver-pragmas', eventTypes: [],
      rebuild: () => {},
      read(db) {
        expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
        expect(db.prepare('PRAGMA recursive_triggers').get()?.recursive_triggers).toBe(1);
        expect(db.prepare('PRAGMA synchronous').get()?.synchronous).toBe(2);
        expect(db.prepare('PRAGMA busy_timeout').get()?.timeout).toBe(5000);
        expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
        db.exec('CREATE TEMP TABLE parent (id INTEGER PRIMARY KEY); CREATE TEMP TABLE child (parent_id INTEGER REFERENCES parent(id));');
        expect(() => db.exec('INSERT INTO child VALUES (404)')).toThrow(/FOREIGN KEY/);
        return true;
      },
    });
    expect(store.withProjectTransaction(id, tx => tx.readProjection('driver-pragmas'))).toBe(true);
  });
});
