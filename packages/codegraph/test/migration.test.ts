import { join } from 'node:path';
import { SqliteDatabase } from '@graphit/storage';
import { describe, expect, it } from 'vitest';
import { migrate, migrations } from '@graphit/storage';
import { fixture, temporary, track } from '../../indexer/test/helpers.js';

describe('P1 to P2 migration', () => {
  it('preserves P0/P1 event rows, triggers, root page, memory projections and migration checksums', async () => {
    const f = await fixture(); const source = f.store.readEvents(f.id)[0]!;
    f.memory.promoteMemory(f.id, { entityType: 'goal', content: 'Preserve P1', sourceEventIds: [source.id] });
    const original = track(new SqliteDatabase(f.path));
    const legacy = track(new SqliteDatabase(join(temporary(), 'legacy.db')));
    legacy.exec('PRAGMA journal_mode = WAL'); migrate(legacy, migrations.slice(0, 2));
    const tables = ['events', 'projects', 'sessions', 'checkpoints', 'memory_entities', 'memory_relations'];
    for (const table of tables) for (const row of original.prepare(`SELECT * FROM ${table}`).all()) {
      const columns = Object.keys(row);
      legacy.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
    }
    const rows = () => tables.map((table) => legacy.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all());
    const before = rows(); const ledger = legacy.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    const rootpage = legacy.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'events'").get();
    const triggers = legacy.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'events' ORDER BY name").all();
    migrate(legacy);
    expect(rows()).toEqual(before);
    expect(legacy.prepare('SELECT * FROM schema_migrations WHERE version < 3 ORDER BY version').all()).toEqual(ledger);
    expect(legacy.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'events'").get()).toEqual(rootpage);
    expect(legacy.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'events' ORDER BY name").all()).toEqual(triggers);
    expect(legacy.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
    expect(legacy.prepare('PRAGMA writable_schema').get()!.writable_schema).toBe(0);
    expect(() => legacy.exec('DELETE FROM events')).toThrow('immutable');
  });

  it('rolls back schema edits and new tables if migration 3 fails', () => {
    const db = track(new SqliteDatabase(join(temporary(), 'rollback.db'))); migrate(db, migrations.slice(0, 2));
    const before = db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'events'").get();
    expect(() => migrate(db, [...migrations.slice(0, 2), { ...migrations[2]!, sql: migrations[2]!.sql + '\nINSERT INTO missing_table VALUES (1);' }])).toThrow();
    expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'events'").get()).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'source_blobs'").get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()!.n).toBe(2);
    expect(db.prepare('PRAGMA writable_schema').get()!.writable_schema).toBe(0);
    migrate(db); expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
  });
});
