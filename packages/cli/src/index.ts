#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { EventStore, readExportFile, validateExport } from '@graphit/storage';
import type { ProjectState } from '@graphit/core';
import { requireSupportedNode } from '@graphit/core';
import { MemoryService, entityTypeSchema, statusSchema } from '@graphit/memory';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry, RepositoryIndexer } from '@graphit/indexer';
import { RetrievalService, type RetrievalQuery } from '@graphit/retrieval';
import { ContextCompiler, renderContext, serializeContext } from '@graphit/context';
import { runStdio } from '@graphit/mcp';
import { inspectProject } from './doctor.js';
import { readPassphrase } from './passphrase.js';

export const GRAPHIT_VERSION = '0.1.0';

const usage = `Graphit ${GRAPHIT_VERSION} — local project memory, code intelligence and MCP for AI agents

  graphit init [--name <name>] [--json]
  graphit status [--json]
  graphit checkpoint [--name <name>] [--json]
  graphit resume [--checkpoint <id>] [--json]
  graphit session start [--provider <provider>] [--agent <agent>] [--model <model>]
    [--external-session-id <id>] [--client <client>] [--json]
  graphit memory add --type <type> --content <text> --source-event <id> [--json]
  graphit memory list [--type <type>] [--status <status>] [--json]
  graphit memory supersede <id> --content <text> --source-event <id> [--json]
  graphit memory supersede <id> --with <replacement-id> [--source-event <id>] [--json]
  graphit memory resolve <id> [--source-event <id>] [--json]
  graphit memory link <memory-id> --symbol <symbol-id> [--json]
  graphit handoff [--json]
  graphit index [path] [--rebuild] [--json]
  graphit code stats [--json]
  graphit code symbol <name-or-id> [--json]
  graphit code callers <name-or-id> [--json]
  graphit code callees <name-or-id> [--json]
  graphit code imports <file> [--json]
  graphit code source <symbol-or-version-id> [--json]
  graphit retrieve "<query>" [--limit <n>] [--mode <mode>] [--json]
  graphit context "<query>" [--tokens <n>] [--mode <mode>] [--file <path>] [--symbol <id>] [--json]
  graphit mcp [--project <path-or-id>] [--provider <provider>] [--agent <agent>]
    [--model <model>] [--external-session-id <id>] [--client <client>]
  graphit mcp doctor [--project <path-or-id>] [--json]
  graphit mcp config [--json]
  graphit doctor [--json]
  graphit repair [--json]
  graphit export <output> [--encrypt] [--passphrase-env <VARIABLE_NAME>]
  graphit import <file> [--passphrase-env <VARIABLE_NAME>]

Commands discover .graphit/graphit.db from the current directory upward.
Repeat --source-event to attach multiple evidence events.
Handoff always emits JSON. Resume retains its P0 behavior.`;

