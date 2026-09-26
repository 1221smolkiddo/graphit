import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect } from 'vitest';
import { EventStore, SqliteDatabase } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry, RepositoryIndexer } from '@graphit/indexer';
import { RetrievalService } from '@graphit/retrieval';

export const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
export const cliUrl = pathToFileURL(cli).href;
const roots: string[] = [];
export function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'graphit recovery spaces-')); roots.push(root); return root;
}
export function run(root: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  expect(result.stderr).not.toMatch(/ExperimentalWarning/);
  return result;
}
export function ok(root: string, ...args: string[]): string {
  const result = run(root, ...args); expect(result.status, result.stderr + result.stdout).toBe(0); return result.stdout;
}
export async function project() {
  const root = temporary(); mkdirSync(join(root, '.graphit'));
  writeFileSync(join(root, 'sample.ts'), 'export function recoverEvidence() { return 42; }');
  const path = join(root, '.graphit', 'graphit.db');
  const store = new EventStore(path);
  try {
    const memory = new MemoryService(store);
    const registry = await createParserRegistry();
    const graph = new CodeGraphService(store, registry);
    const id = store.initializeProject(root, 'Recovery fixture').project!.id;
    memory.promoteMemory(id, { entityType: 'goal', content: 'recover evidence', sourceEventIds: [store.readEvents(id)[0]!.id] });
    new RepositoryIndexer(store, graph, registry).index(id, root);
    new RetrievalService(store, memory, graph).rebuildSearchProjection(id);
    store.checkpoint(id, 'committed');
    return { root, path, id, events: store.readEvents(id) };
  } finally { store.close(); }
}
export function canonical(path: string) {
  const db = new SqliteDatabase(path, { readonly: true });
  try { return {
    events: db.prepare('SELECT * FROM events ORDER BY project_id, sequence').all(),
    blobs: db.prepare('SELECT content_hash, byte_length, created_at, hex(content) AS bytes FROM source_blobs ORDER BY content_hash').all(),
  }; } finally { db.close(); }
}

// Fault injection lives exclusively in child test code, never product runtime.
export const pause = "process.send('paused'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);";
export async function killAtBarrier(script: string, root: string, args: string[] = []) {
  // Node --eval intentionally has no script-name argv entry; imported CLI
  // harnesses below preserve that layout for parseArgs' eval-aware defaults.
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr!.on('data', chunk => { stderr += String(chunk); });
  const exited = once(child, 'exit');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      once(child, 'message').then(([message]) => { expect(message).toBe('paused'); }),
      exited.then(() => { throw new Error('Child exited before barrier: ' + stderr); }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Child barrier timeout: ' + root + ' ' + stderr)), 15000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
  expect(stderr).not.toMatch(/ExperimentalWarning/);
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
