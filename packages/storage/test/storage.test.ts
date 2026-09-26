import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase } from '@graphit/storage';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { contentHash, reconstructState, type AppendEventInput } from '@graphit/core';
import { EventStore, migrate, migrations } from '@graphit/storage';

const exec = promisify(execFile);
const directories: string[] = [];
const handles = new Set<{ close(): void }>();

function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'graphit-test-'));
  directories.push(directory);
  return directory;
}

function track<T extends { close(): void }>(handle: T): T {
  handles.add(handle);
  return handle;
}

function close(handle: { close(): void }): void {
  handle.close();
  handles.delete(handle);
}

function fixture(): { store: EventStore; path: string; root: string; id: string } {
  const root = temporary();
  const path = join(root, 'graphit.db');
  const store = track(new EventStore(path));
  const state = store.initializeProject(root, 'test');
  return { store, path, root, id: state.project!.id };
}

afterEach(() => {
  for (const handle of [...handles].reverse()) close(handle);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('migrations and SQLite configuration', () => {
  it('uses WAL and versioned, checksummed migrations that can run repeatedly', () => {
    const { store, path } = fixture();
    const database = track(new SqliteDatabase(path));
    expect(database.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    const before = database.prepare('SELECT * FROM schema_migrations').all();
    expect(before).toHaveLength(migrations.length);
    expect(before[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(before[0]?.applied_at).toMatch(/Z$/);
    close(store);
    track(new EventStore(path));
    expect(database.prepare('SELECT * FROM schema_migrations').all()).toEqual(before);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'retrieval_%' ORDER BY name").all().map((row) => row.name))
      .toEqual(['checkpoints', 'code_edges', 'code_files', 'code_imports', 'code_index_runs', 'code_projection_state', 'code_symbols', 'events', 'memory_entities', 'memory_relations', 'projects', 'schema_migrations', 'sessions', 'source_blobs']);
  });

  it('refuses in-memory databases because they cannot use WAL', () => {
    expect(() => new EventStore(':memory:')).toThrow('WAL');
  });

  it('fails closed if a migration changes or the database is from a newer version', () => {
    const { path } = fixture();
    const database = track(new SqliteDatabase(path));
    const initial = migrations[0]!;
    expect(() => migrate(database, [{ ...initial, sql: `${initial.sql}\n-- changed` }, ...migrations.slice(1)])).toThrow('integrity');
    migrate(database, [...migrations, { version: migrations.length + 1, name: 'future', sql: 'CREATE TABLE future (id TEXT) STRICT;' }]);
    expect(() => new EventStore(path)).toThrow('newer');
  });

  it('rolls back DDL and the migration ledger when a migration fails', () => {
    const { path } = fixture();
    const database = track(new SqliteDatabase(path));
    expect(() => migrate(database, [...migrations, { version: migrations.length + 1, name: 'bad',
      sql: 'CREATE TABLE partial (id TEXT); INSERT INTO missing_table VALUES (1);' }])).toThrow();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'partial'").get()).toBeUndefined();
    expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()?.count).toBe(migrations.length);
    expect(() => migrate(database, [{ ...migrations[0]!, version: 2 }, ...migrations.slice(1)])).toThrow('ordered');
  });
});

describe('transactional source events', () => {
  it('persists the full envelope and reconstructs state across reopen', () => {
    const { store, path, id } = fixture();
    const events = store.readEvents(id);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(Object.keys(events[0]!).sort()).toEqual([
      'content_hash', 'created_at', 'event_type', 'id', 'payload', 'project_id', 'sequence', 'session_id',
    ]);
    const before = store.getState(id);
    expect(reconstructState(events)).toEqual(before);
    close(store);
    const reopened = track(new EventStore(path));
    expect(reopened.getState(id)).toEqual(before);
  });

  it('blocks source UPDATE, DELETE and INSERT OR REPLACE at the database boundary', () => {
    const { store, path, id } = fixture();
    const database = track(new SqliteDatabase(path));
    const before = store.readEvents(id);
    expect(() => database.exec("UPDATE events SET created_at = 'changed'")).toThrow('immutable');
    expect(() => database.exec('DELETE FROM events')).toThrow('immutable');
    expect(() => database.exec('INSERT OR REPLACE INTO events SELECT * FROM events LIMIT 1')).toThrow('replaced');
    expect(store.readEvents(id)).toEqual(before);
  });

  it('blocks sequence gaps even from a direct SQL connection', () => {
    const { path } = fixture();
    const database = track(new SqliteDatabase(path));
    expect(() => database.exec(`INSERT INTO events SELECT
      '${'f'.repeat(64)}', project_id, session_id, 99, event_type, payload, created_at, content_hash
      FROM events LIMIT 1`)).toThrow('sequence');
  });

  it('allocates independent project sequences', () => {
    const { store, root, id } = fixture();
    const other = store.initializeProject(join(root, 'other'), 'other');
    store.checkpoint(id);
    expect(store.readEvents(id).map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(store.readEvents(other.project!.id).map((event) => event.sequence)).toEqual([1, 2]);
    expect(store.listProjects()).toHaveLength(2);
  });

  it('rejects invalid payloads without consuming a sequence or changing projections', () => {
    const { store, id } = fixture();
    const before = store.getState(id);
    const invalid = { project_id: id, session_id: randomUUID(), event_type: 'session.started', payload: { unexpected: true } };
    expect(() => store.appendEvent(invalid as AppendEventInput)).toThrow();
    expect(store.getState(id)).toEqual(before);
    expect(store.checkpoint(id).through_sequence).toBe(2);
    expect(store.readEvents(id).at(-1)?.sequence).toBe(3);
  });

  it('rolls back both initialization events if the second event fails', () => {
    const root = temporary();
    let calls = 0;
    const store = track(new EventStore(join(root, 'graphit.db'), {
      clock: () => ++calls === 1 ? '2026-09-26T00:00:00.000Z' : 'invalid',
    }));
    expect(() => store.initializeProject(root, 'test')).toThrow();
    expect(store.listProjects()).toEqual([]);
    const database = track(new SqliteDatabase(join(root, 'graphit.db')));
    expect(database.prepare('SELECT COUNT(*) AS count FROM events').get()?.count).toBe(0);
    expect(database.prepare('SELECT COUNT(*) AS count FROM projects').get()?.count).toBe(0);
  });

  it('rolls back the appended event if projection persistence fails', () => {
    const { store, path, id } = fixture();
    const database = track(new SqliteDatabase(path));
    database.exec(`CREATE TRIGGER test_projection_failure BEFORE INSERT ON checkpoints
      BEGIN SELECT RAISE(ABORT, 'injected projection failure'); END;`);
    const before = store.readEvents(id);
    expect(() => store.checkpoint(id)).toThrow('injected projection failure');
    expect(store.readEvents(id)).toEqual(before);
    expect(database.prepare('SELECT last_sequence FROM projects WHERE id = ?').get(id)?.last_sequence).toBe(2);
    database.exec('DROP TRIGGER test_projection_failure');
    expect(store.checkpoint(id).through_sequence).toBe(2);
  });

  it('rejects duplicate initialization without adding events', () => {
    const { store, root, id } = fixture();
    expect(() => store.initializeProject(root, 'another')).toThrow('already initialized');
    expect(store.readEvents(id)).toHaveLength(2);
    expect(() => store.getState(randomUUID())).toThrow('does not exist');
  });

  it('serializes competing processes without duplicate or missing project sequences', async () => {
    const { store, path, id } = fixture();
    const script = `import { EventStore } from '@graphit/storage';
      import { randomUUID } from 'node:crypto';
      const store = new EventStore(process.argv[1]);
      try { for (let i = 0; i < 6; i++) store.appendEvent({ project_id: process.argv[2],
        session_id: randomUUID(), event_type: 'session.started', payload: {} }); }
      finally { store.close(); }`;
    const writers = await Promise.all(Array.from({ length: 4 }, () => exec(process.execPath,
      ['--input-type=module', '-e', script, path, id], { cwd: process.cwd() })));
    for (const writer of writers) expect(writer.stderr).not.toMatch(/ExperimentalWarning/i);
    const events = store.readEvents(id);
    expect(events.map((event) => event.sequence)).toEqual(Array.from({ length: 26 }, (_, index) => index + 1));
    expect(new Set(events.map((event) => event.id)).size).toBe(26);
    expect(store.getState(id).sessions).toHaveLength(25);
  });
});

describe('checkpoints, resume and projection recovery', () => {
  it('records an exact event prefix and resumes in a new session without rewriting history', () => {
    const { store, id } = fixture();
    const checkpointState = store.getState(id);
    const checkpoint = store.checkpoint(id, 'ready');
    expect(checkpoint.state_hash).toBe(contentHash(checkpointState));
    const history = store.readEvents(id);
    const result = store.resume(id);
    expect(result.checkpoint_state).toEqual(checkpointState);
    expect(result.session.id).not.toBe(checkpointState.active_session_id);
    expect(result.state.active_session_id).toBe(result.session.id);
    expect(result.state.last_sequence).toBe(4);
    expect(store.readEvents(id).slice(0, history.length)).toEqual(history);
  });

  it('uses the latest checkpoint by default and can resume a specified older checkpoint', () => {
    const { store, id } = fixture();
    const first = store.checkpoint(id, 'first');
    const second = store.checkpoint(id, 'second');
    expect(store.resume(id).checkpoint.id).toBe(second.id);
    const result = store.resume(id, first.id);
    expect(result.checkpoint.id).toBe(first.id);
    expect(result.state.checkpoints).toHaveLength(2);
    expect(result.state.sessions).toHaveLength(3);
    expect(result.checkpoint_state.last_sequence).toBe(2);
  });

  it('fails missing and cross-project checkpoints without creating sessions', () => {
    const { store, root, id } = fixture();
    expect(() => store.resume(id)).toThrow('Checkpoint not found');
    const other = store.initializeProject(join(root, 'other'), 'other').project!.id;
    const checkpoint = store.checkpoint(other);
    expect(() => store.resume(id, checkpoint.id)).toThrow('Checkpoint not found');
    expect(store.readEvents(id)).toHaveLength(2);
  });

  it('rebuilds all projections from events after projection deletion', () => {
    const { store, path, id } = fixture();
    store.checkpoint(id);
    store.resume(id);
    const before = store.getState(id);
    const sourceEvents = store.readEvents(id);
    const database = track(new SqliteDatabase(path));
    database.exec('DELETE FROM checkpoints; DELETE FROM sessions; DELETE FROM projects;');
    expect(store.getState(id)).toEqual(before);
    store.rebuildProjections();
    expect(database.prepare('SELECT * FROM projects').all()).toHaveLength(1);
    expect(database.prepare('SELECT * FROM sessions').all()).toHaveLength(2);
    expect(database.prepare('SELECT * FROM checkpoints').all()).toHaveLength(1);
    expect(database.prepare('SELECT active_session_id FROM projects').get()?.active_session_id).toBe(before.active_session_id);
    expect(store.readEvents(id)).toEqual(sourceEvents);
    expect(store.getState(id)).toEqual(before);
    store.rebuildProjections();
    expect(store.getState(id)).toEqual(before);
  });

  it('fails closed on corrupt history before modifying events or rebuilding projections', () => {
    const { store, path, id } = fixture();
    const database = track(new SqliteDatabase(path));
    database.prepare(`INSERT INTO events
      (id, project_id, session_id, sequence, event_type, payload, created_at, content_hash)
      VALUES (?, ?, ?, 3, 'session.started', '{}', '2026-09-26T00:00:00.000Z', ?)`)
      .run('f'.repeat(64), id, randomUUID(), '0'.repeat(64));
    expect(() => store.getState(id)).toThrow('integrity');
    expect(() => store.checkpoint(id)).toThrow('integrity');
    expect(() => store.rebuildProjections()).toThrow('integrity');
    expect(database.prepare('SELECT COUNT(*) AS count FROM events').get()?.count).toBe(3);
    expect(database.prepare('SELECT last_sequence FROM projects').get()?.last_sequence).toBe(2);
  });
});
