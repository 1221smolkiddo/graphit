import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { EventStore } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { CodeGraphService, type ParserRegistry } from '@graphit/codegraph';
import { createParserRegistry, RepositoryIndexer } from '@graphit/indexer';

const directories: string[] = [];
const resources = new Set<{ close(): void }>();
let parsers: Promise<ParserRegistry> | undefined;
export function track<T extends { close(): void }>(resource: T): T { resources.add(resource); return resource; }
export function temporary(): string { const root = mkdtempSync(join(tmpdir(), 'graphit-p2-test-')); directories.push(root); return root; }
export async function fixture(name?: string, registry?: ParserRegistry) {
  const root = temporary();
  if (name) cpSync(fileURLToPath(new URL(`../../../fixtures/repos/${name}`, import.meta.url)), root, { recursive: true });
  mkdirSync(join(root, '.graphit'));
  const path = join(root, '.graphit', 'graphit.db');
  const store = track(new EventStore(path));
  const memory = new MemoryService(store);
  parsers ??= createParserRegistry();
  const base = registry ?? await parsers;
  let calls = 0;
  const counted: ParserRegistry = { get(language, id, version) {
    const adapter = base.get(language, id, version);
    return { ...adapter, parse(bytes, path) { calls++; return adapter.parse(bytes, path); } };
  } };
  const graph = new CodeGraphService(store, counted);
  const indexer = new RepositoryIndexer(store, graph, counted);
  const project = store.initializeProject(root, 'P2 test').project!;
  return { root, path, store, memory, graph, indexer, id: project.id, counted, parseCalls: () => calls };
}
afterEach(() => {
  for (const resource of [...resources].reverse()) resource.close();
  resources.clear();
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});
