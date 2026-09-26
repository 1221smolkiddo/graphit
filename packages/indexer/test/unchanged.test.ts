import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteDatabase, EventStore } from '@graphit/storage';
import { CodeGraphService } from '@graphit/codegraph';
import { MemoryService } from '@graphit/memory';
import { RepositoryIndexer } from '@graphit/indexer';
import { fixture, track } from './helpers.js';

describe('validated unchanged-index reuse', () => {
  it('keeps graph rows untouched but appends started/completed events, including after reopen', async () => {
    const f = await fixture('typescript-basic');
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    const graph = f.graph.getGraph(f.id); const calls = f.parseCalls();
    const events = f.store.readEvents(f.id);
    const db = track(new SqliteDatabase(f.path));
    // A rewrite of any graph row would fail, even if the replacement is identical.
    for (const table of ['code_files', 'code_symbols', 'code_edges', 'code_imports']) {
      for (const operation of ['DELETE', 'INSERT', 'UPDATE']) db.exec(
        `CREATE TRIGGER no_${operation}_${table} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'unexpected graph rewrite'); END`);
    }
    const reopened = track(new EventStore(f.path)); new MemoryService(reopened);
    const service = new CodeGraphService(reopened, f.counted);
    const run = new RepositoryIndexer(reopened, service, f.counted).index(f.id, f.root);
    expect(run.status, JSON.stringify(run.errors)).toBe('completed');
    expect(run.metrics.files_parsed).toBe(0); expect(f.parseCalls()).toBe(calls);
    expect(run.metrics.edges_extracted).toBe(graph.edges.length);
    expect(service.getGraph(f.id)).toEqual(graph);
    expect(reopened.readEvents(f.id).slice(0, events.length)).toEqual(events);
    expect(reopened.readEvents(f.id).slice(events.length).map(event => event.event_type)).toEqual(['code.index.started', 'code.index.completed']);
  });
  it('does not reuse a damaged projection on an unchanged filesystem', async () => {
    const f = await fixture('typescript-basic');
    f.indexer.index(f.id, f.root); const graph = f.graph.getGraph(f.id);
    const db = track(new SqliteDatabase(f.path)); db.exec('DELETE FROM code_edges');
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    expect(f.graph.getGraph(f.id)).toEqual(graph);
  });
  it('still globally resolves changed targets and preserves old source evidence', async () => {
    const f = await fixture();
    writeFileSync(join(f.root, 'target.ts'), 'export function target() { return 1; }');
    writeFileSync(join(f.root, 'caller.ts'), "import { target } from './target'; export function caller() { return target(); }");
    f.indexer.index(f.id, f.root);
    const before = f.graph.getGraph(f.id);
    writeFileSync(join(f.root, 'target.ts'), 'export const target = 1;');
    const run = f.indexer.index(f.id, f.root);
    expect(run.status).toBe('completed'); expect(run.metrics.files_parsed).toBe(1);
    expect(f.graph.getGraph(f.id).edges.filter(edge => edge.edge_type === 'CALLS')).toEqual([]);
    for (const file of before.files) expect(f.store.readSourceBlob(file.observation.content_hash).byte_length).toBe(file.observation.byte_length);
    expect(f.graph.rebuildCodeProjection(f.id)).toEqual(f.graph.getGraph(f.id));
  });
});