function findRoot(start: string): string | undefined {
  let candidate = start;
  while (true) {
    if (existsSync(join(candidate, '.graphit', 'graphit.db'))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
}

function requiredProject(store: EventStore, root: string): ProjectState {
  const state = store.findProject(root);
  if (!state?.project) throw new Error('No project matches this directory; run graphit init');
  return state;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      name: { type: 'string' },
      project: { type: 'string' },
      checkpoint: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      type: { type: 'string' },
      content: { type: 'string' },
      status: { type: 'string' },
      'source-event': { type: 'string', multiple: true },
      with: { type: 'string' },
      provider: { type: 'string' },
      agent: { type: 'string' },
      model: { type: 'string' },
      'external-session-id': { type: 'string' },
      client: { type: 'string' },
      rebuild: { type: 'boolean' },
      encrypt: { type: 'boolean' },
      'passphrase-env': { type: 'string' },
      tokens: { type: 'string' }, limit: { type: 'string' }, mode: { type: 'string' },
      file: { type: 'string', multiple: true }, symbol: { type: 'string', multiple: true },
    },
  });
  if (values.version) { console.log(`graphit ${GRAPHIT_VERSION}`); return; }
  if (values.help) { console.log(usage); return; }
  const command = positionals[0];
  const route = command === 'mcp' && positionals[1] !== undefined ? `mcp ${positionals[1]}` :
    command === 'memory' || command === 'session' || command === 'code' ? `${command} ${positionals[1] ?? ''}` : command ?? '';
  const routes: Record<string, { positionalCount: number; options: string[] }> = {
    mcp: { positionalCount: 1, options: ['project', 'provider', 'agent', 'model', 'external-session-id', 'client'] },
    'mcp doctor': { positionalCount: 2, options: ['project'] },
    'mcp config': { positionalCount: 2, options: [] },
    init: { positionalCount: 1, options: ['name'] }, status: { positionalCount: 1, options: [] },
    checkpoint: { positionalCount: 1, options: ['name'] }, resume: { positionalCount: 1, options: ['checkpoint'] },
    handoff: { positionalCount: 1, options: [] },
    doctor: { positionalCount: 1, options: [] },
    repair: { positionalCount: 1, options: [] },
    export: { positionalCount: 2, options: ['encrypt', 'passphrase-env'] },
    import: { positionalCount: 2, options: ['passphrase-env'] },
    'session start': { positionalCount: 2, options: ['provider', 'agent', 'model', 'external-session-id', 'client'] },
    'memory add': { positionalCount: 2, options: ['type', 'content', 'source-event'] },
    'memory list': { positionalCount: 2, options: ['type', 'status'] },
    'memory supersede': { positionalCount: 3, options: ['content', 'with', 'source-event'] },
    'memory resolve': { positionalCount: 3, options: ['source-event'] },
    'memory link': { positionalCount: 3, options: ['symbol'] },
    retrieve: { positionalCount: 2, options: ['limit', 'mode'] },
    context: { positionalCount: 2, options: ['tokens', 'mode', 'file', 'symbol'] },
    index: { positionalCount: positionals.length === 1 ? 1 : 2, options: ['rebuild'] },
    'code stats': { positionalCount: 2, options: [] },
    'code symbol': { positionalCount: 3, options: [] },
    'code callers': { positionalCount: 3, options: [] },
    'code callees': { positionalCount: 3, options: [] },
    'code imports': { positionalCount: 3, options: [] },
    'code source': { positionalCount: 3, options: [] },
  };
  const definition = Object.hasOwn(routes, route) ? routes[route] : undefined;
  if (!definition || positionals.length !== definition.positionalCount) throw new Error(`Invalid command\n${usage}`);
  for (const key of Object.keys(values)) {
    if (!['json', 'help', 'version', ...definition.options].includes(key)) throw new Error(`--${key} is not valid for ${route}`);
  }
  if (command === 'doctor' || route === 'mcp doctor') {
    const isId = values.project !== undefined && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(values.project);
    const root = findRoot(realpathSync(resolve(isId ? process.cwd() : values.project ?? process.cwd())));
    const result = await inspectProject(root, isId ? values.project : undefined);
    console.log(values.json || route === 'mcp doctor' ? JSON.stringify(result, null, 2) :
      'Graphit Doctor\n' + Object.entries(result).map(([key, value]) => `  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join('\n'));
    if (result.errors.length) process.exitCode = 1;
    return;
  }
  requireSupportedNode();
  if (command === 'export' && values['passphrase-env'] !== undefined && !values.encrypt) throw new Error('--passphrase-env requires --encrypt for export');
  if (command === 'mcp') {
    if (route === 'mcp config') {
      const cwd = realpathSync(resolve(process.cwd()));
      const config = {
        mcpServers: {
          graphit: {
            command: 'graphit',
            args: ['mcp', '--project', cwd],
          },
        },
      };
      if (values.json) {
        console.log(JSON.stringify(config, null, 2));
      } else {
        console.log(`MCP client configuration for this project:

Add to your MCP client config (e.g. claude_desktop_config.json):

${JSON.stringify(config, null, 2)}

Or with explicit provider metadata:

  graphit mcp --provider <provider> --agent <agent> --model <model>

The server discovers .graphit/graphit.db from the working directory.`);
      }
      return;
    }
    const metadata = Object.fromEntries(Object.entries({ provider: values.provider, agent_name: values.agent,
      model_name: values.model, external_session_id: values['external-session-id'], client_name: values.client })
      .filter((entry): entry is [string, string] => entry[1] !== undefined));
    const options = { ...(values.project === undefined ? {} : { project: values.project }), metadata };
    await runStdio(options);
    return;
  }
  // Import does not require an existing project
  if (command === 'import') {
    const filePath = realpathSync(resolve(positionals[1]!));
    const cwd = realpathSync(resolve(process.cwd()));
    const destination = join(cwd, '.graphit');
    if (existsSync(destination) || findRoot(cwd)) throw new Error('Import into a clean directory outside an existing Graphit project');
    const data = await readExportFile(filePath, () => readPassphrase(values['passphrase-env']));
    validateExport(data); // Invalid input never creates a destination database.
    const staging = mkdtempSync(join(cwd, '.graphit-import-'));
    try {
      const store = new EventStore(join(staging, 'graphit.db'));
      let result;
      try {
        const memory = new MemoryService(store);
        const graph = new CodeGraphService(store, await createParserRegistry());
        const retrieval = new RetrievalService(store, memory, graph);
        result = store.importArchive(data, (id) => { retrieval.rebuildSearchProjection(id); });
      } finally { store.close(); }
      writeFileSync(join(staging, 'project.json'), JSON.stringify({ project_id: result.project_id }), { flag: 'wx', mode: 0o600 });
      // Publish only after every canonical and derived validation succeeds; never replace existing state.
      if (existsSync(destination)) throw new Error('Import destination appeared during validation');
      renameSync(staging, destination);
      const output = { ...result, message: `Imported project ${result.manifest.project_name} (${result.project_id})` };
      console.log(values.json ? JSON.stringify(output, null, 2) : output.message +
        `\n  Events: ${result.events_imported}\n  Source blobs: ${result.blobs_imported}\n  Projections rebuilt`);
    } finally {
      // Exact generated staging directory only. The published database is never cleaned up here.
      if (existsSync(staging) && dirname(staging) === cwd && basename(staging).startsWith('.graphit-import-')) rmSync(staging, { recursive: true, force: true });
    }
    return;
  }
  const cwd = realpathSync(resolve(process.cwd()));
  const target = command === 'index' && positionals[1] !== undefined ? realpathSync(resolve(cwd, positionals[1])) : cwd;
  const existingRoot = findRoot(target);
  if (command !== 'init' && command !== 'index' && !existingRoot) throw new Error('No Graphit project found; run graphit init');
  if (command === 'init' && existingRoot && existingRoot !== cwd) throw new Error(`Already inside a Graphit project: ${existingRoot}`);
  const root = existingRoot ?? target;
  if (command === 'index' && positionals[1] !== undefined && target !== root) throw new Error('Index path must be the project root');
  if (command === 'init' || command === 'index') mkdirSync(join(root, '.graphit'), { recursive: true });
  const store = new EventStore(join(root, '.graphit', 'graphit.db'));
  try {
    const memory = new MemoryService(store);
    const graph = new CodeGraphService(store);
    const registry = ['index','code','retrieve','context','repair'].includes(command ?? '') || route === 'memory link' ? await createParserRegistry() : undefined;
    if (registry) graph.setParserRegistry(registry);
    if (command === 'repair') {
      requiredProject(store, root);
      const retrieval = new RetrievalService(store, memory, graph);
      const result = store.repairDerived(id => retrieval.rebuildSearchProjection(id));
      console.log(values.json ? JSON.stringify(result, null, 2) : 'Rebuilt derived state. Canonical events and source blobs unchanged.');
      return;
    }
    if (command === 'index' && !store.findProject(root)) store.initializeProject(root, basename(root) || 'project');
    // Export command
    if (command === 'export') {
      const state = requiredProject(store, root);
      const outputPath = resolve(positionals[1]!);
      const encryption = values.encrypt ? { passphrase: await readPassphrase(values['passphrase-env'], true) } : undefined;
      const manifest = await store.exportArchive(state.project!.id, outputPath, GRAPHIT_VERSION, encryption);
      const output = { ...manifest, message: `Exported project ${manifest.project_name} to ${outputPath}` };
      console.log(values.json ? JSON.stringify(output, null, 2) : output.message +
        `\n  Events: ${manifest.event_count}\n  Source blobs: ${manifest.source_blob_count}\n  Integrity: ${manifest.content_hash.slice(0, 16)}…`);
      return;
    }
    let output: unknown;
    let message: string;
    if (command === 'init') {
      const state = store.initializeProject(root, values.name ?? (basename(root) || 'project'));
      output = state;
      message = `Initialized ${state.project?.name}\nProject: ${state.project?.id}\nSession: ${state.active_session_id}\nDatabase: ${join(root, '.graphit', 'graphit.db')}`;
    } else {
      const state = requiredProject(store, root);
      const projectId = state.project!.id;
      switch (route) {
        case 'memory link': {
          if (values.symbol?.length !== 1) throw new Error('Supply exactly one --symbol');
          output = new RetrievalService(store,memory,graph).linkMemoryToSymbol(projectId,positionals[2]!,values.symbol[0]!);
          message = JSON.stringify(output,null,2); break;
        }
        case 'retrieve':
        case 'context': {
          const retrieval = new RetrievalService(store,memory,graph);
          const input: RetrievalQuery = {text:positionals[1]!,projectId,
            ...(values.mode === undefined ? {} : {mode:values.mode as RetrievalQuery['mode']}),
            ...(values.tokens === undefined ? {} : {tokenBudget:Number(values.tokens)}),
            ...(values.file === undefined ? {} : {currentFiles:values.file}),
            ...(values.symbol === undefined ? {} : {seedSymbolIds:values.symbol})};
          if (route === 'retrieve') {
            const result = retrieval.retrieve(input,values.limit === undefined ? {} : {limit:Number(values.limit)});
            output = result; message = result.candidates.length ? result.candidates.map((item) =>
              `${item.id} ${item.current ? 'CURRENT' : 'HISTORICAL'} RRF=${item.rrf_score.toFixed(6)} ${item.symbol ? item.symbol.qualifiedName+' '+item.symbol.path : item.memory!.content}`).join('\n') : 'No matching evidence.';
          } else {
            const packet = new ContextCompiler(retrieval).compile(input);
            // JSON is canonical; the text renderer is a view of the same packet.
            console.log(values.json ? serializeContext(packet) : renderContext(packet));
            if (packet.budget.budget_insufficient) process.exitCode = 2;
            return;
          }
          break;
        }
        case 'status':
          output = state;
          message = `Project: ${state.project!.name} (${projectId})\nEvents: ${state.last_sequence}\nActive session: ${state.active_session_id ?? 'none'}\nSessions: ${state.sessions.length}\nCheckpoints: ${state.checkpoints.length}\nLatest checkpoint: ${state.checkpoints.at(-1)?.id ?? 'none'}`;
          break;
        case 'checkpoint': {
          const checkpoint = store.checkpoint(projectId, values.name);
          output = checkpoint;
          message = `Checkpoint: ${checkpoint.id}\nName: ${checkpoint.name}\nThrough event: ${checkpoint.through_sequence}`;
          break;
        }
        case 'resume': {
          const result = store.resume(projectId, values.checkpoint);
          output = result;
          message = `Resumed checkpoint: ${result.checkpoint.id}\nNew session: ${result.session.id}\nCheckpoint context through event: ${result.checkpoint.through_sequence}\nCurrent event sequence: ${result.state.last_sequence}`;
          break;
        }
        case 'session start': {
          const metadata = Object.fromEntries(Object.entries({ provider: values.provider, agent_name: values.agent,
            model_name: values.model, external_session_id: values['external-session-id'], client_name: values.client })
            .filter((entry): entry is [string, string] => entry[1] !== undefined));
          const session = store.startSession(projectId, metadata);
          output = session;
          message = `Session: ${session.id}\nProvider: ${session.provider ?? 'unspecified'}\nAgent: ${session.agent_name ?? 'unspecified'}`;
          break;
        }
        case 'memory add': {
          if (values.content === undefined) throw new Error('--content is required');
          const entity = memory.promoteMemory(projectId, { entityType: entityTypeSchema.parse(values.type),
            content: values.content, sourceEventIds: values['source-event'] ?? [] });
          output = entity;
          message = `Memory: ${entity.id}\nType: ${entity.entity_type}\nStatus: ${entity.status}\n${entity.content}`;
          break;
        }
        case 'memory list': {
          const filter = { ...(values.type === undefined ? {} : { type: entityTypeSchema.parse(values.type) }),
            ...(values.status === undefined ? {} : { status: statusSchema.parse(values.status) }) };
          const entities = memory.listMemory(projectId, filter);
          output = entities;
          message = entities.length ? entities.map((entity) => `${entity.id}  ${entity.entity_type}  ${entity.status}  ${entity.content}`).join('\n') : 'No memory entities';
          break;
        }
        case 'memory supersede': {
          if ((values.with === undefined) === (values.content === undefined)) throw new Error('Supply exactly one of --content or --with');
          const sources = values['source-event'];
          const result = values.with !== undefined
            ? memory.supersedeMemory(projectId, positionals[2]!, { replacementId: values.with,
              ...(sources === undefined ? {} : { sourceEventIds: sources }) })
            : memory.supersedeMemory(projectId, positionals[2]!, { content: values.content!, sourceEventIds: sources ?? [] });
          output = result;
          message = `Superseded: ${result.previous.id}\nReplacement: ${result.replacement.id}\n${result.replacement.content}`;
          break;
        }
        case 'memory resolve': {
          const entity = memory.resolveMemory(projectId, positionals[2]!, values['source-event']);
          output = entity;
          message = `${entity.status}: ${entity.id}\n${entity.content}`;
          break;
        }
        case 'handoff':
          output = memory.generateHandoff(projectId);
          message = '';
          break;
        case 'index': {
          const run = new RepositoryIndexer(store, graph, registry!).index(projectId, root, values.rebuild === undefined ? {} : { rebuild: values.rebuild });
          output = run;
          message = `Index ${run.status}: ${run.files_seen} files, ${run.metrics.files_parsed} parsed, ${run.files_unchanged} reused, ${run.files_deleted} deleted\n${JSON.stringify(run.metrics)}${run.errors.length ? '\n' + run.errors.map((error) => `${error.path}: ${error.message}`).join('\n') : ''}`;
          if (run.status !== 'completed') process.exitCode = 1;
          break;
        }
        case 'code stats':
          output = graph.stats(projectId); message = JSON.stringify(output, null, 2); break;
        case 'code source': {
          const source = graph.getSource(projectId, positionals[2]!); output = source; message = source.content; break;
        }
        case 'code imports': {
          const file = graph.getFile(projectId, positionals[2]!);
          if (!file) throw new Error('Indexed file does not exist');
          output = graph.getImports(projectId, file.id); message = JSON.stringify(output, null, 2); break;
        }
        case 'code symbol':
        case 'code callers':
        case 'code callees': {
          const query = positionals[2]!;
          const direct = graph.getSymbol(projectId, query);
          const candidates = direct ? [direct] : graph.findSymbolsByName(projectId, query);
          if (!candidates.length) throw new Error('No matching symbol');
          if (route === 'code symbol' || candidates.length !== 1) output = { query, ambiguous: candidates.length > 1, candidates };
          else output = route === 'code callers' ? graph.getCallers(projectId, candidates[0]!.logical_symbol_id) : graph.getCallees(projectId, candidates[0]!.logical_symbol_id);
          message = JSON.stringify(output, null, 2); break;
        }
        default: throw new Error('Unknown command');
      }
    }
    console.log(values.json || command === 'handoff' ? JSON.stringify(output, null, 2) : message);
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error(`graphit: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
