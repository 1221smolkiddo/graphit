import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { sha256 } from '@graphit/core';
import { EventStore } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { CodeGraphService, normalizePath, type ParserRegistry } from '@graphit/codegraph';
import { createParserRegistry, RepositoryIndexer, readRepositoryFile, scanRepository } from '@graphit/indexer';
import { fixture, temporary, track } from './helpers.js';

describe('fail-closed indexing and source integrity', () => {
  it('rolls back partial projections and still preserves evidence when graph publication fails', async () => {
    const f = await fixture(); writeFileSync(join(f.root, 'value.ts'), 'function value(){ return 1; }');
    f.indexer.index(f.id, f.root); const before = f.graph.getGraph(f.id);
    const bytes = Buffer.from('function value(){ return 2; }'); writeFileSync(join(f.root, 'value.ts'), bytes);
    const db = track(new DatabaseSync(f.path));
    db.exec("CREATE TRIGGER inject_code_failure BEFORE INSERT ON code_symbols BEGIN SELECT RAISE(ABORT, 'injected graph publication failure'); END");
    const run = f.indexer.index(f.id, f.root);
    expect(run.status).toBe('failed'); expect(run.errors.at(-1)!.message).toContain('injected graph publication failure');
    expect(f.graph.getGraph(f.id)).toEqual(before);
    expect(Buffer.from(f.store.readSourceBlob(sha256(bytes)).content)).toEqual(bytes);
    expect(f.store.readEvents(f.id).at(-1)!.event_type).toBe('code.index.failed');
  });

  it('rejects malformed parser results without publishing a graph or losing parsed bytes', async () => {
    const base = await createParserRegistry();
    const malformed: ParserRegistry = { get(language, id, version) {
      const adapter = base.get(language, id, version);
      return { ...adapter, parse(bytes, path) { const result = adapter.parse(bytes, path); result.symbols[0]!.span.endByte = bytes.length + 1; return result; } };
    } };
    const f = await fixture(undefined, malformed); const bytes = Buffer.from('function value(){ return 1; }');
    writeFileSync(join(f.root, 'value.ts'), bytes);
    const run = f.indexer.index(f.id, f.root);
    expect(run.status).toBe('failed'); expect(run.parse_errors).toBe(1);
    expect(run.errors[0]!.message).toContain('Invalid parser evidence span');
    expect(f.graph.getGraph(f.id).files).toEqual([]);
    expect(Buffer.from(f.store.readSourceBlob(sha256(bytes)).content)).toEqual(bytes);
  });

  it('retains the previous graph and syntax-error source on failed runs', async () => {
    const f = await fixture(); writeFileSync(join(f.root, 'value.ts'), 'function value(){ return 1; }');
    expect(f.indexer.index(f.id, f.root).status).toBe('completed'); const before = f.graph.getGraph(f.id);
    const broken = readFileSync(new URL('../../../fixtures/changes/syntax-error.ts.txt', import.meta.url));
    writeFileSync(join(f.root, 'value.ts'), broken);
    const failed = f.indexer.index(f.id, f.root);
    expect(failed.status).toBe('failed'); expect(failed.parse_errors).toBe(1); expect(failed.errors.length).toBeGreaterThan(0);
    expect(f.graph.getGraph(f.id)).toEqual(before); expect(f.graph.rebuildCodeProjection(f.id)).toEqual(before);
    expect(Buffer.from(f.store.readSourceBlob(sha256(broken)).content)).toEqual(broken);
    writeFileSync(join(f.root, 'value.ts'), 'function value(){ return 2; }');
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    expect(f.graph.getSource(f.id, before.symbols.find((item) => item.name === 'value')!.symbol_version_id).content).toContain('return 1');
  });

  it('preserves invalid UTF-8 bytes and explicitly fails parsing', async () => {
    const f = await fixture(); const bytes = Buffer.from([0xff, 0xfe, 0x01]);
    writeFileSync(join(f.root, 'bad.ts'), bytes);
    expect(f.indexer.index(f.id, f.root).status).toBe('failed');
    expect(Buffer.from(f.store.readSourceBlob(sha256(bytes)).content)).toEqual(bytes);
  });

  it('rejects nonexistent blob references and rolls back events and blob inserts together', async () => {
    const f = await fixture(); const index_run_id = randomUUID();
    f.store.withProjectTransaction(f.id, (tx) => tx.append({ event_type: 'code.index.started', payload: { index_run_id, root_path: f.root, started_at: new Date().toISOString() } }));
    const before = f.store.readEvents(f.id); const bytes = Buffer.from('unused source');
    expect(() => f.store.withProjectTransaction(f.id, (tx) => {
      tx.putSourceBlob(bytes);
      tx.append({ event_type: 'code.file.observed', payload: { index_run_id, path: 'missing.ts', language: 'typescript',
        content_hash: '0'.repeat(64), byte_length: 1, parser_id: 'test', parser_version: '1', observed_at: new Date().toISOString() } });
    })).toThrow('Source blob does not exist');
    expect(f.store.readEvents(f.id)).toEqual(before);
    expect(() => f.store.readSourceBlob(sha256(bytes))).toThrow('Source blob does not exist');
  });

  it('detects corrupt content hashes even when corruption is inserted through raw SQL', async () => {
    const f = await fixture(); const db = track(new DatabaseSync(f.path));
    db.prepare('INSERT INTO source_blobs VALUES (?, ?, ?, ?)').run('0'.repeat(64), 3, Buffer.from('bad'), new Date().toISOString());
    expect(() => f.store.readSourceBlob('0'.repeat(64))).toThrow('integrity check failed');
  });

  it('blocks update, delete and replacement of preserved blobs in SQLite', async () => {
    const f = await fixture(); const blob = f.store.withProjectTransaction(f.id, (tx) => tx.putSourceBlob(Buffer.from('source')));
    const db = track(new DatabaseSync(f.path));
    expect(() => db.prepare('UPDATE source_blobs SET created_at = ? WHERE content_hash = ?').run(new Date().toISOString(), blob.content_hash)).toThrow('immutable');
    expect(() => db.prepare('DELETE FROM source_blobs WHERE content_hash = ?').run(blob.content_hash)).toThrow('immutable');
    expect(() => db.prepare('INSERT OR REPLACE INTO source_blobs VALUES (?, ?, ?, ?)').run(blob.content_hash, 6, Buffer.from('source'), blob.created_at)).toThrow('cannot be replaced');
    expect(f.store.readSourceBlob(blob.content_hash)).toEqual(blob);
  });

  it('requires explicit recovery of an interrupted run and never labels it successful', async () => {
    const f = await fixture(); const index_run_id = randomUUID();
    f.store.withProjectTransaction(f.id, (tx) => tx.append({ event_type: 'code.index.started', payload: { index_run_id, root_path: f.root, started_at: new Date().toISOString() } }));
    expect(f.graph.stats(f.id).last_index_status).toBe('running');
    expect(f.graph.getRuns(f.id)[0]!.completed_at).toBeNull();
    expect(() => f.indexer.index(f.id, f.root)).toThrow('unfinished');
    expect(f.indexer.index(f.id, f.root, { rebuild: true }).status).toBe('completed');
    const runs = f.graph.getRuns(f.id); expect(runs.map((run) => run.status)).toEqual(['failed', 'completed']);
    expect(runs[0]!.errors[0]!.message).toContain('recovered');
  });

  it('fails closed when the recorded parser version is unavailable during rebuild', async () => {
    const f = await fixture('python-basic'); f.indexer.index(f.id, f.root); const before = f.graph.getGraph(f.id);
    f.graph.setParserRegistry({ get() { throw new Error('Recorded parser unavailable'); } });
    expect(() => f.graph.rebuildCodeProjection(f.id)).toThrow('Recorded parser unavailable');
    expect(f.graph.getGraph(f.id)).toEqual(before);
  });

  it('isolates graphs, rebuilds and historical source queries between projects in one database', async () => {
    const f = await fixture(); writeFileSync(join(f.root, 'a.ts'), 'function first(){ return 1; }'); f.indexer.index(f.id, f.root);
    const root = temporary(); writeFileSync(join(root, 'a.ts'), 'function second(){ return 2; }');
    const id = f.store.initializeProject(root, 'Second').project!.id;
    f.indexer.index(id, root); const second = f.graph.getGraph(id);
    const first = f.graph.findSymbolsByName(f.id, 'first')[0]!;
    expect(f.graph.findSymbolsByName(id, 'first')).toEqual([]);
    expect(() => f.graph.getSource(id, first.symbol_version_id)).toThrow('does not exist in this project');
    f.graph.rebuildCodeProjection(f.id); expect(f.graph.getGraph(id)).toEqual(second);
    expect(() => f.indexer.index(f.id, root)).toThrow('project root');
  });
});

