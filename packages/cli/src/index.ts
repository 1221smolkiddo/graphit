#!/usr/bin/env node
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { EventStore } from '@graphit/storage';
import type { ProjectState } from '@graphit/core';
import { MemoryService, entityTypeSchema, statusSchema } from '@graphit/memory';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry, RepositoryIndexer } from '@graphit/indexer';

const usage = `Graphit P2 — evidence-preserving code intelligence

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
  graphit handoff [--json]
  graphit index [path] [--rebuild] [--json]
  graphit code stats [--json]
  graphit code symbol <name-or-id> [--json]
  graphit code callers <name-or-id> [--json]
  graphit code callees <name-or-id> [--json]
  graphit code imports <file> [--json]
  graphit code source <symbol-or-version-id> [--json]

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
      checkpoint: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
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
    },
  });
  if (values.help) { console.log(usage); return; }
  const command = positionals[0];
  const route = command === 'memory' || command === 'session' || command === 'code' ? `${command} ${positionals[1] ?? ''}` : command ?? '';
  const routes: Record<string, { positionalCount: number; options: string[] }> = {
    init: { positionalCount: 1, options: ['name'] }, status: { positionalCount: 1, options: [] },
    checkpoint: { positionalCount: 1, options: ['name'] }, resume: { positionalCount: 1, options: ['checkpoint'] },
    handoff: { positionalCount: 1, options: [] },
    'session start': { positionalCount: 2, options: ['provider', 'agent', 'model', 'external-session-id', 'client'] },
    'memory add': { positionalCount: 2, options: ['type', 'content', 'source-event'] },
    'memory list': { positionalCount: 2, options: ['type', 'status'] },
    'memory supersede': { positionalCount: 3, options: ['content', 'with', 'source-event'] },
    'memory resolve': { positionalCount: 3, options: ['source-event'] },
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
    if (!['json', 'help', ...definition.options].includes(key)) throw new Error(`--${key} is not valid for ${route}`);
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
    const registry = command === 'index' || command === 'code' ? await createParserRegistry() : undefined;
    if (registry) graph.setParserRegistry(registry);
    if (command === 'index' && !store.findProject(root)) store.initializeProject(root, basename(root) || 'project');
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
