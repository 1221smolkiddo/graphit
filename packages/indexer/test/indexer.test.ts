import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256 } from '@graphit/core';
import { fixture, track } from './helpers.js';

describe('fixture graph evidence', () => {
  it.each(['typescript-basic', 'python-basic'])('extracts explicit known facts from %s', async (name) => {
    const f = await fixture(name); const run = f.indexer.index(f.id, f.root);
    expect(run.status, JSON.stringify(run.errors)).toBe('completed');
    const graph = f.graph.getGraph(f.id);
    const symbol = (qualified: string) => graph.symbols.find((item) => item.qualifiedName === qualified)!;
    expect(symbol('Worker').kind).toBe('class');
    expect(symbol('entry.nested').kind).toBe('function');
    expect(symbol('Worker.run').kind).toBe('method');
    const edges = (type: string, from: string, to: string) => graph.edges.some((edge) => edge.edge_type === type &&
      edge.source_id === symbol(from).logical_symbol_id && edge.target_id === symbol(to).logical_symbol_id);
    expect(edges('EXTENDS', 'Worker', 'Base')).toBe(true);
    expect(edges('CALLS', 'Worker.run', 'Worker.helper')).toBe(true);
    expect(edges('CALLS', 'entry', 'entry.nested')).toBe(true);
    expect(edges('CALLS', 'entry.nested', name === 'typescript-basic' ? 'add' : 'helper')).toBe(true);
    if (name === 'typescript-basic') expect(edges('IMPLEMENTS', 'Worker', 'Runnable')).toBe(true);
    expect(f.graph.findSymbolsByName(f.id, 'duplicate')).toHaveLength(2);
    expect(graph.diagnostics.some((item) => item.code === 'UNRESOLVED_IMPORT' && item.message.includes('external'))).toBe(true);
    expect(graph.edges.every((edge) => ['EXTRACTED', 'RESOLVED'].includes(edge.classification))).toBe(true);
    for (const edge of graph.edges) {
      const bytes = f.store.readSourceBlob(edge.span.contentHash).content;
      expect(edge.span.endByte).toBeLessThanOrEqual(bytes.length);
      expect(edge.observation_event_id).toMatch(/^[a-f0-9]{64}$/);
    }
    const main = f.graph.getFile(f.id, name === 'typescript-basic' ? 'main.ts' : 'main.py')!;
    expect(f.graph.getImports(f.id, main.id).length).toBeGreaterThan(0);
    expect(f.graph.getDefinitions(f.id, main.id).some((item) => item.name === 'Worker')).toBe(true);
    expect(f.graph.getCallers(f.id, symbol('entry.nested').logical_symbol_id)).toHaveLength(1);
  });

  it('supports TS, TSX, JS, JSX and Python with exact Unicode/CRLF byte evidence', async () => {
    const f = await fixture();
    const sources = { 'unicode.ts': '\uFEFF// π 😀\r\nexport function café() { return "😀"; }\r\n',
      'view.tsx': 'export const View = () => <div>π</div>;', 'widget.jsx': 'export function Widget(){ return <b>x</b>; }',
      'plain.js': 'export const call = () => 1;', 'script.py': '# π\r\ndef value():\r\n    return "😀"\r\n' };
    for (const [path, text] of Object.entries(sources)) writeFileSync(join(f.root, path), text);
    const run = f.indexer.index(f.id, f.root); expect(run.status, JSON.stringify(run.errors)).toBe('completed');
    expect(Object.keys(f.graph.stats(f.id).languages).sort()).toEqual(['javascript', 'jsx', 'python', 'tsx', 'typescript']);
    const symbol = f.graph.findSymbolsByName(f.id, 'café')[0]!;
    expect(symbol.span.startLine).toBe(2);
    expect(f.graph.getSource(f.id, symbol.logical_symbol_id).content).toBe('function café() { return "😀"; }');
    const file = f.graph.getFile(f.id, 'unicode.ts')!;
    expect(Buffer.from(f.store.readSourceBlob(file.observation.content_hash).content)).toEqual(Buffer.from(sources['unicode.ts']));
  });

  it('does not fabricate calls through parameters, duplicate bindings or dynamic receivers', async () => {
    const f = await fixture();
    writeFileSync(join(f.root, 'shadow.ts'), `function target() { return 1; }
      function shadow(target: () => number) { return target(); }
      function dynamic(value: any) { return value.target(); }
      function rebound() { target = () => 2; return target(); }`);
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    const graph = f.graph.getGraph(f.id);
    expect(graph.edges.filter((edge) => edge.edge_type === 'CALLS')).toEqual([]);
    expect(graph.diagnostics.filter((item) => item.code === 'UNRESOLVED_CALLS')).toHaveLength(3);
  });
});