describe('scanning safety and deterministic resolution', () => {
  it('does not invent calls through catch, block, lambda or nested-import shadowing', async () => {
    const f = await fixture();
    writeFileSync(join(f.root, 'shadow.ts'), `function target(){} function run(){ try {} catch(target){ target(); } }
      function block(){ if (true) { function hidden(){} } hidden(); }`);
    writeFileSync(join(f.root, 'shadow.py'), 'def target():\n    return 1\ndef run():\n    from external import target\n    return target()\nvalue = lambda target: target()\n');
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    expect(f.graph.getGraph(f.id).edges.filter((edge) => edge.edge_type === 'CALLS')).toEqual([]);
  });

  it('normalizes Windows relative paths and rejects traversal/absolute paths', () => {
    expect(normalizePath('src\\nested\\file.ts')).toBe('src/nested/file.ts');
    for (const path of ['../x.ts', 'src/../x.ts', 'C:\\secret.ts', '/tmp/x.ts', '\\\\host\\share.ts', '.']) expect(() => normalizePath(path)).toThrow('Unsafe');
  });

  it('does not read files outside the root', async () => {
    const f = await fixture(); const outside = temporary(); const absolutePath = join(outside, 'secret.ts'); writeFileSync(absolutePath, 'secret');
    expect(() => readRepositoryFile(f.root, { absolutePath, path: '../secret.ts', language: 'typescript' })).toThrow('escapes');
  });

  it('ignores generated directories and reports a symlink cycle without following it', async () => {
    const f = await fixture(); mkdirSync(join(f.root, 'node_modules')); writeFileSync(join(f.root, 'node_modules', 'ignored.ts'), 'not valid source');
    symlinkSync(f.root, join(f.root, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
    const scan = scanRepository(f.root); expect(scan.files).toEqual([]);
    expect(scan.errors).toEqual([{ path: 'cycle', message: 'Symlink skipped; target was not read' }]);
    expect(f.indexer.index(f.id, f.root).status).toBe('failed');
  });

  it('resolves TS index modules and Python package-relative imports without guessing ambiguous paths', async () => {
    const f = await fixture(); mkdirSync(join(f.root, 'lib')); mkdirSync(join(f.root, 'pkg'));
    writeFileSync(join(f.root, 'lib', 'index.ts'), 'export function local(){ return 1; }');
    writeFileSync(join(f.root, 'main.ts'), 'import { local } from "./lib"; export function main(){ return local(); }');
    writeFileSync(join(f.root, 'pkg', 'util.py'), 'def local():\n    return 1\n');
    writeFileSync(join(f.root, 'pkg', 'main.py'), 'from .util import local\ndef main():\n    return local()\n');
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    expect(f.graph.getGraph(f.id).edges.filter((edge) => edge.edge_type === 'CALLS')).toHaveLength(2);
    writeFileSync(join(f.root, 'lib.ts'), 'export function local(){ return 2; }');
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    expect(f.graph.getGraph(f.id).edges.filter((edge) => edge.edge_type === 'CALLS')).toHaveLength(1);
  });

  it('retains overload discriminators and refuses ambiguous calls or implicit class receivers', async () => {
    const f = await fixture(); writeFileSync(join(f.root, 'overload.ts'), `function value(x: string): string;
      function value(x: number): number;
      function value(x: string | number) { return x; }
      function use(){ return value(1); }
      class Worker { target() {} run(){ target(); function nested(){ this.target(); } } }`);
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    const values = f.graph.findSymbolsByName(f.id, 'value'); expect(values).toHaveLength(3);
    expect(new Set(values.map((item) => item.logical_symbol_id)).size).toBe(3);
    expect(f.graph.getGraph(f.id).edges.filter((edge) => edge.edge_type === 'CALLS')).toEqual([]);
  });

  it('can reopen the persistent graph in another service without reparsing unchanged files', async () => {
    const f = await fixture('python-basic'); f.indexer.index(f.id, f.root); const before = f.parseCalls();
    const store = track(new EventStore(f.path)); new MemoryService(store);
    const graph = new CodeGraphService(store, f.counted);
    const indexer = new RepositoryIndexer(store, graph, f.counted);
    expect(indexer.index(f.id, f.root).metrics.files_parsed).toBe(0); expect(f.parseCalls()).toBe(before);
  });
});
