import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash, createEvent, reconstructState } from '@graphit/core';
import { EventStore, SqliteDatabase, migrate, migrations, exportProject, readExportFile } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry } from '@graphit/indexer';
import { RetrievalService } from '@graphit/retrieval';
import { canonical, project, temporary } from './recovery-helpers.js';

// Real SQLite files built with the unchanged historical migration prefixes,
// populated with canonical project/session/checkpoint, memory and indexed source.
async function legacyFixture(version: number) {
  const f = await project();
  const root = temporary(); mkdirSync(join(root, '.graphit'));
  const path = join(root, '.graphit', 'graphit.db');
  const old = new SqliteDatabase(path); old.exec('PRAGMA journal_mode = WAL');
  migrate(old, migrations.slice(0, version));
  let events = version === 1 ? f.events.slice(0, 2) : version === 2 ? f.events.slice(0, 3) : f.events;
  if (version < 3) {
    const state = reconstructState(events);
    events = [...events, createEvent({ project_id: f.id, session_id: state.active_session_id!, sequence: events.length + 1,
      created_at: '2026-01-01T00:00:00.000Z', event_type: 'checkpoint.created',
      payload: { name: 'legacy', through_sequence: events.length, state_hash: contentHash(state) } })];
  }
  for (const event of events) old.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    event.id, event.project_id, event.session_id, event.sequence, event.event_type, canonicalJson(event.payload), event.created_at, event.content_hash);
  if (version >= 3) {
    const source = new SqliteDatabase(f.path, { readonly: true });
    try { for (const blob of source.prepare('SELECT * FROM source_blobs').all()) old.prepare('INSERT INTO source_blobs VALUES (?, ?, ?, ?)').run(blob.content_hash, blob.byte_length, blob.content, blob.created_at); }
    finally { source.close(); }
  }
  const ledger = old.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
  const archive = join(root, 'legacy.graphit');
  await exportProject(old, f.id, archive, '0.1.0');
  old.close();
  return { path, id: f.id, events, ledger, archive };
}
describe('P6B upgrade matrix and older-schema bundles', () => {
  it.each([['P0', 1], ['P1', 2], ['P2', 3], ['P3/P4/P5', 4], ['P6A', 4]] as const)(
    'upgrades %s without canonical changes; rebuilds retrieval and handoff; is idempotent', async (_era, version) => {
      const f = await legacyFixture(version);
      const readCanonical = () => {
        const db = new SqliteDatabase(f.path, { readonly: true });
        try { return {
          events: db.prepare('SELECT * FROM events ORDER BY sequence').all(),
          blobs: version >= 3 ? db.prepare('SELECT * FROM source_blobs ORDER BY content_hash').all() : [],
        }; } finally { db.close(); }
      };
      const before = readCanonical();
      const registry = await createParserRegistry();
      for (let startup = 0; startup < 3; startup++) {
        const store = new EventStore(f.path);
        try {
          const memory = new MemoryService(store); const graph = new CodeGraphService(store, registry);
          const retrieval = new RetrievalService(store, memory, graph);
          store.repairDerived(id => retrieval.rebuildSearchProjection(id));
          expect(store.readEvents(f.id)).toEqual(f.events);
          expect(readCanonical()).toEqual(before);
          expect(memory.generateHandoff(f.id).project.id).toBe(f.id);
          const results = retrieval.retrieve({ projectId: f.id, text: 'recover evidence' });
          if (version > 1) {
            expect(results.candidates.length).toBeGreaterThan(0);
            const lexical = results.diagnostics.channels.find(channel => channel.channel === 'bm25_memory')!;
            expect(lexical.entries.length).toBeGreaterThan(0);
            expect(lexical.entries.every(entry => Number.isFinite(entry.score) && entry.score! < 0)).toBe(true);
            const ppr = results.diagnostics.channels.find(channel => channel.channel === 'ppr')!;
            expect(ppr.entries.some(entry => Number.isFinite(entry.score) && entry.score! > 0)).toBe(true);
            expect(results.diagnostics.ppr_iterations).toBeGreaterThan(0);
          } else expect(results.diagnostics.no_results).toBe(true);
          if (version >= 3) {
            const symbols = graph.findSymbolsByName(f.id, 'recoverEvidence');
            expect(symbols).toHaveLength(1);
            expect(store.readSourceBlob(symbols[0]!.span.contentHash).byte_length).toBeGreaterThan(0);
          }
          const db = new SqliteDatabase(f.path, { readonly: true });
          try {
            const ledger = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
            expect(ledger).toHaveLength(4); expect(ledger.slice(0, version)).toEqual(f.ledger.slice(0, version));
            if (startup === 0) f.ledger = ledger;
            else expect(ledger).toEqual(f.ledger);
          } finally { db.close(); }
        } finally { store.close(); }
      }
      const destination = new EventStore(join(temporary(), 'import.db'));
      try {
        const memory = new MemoryService(destination); const graph = new CodeGraphService(destination, registry);
        const retrieval = new RetrievalService(destination, memory, graph);
        destination.importArchive(await readExportFile(f.archive), id => retrieval.rebuildSearchProjection(id));
        expect(destination.readEvents(f.id)).toEqual(f.events);
        expect(memory.generateHandoff(f.id).project.id).toBe(f.id);
      } finally { destination.close(); }
    }, 30000);

  it('rolls back derived repair completely if rebuilding any later projection fails', async () => {
    const f = await project(); const before = canonical(f.path);
    const store = new EventStore(f.path);
    const memory = new MemoryService(store); new CodeGraphService(store, await createParserRegistry());
    const db = new SqliteDatabase(f.path);
    try {
      const handoff = memory.generateHandoff(f.id);
      db.exec('DELETE FROM memory_entities;');
      expect(() => store.repairDerived(() => { throw new Error('injected retrieval failure'); })).toThrow('injected');
      expect(db.prepare('SELECT COUNT(*) AS n FROM memory_entities').get()!.n).toBe(0);
      expect(canonical(f.path)).toEqual(before);
      store.repairDerived(() => {});
      expect(memory.generateHandoff(f.id)).toEqual(handoff);
    } finally { db.close(); store.close(); }
  });
});
