import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SqliteDatabase } from '@graphit/storage';
import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash, createEvent, reconstructState } from '@graphit/core';
import { EventStore, migrate, migrations } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { temporary, track } from './helpers.js';

describe('P0 → P1 migration preservation', () => {
  it('keeps original event rows, rowids, root page, triggers and P0 checkpoint hashes intact', () => {
    const root = temporary();
    const path = join(root, 'legacy.db');
    const database = track(new SqliteDatabase(path));
    database.exec('PRAGMA journal_mode = WAL');
    migrate(database, migrations.slice(0, 1));
    const project_id = randomUUID();
    const session_id = randomUUID();
    const created_at = '2026-09-26T00:00:00.000Z';
    const envelope = { project_id, session_id, created_at };
    const project = createEvent({ ...envelope, sequence: 1, event_type: 'project.created', payload: { name: 'Legacy', root_path: root } });
    const session = createEvent({ ...envelope, sequence: 2, event_type: 'session.started', payload: {} });
    const checkpointState = reconstructState([project, session]);
    expect(Object.keys(checkpointState.sessions[0]!).sort()).toEqual(['created_at', 'id', 'project_id', 'resumed_from_checkpoint_id']);
    const checkpoint = createEvent({ ...envelope, sequence: 3, event_type: 'checkpoint.created',
      payload: { name: 'P0', through_sequence: 2, state_hash: contentHash(checkpointState) } });
    const insert = database.prepare(`INSERT INTO events (id, project_id, session_id, sequence, event_type, payload, created_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const event of [project, session, checkpoint]) insert.run(event.id, event.project_id, event.session_id, event.sequence,
      event.event_type, canonicalJson(event.payload), event.created_at, event.content_hash);
    const before = database.prepare('SELECT rowid, * FROM events ORDER BY sequence').all();
    const rootpage = database.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'events'").get();
    const triggers = database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'events' ORDER BY name").all();
    const ledger = database.prepare('SELECT * FROM schema_migrations WHERE version = 1').get();
    const store = track(new EventStore(path));
    const memory = new MemoryService(store);
    expect(database.prepare('SELECT rowid, * FROM events ORDER BY sequence').all()).toEqual(before);
    expect(database.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'events'").get()).toEqual(rootpage);
    expect(database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'events' ORDER BY name").all()).toEqual(triggers);
    expect(database.prepare('SELECT * FROM schema_migrations WHERE version = 1').get()).toEqual(ledger);
    expect(database.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
    expect(database.prepare('PRAGMA writable_schema').get()?.writable_schema).toBe(0);
    store.rebuildProjections();
    expect(store.resume(project_id).checkpoint_state).toEqual(checkpointState);
    const source = store.appendEvent({ project_id, session_id: store.getState(project_id).active_session_id!,
      event_type: 'conversation.user_message', payload: { content: 'Now P1' } });
    memory.promoteMemory(project_id, { entityType: 'goal', content: 'Keep history', sourceEventIds: [source.id] });
    expect(database.prepare('SELECT rowid, * FROM events WHERE sequence <= 3 ORDER BY sequence').all()).toEqual(before);
    expect(() => database.exec('DELETE FROM events')).toThrow('immutable');
    expect(() => database.exec("UPDATE events SET payload = '{}' ")).toThrow('immutable');
  });

  it('rolls back schema edits if a later step of migration 2 fails', () => {
    const database = track(new SqliteDatabase(join(temporary(), 'rollback.db')));
    migrate(database, migrations.slice(0, 1));
    const before = database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'events'").get();
    const bad = { ...migrations[1]!, sql: `${migrations[1]!.sql}\nINSERT INTO nonexistent_table VALUES (1);` };
    expect(() => migrate(database, [migrations[0]!, bad])).toThrow();
    expect(database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'events'").get()).toEqual(before);
    expect(database.prepare('PRAGMA writable_schema').get()?.writable_schema).toBe(0);
    expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()?.count).toBe(1);
    migrate(database);
    expect(database.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
  });
});
