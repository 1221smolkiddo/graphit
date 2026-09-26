import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assembleGraph, auditUnresolved } from '@graphit/codegraph';
import { fixture } from './helpers.js';

describe('P6C deterministic alias forwarding', () => {
  it('resolves exactly the five proven calls, never ambiguous, cyclic, shadowed or rebound calls', async () => {
    const f = await fixture('p6c-resolution');
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    const graph = f.graph.getGraph(f.id);
    const byId = new Map(graph.symbols.map(symbol => [symbol.logical_symbol_id, symbol]));
    const calls = graph.edges.filter(edge => edge.edge_type === 'CALLS');
    expect(calls.map(edge => byId.get(edge.source_id)!.name).sort()).toEqual(
      ['aliasCall', 'barrelCall', 'chainCall', 'namespaceBarrelCall', 'namespaceCall']);
    expect(calls.every(edge => byId.get(edge.target_id)!.path === 'leaf.ts' && byId.get(edge.target_id)!.name === 'target')).toBe(true);
    const audit = auditUnresolved(graph);
    expect(audit.counts.external_package).toBe(2);
    expect(audit.counts.ambiguous_local_symbol).toBe(1);
    expect(audit.total).toBe(13);
    const events = f.store.readEvents(f.id);
    expect(f.graph.rebuildCodeProjection(f.id)).toEqual(graph);
    expect(f.store.readEvents(f.id)).toEqual(events);
    expect(assembleGraph(f.id, [...graph.files].reverse(), file => f.store.readSourceBlob(file.observation.content_hash).content)).toEqual(graph);
  });
  it('does not forward conflicting imports, duplicate exports or namespace objects', async () => {
    const f = await fixture();
    writeFileSync(join(f.root, 'leaf.ts'), 'export function target() { return 1; }');
    writeFileSync(join(f.root, 'bad.ts'), `import { target as same } from './leaf';
      import { target as same } from './leaf';
      import * as ns from './leaf';
      export { same as conflict, ns as namespace };
      export { same as repeated, same as repeated };`);
    writeFileSync(join(f.root, 'main.ts'), `import { conflict, namespace, repeated } from './bad';
      function run() { conflict(); namespace.target(); repeated(); }`);
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    expect(f.graph.getGraph(f.id).edges.filter(edge => edge.edge_type === 'CALLS')).toEqual([]);
  });
  it('never turns type-only import/export chains into runtime calls', async () => {
    const f = await fixture();
    writeFileSync(join(f.root, 'leaf.ts'), 'export function target() { return 1; }');
    writeFileSync(join(f.root, 'types.ts'), `import type { target as importedType } from './leaf';
      import { type target as namedType } from './leaf';
      import { target as value } from './leaf';
      export { importedType, namedType };
      export type { value as exportedType };`);
    writeFileSync(join(f.root, 'main.ts'), `import { importedType, namedType, exportedType } from './types';
      function run() { importedType(); namedType(); exportedType(); }`);
    expect(f.indexer.index(f.id, f.root).status).toBe('completed');
    expect(f.graph.getGraph(f.id).edges.filter(edge => edge.edge_type === 'CALLS')).toEqual([]);
  });
});
