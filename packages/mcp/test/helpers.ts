import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { EventStore } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry, RepositoryIndexer } from '@graphit/indexer';

export const cli = fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url));
const directories: string[] = [];
const stores = new Set<EventStore>();
const clients = new Set<Client>();
export async function fixture(index = false) {
  const root = mkdtempSync(join(tmpdir(), 'graphit-p4-test-')); directories.push(root);
  if (index) cpSync(fileURLToPath(new URL('../../../fixtures/repos/auth-retrieval', import.meta.url)), root, { recursive: true });
  mkdirSync(join(root, '.graphit'));
  const path = join(root, '.graphit', 'graphit.db');
  const store = new EventStore(path); stores.add(store);
  const memory = new MemoryService(store);
  const graph = new CodeGraphService(store, await createParserRegistry());
  const id = store.initializeProject(root, 'MCP continuation').project!.id;
  if (index) expect(new RepositoryIndexer(store, graph, await createParserRegistry()).index(id, root).status).toBe('completed');
  return { root, path, store, memory, graph, id };
}
export function closeStore(store: EventStore): void { store.close(); stores.delete(store); }
export async function connect(root: string, provider = 'unknown', agent = 'test', project?: string) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [cli, 'mcp', '--provider', provider, '--agent', agent, '--model', 'arbitrary-model', '--client', 'vitest',
      '--external-session-id', 'external-test', ...(project === undefined ? [] : ['--project', project])], cwd: root, stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const client = new Client({ name: agent, version: '1.0.0' }); clients.add(client);
  await client.connect(transport);
  return { client, transport, stderr: () => stderr, close: async () => { await client.close(); clients.delete(client); } };
}
export async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  const text = result.content.find((item) => item.type === 'text');
  if (!text || text.type !== 'text') throw new Error('Expected canonical text result');
  return JSON.parse(text.text) as T;
}
export async function rejects(client: Client, name: string, args: Record<string, unknown>): Promise<void> {
  // Both protocol InvalidParams and a tools/call isError are valid fail-closed responses.
  try { const result = await client.callTool({ name, arguments: args }); expect(result.isError).toBe(true); }
  catch (error) { if (error instanceof Error && error.name === 'AssertionError') throw error; }
}
afterEach(async () => {
  for (const client of clients) await client.close(); clients.clear();
  for (const store of stores) store.close(); stores.clear();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
