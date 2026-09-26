import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { canonicalJson, type SessionMetadata } from '@graphit/core';
import { EventStore } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry } from '@graphit/indexer';
import { GraphitApi, serverVersion, toolSchemas, toolDescriptions, writeTools, type ToolName } from './api.js';
export * from './api.js';

export const resourceUris = ['graphit://project/status', 'graphit://project/handoff', 'graphit://memory/current'] as const;

/** No transport or filesystem selection in tool handlers. Reusable by a future HTTP adapter. */
export function createMcpServer(api: GraphitApi): McpServer {
  const server = new McpServer({ name: 'graphit', version: serverVersion });
  for (const name of Object.keys(toolSchemas) as ToolName[]) {
    server.registerTool(name, { description: toolDescriptions[name], inputSchema: toolSchemas[name],
      annotations: { readOnlyHint: !writeTools.has(name), destructiveHint: false, openWorldHint: false,
        idempotentHint: !writeTools.has(name) || name === 'graphit_add_memory' || name === 'graphit_link_memory' } }, (args: unknown): CallToolResult => {
      try {
        const result = api.call(name, args);
        // One canonical text copy: duplicating structuredContent would double the context cost.
        return { content: [{ type: 'text', text: canonicalJson(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Graphit operation failed' }] };
      }
    });
  }
  for (const uri of resourceUris) server.registerResource(uri, uri, { mimeType: 'application/json' }, () => ({
    contents: [{ uri, mimeType: 'application/json', text: api.resource(uri) }],
  }));
  return server;
}

/** Paths are startup configuration, never MCP request arguments. IDs resolve only in the discovered database. */
export async function openGraphit(options: { cwd?: string; project?: string; metadata?: SessionMetadata } = {}) {
  const isId = options.project !== undefined && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(options.project);
  let root = realpathSync(resolve(isId ? options.cwd ?? process.cwd() : options.project ?? options.cwd ?? process.cwd()));
  while (!existsSync(join(root, '.graphit', 'graphit.db'))) {
    const parent = dirname(root);
    if (parent === root) throw new Error('No Graphit project found; run graphit init');
    root = parent;
  }
  const store = new EventStore(join(root, '.graphit', 'graphit.db'));
  try {
    const memory = new MemoryService(store);
    const graph = new CodeGraphService(store, await createParserRegistry());
    const state = isId ? store.getState(options.project!) : store.findProject(root);
    if (!state?.project) throw new Error('Selected Graphit project does not exist');
    const api = new GraphitApi(store, state.project.id, memory, graph, options.metadata);
    return { api, close: () => store.close() };
  } catch (error) { store.close(); throw error; }
}

export async function runStdio(options: Parameters<typeof openGraphit>[0] = {}): Promise<void> {
  const project = await openGraphit(options);
  let handle: ReturnType<typeof serveStdio> | undefined;
  let finish: (() => void) | undefined;
  const closed = new Promise<void>((resolveClosed) => { finish = resolveClosed; });
  const stop = (): void => { finish?.(); };
  try {
    project.api.startSession();
    handle = serveStdio(() => {
      const server = createMcpServer(project.api);
      server.server.onclose = stop;
      return server;
    }, { onerror: (error) => console.error(`graphit mcp: ${error.message}`) });
    process.stdin.once('end', stop);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await closed;
  } finally {
    process.stdin.removeListener('end', stop);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await handle?.close();
    project.close();
  }
}