describe('immutable versions and incremental parsing', () => {
  it('returns the original source after filesystem edits and keeps both blobs after reindex', async () => {
    const f = await fixture();
    const first = readFileSync(new URL('../../../fixtures/changes/value-v1.ts.txt', import.meta.url));
    const second = readFileSync(new URL('../../../fixtures/changes/value-v2.ts.txt', import.meta.url));
    writeFileSync(join(f.root, 'value.ts'), first);
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    const original = f.graph.findSymbolsByName(f.id, 'value')[0]!;
    writeFileSync(join(f.root, 'value.ts'), second);
    expect(f.graph.getSource(f.id, original.logical_symbol_id).content).toContain('return 1;');
    expect(f.indexer.index(f.id, f.root).metrics.files_parsed).toBe(1);
    const current = f.graph.findSymbolsByName(f.id, 'value')[0]!;
    expect(current.logical_symbol_id).toBe(original.logical_symbol_id);
    expect(current.symbol_version_id).not.toBe(original.symbol_version_id);
    expect(f.graph.getSource(f.id, current.logical_symbol_id).content).toContain('return 2;');
    expect(f.graph.getSource(f.id, original.symbol_version_id).content).toContain('return 1;');
    expect(Buffer.from(f.store.readSourceBlob(sha256(first)).content)).toEqual(first);
    expect(Buffer.from(f.store.readSourceBlob(sha256(second)).content)).toEqual(second);
  });

  it('reuses unchanged extraction, reparses only one changed file and preserves logical IDs across inserted lines', async () => {
    const f = await fixture('typescript-basic');
    const first = f.indexer.index(f.id, f.root); expect(first.status).toBe('completed');
    const before = f.graph.getGraph(f.id); const calls = f.parseCalls();
    const db = track(new DatabaseSync(f.path)); const blobs = db.prepare('SELECT COUNT(*) AS n FROM source_blobs').get()!.n;
    const unchanged = f.indexer.index(f.id, f.root);
    expect(unchanged.metrics.files_parsed).toBe(0); expect(unchanged.files_unchanged).toBe(first.files_seen);
    expect(f.parseCalls()).toBe(calls); expect(f.graph.getGraph(f.id)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_blobs').get()!.n).toBe(blobs);
    writeFileSync(join(f.root, 'math.ts'), '\n// shifted lines\n' + readFileSync(join(f.root, 'math.ts'), 'utf8'));
    const changed = f.indexer.index(f.id, f.root);
    expect(changed.status).toBe('completed'); expect(changed.metrics.files_parsed).toBe(1); expect(f.parseCalls()).toBe(calls + 1);
    const after = f.graph.getGraph(f.id);
    expect(after.symbols.map((symbol) => symbol.logical_symbol_id)).toEqual(before.symbols.map((symbol) => symbol.logical_symbol_id));
    expect(after.edges.filter((edge) => edge.edge_type === 'CALLS').length).toBe(before.edges.filter((edge) => edge.edge_type === 'CALLS').length);
  });

  it('deduplicates identical bytes and records rename as safe deletion plus observation', async () => {
    const f = await fixture(); const source = 'export function value(){ return 1; }';
    writeFileSync(join(f.root, 'one.ts'), source); writeFileSync(join(f.root, 'two.ts'), source);
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    const db = track(new DatabaseSync(f.path)); expect(db.prepare('SELECT COUNT(*) AS n FROM source_blobs').get()!.n).toBe(1);
    const original = f.graph.getFile(f.id, 'one.ts')!;
    renameSync(join(f.root, 'one.ts'), join(f.root, 'renamed.ts')); rmSync(join(f.root, 'two.ts'));
    const run = f.indexer.index(f.id, f.root);
    expect(run.status).toBe('completed'); expect(run.files_deleted).toBe(2); expect(run.files_changed).toBe(1);
    expect(f.graph.getFile(f.id, 'one.ts')).toBeUndefined(); expect(f.graph.getFile(f.id, 'renamed.ts')).toBeDefined();
    expect(f.store.readSourceBlob(original.observation.content_hash).byte_length).toBe(Buffer.byteLength(source));
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_blobs').get()!.n).toBe(1);
  });

  it('rebuilds identical graph after all code projections are deleted without touching source or memory', async () => {
    const f = await fixture('typescript-basic');
    const source = f.store.readEvents(f.id)[0]!;
    f.memory.promoteMemory(f.id, { entityType: 'goal', content: 'Keep evidence', sourceEventIds: [source.id] });
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    const before = f.graph.getGraph(f.id); const db = track(new DatabaseSync(f.path));
    const events = db.prepare('SELECT * FROM events ORDER BY sequence').all();
    const blobs = db.prepare('SELECT * FROM source_blobs ORDER BY content_hash').all();
    const memory = db.prepare('SELECT * FROM memory_entities').all();
    for (const table of ['code_files', 'code_symbols', 'code_edges', 'code_imports', 'code_index_runs', 'code_projection_state']) db.exec(`DELETE FROM ${table}`);
    const rebuilt = f.graph.rebuildCodeProjection(f.id);
    expect(canonicalJson(rebuilt)).toBe(canonicalJson(before));
    expect(db.prepare('SELECT * FROM events ORDER BY sequence').all()).toEqual(events);
    expect(db.prepare('SELECT * FROM source_blobs ORDER BY content_hash').all()).toEqual(blobs);
    expect(db.prepare('SELECT * FROM memory_entities').all()).toEqual(memory);
  });
});
