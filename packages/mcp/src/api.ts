import { z } from 'zod';
import { canonicalJson, sessionMetadataSchema, sourcePayloadSchemas, type SessionMetadata, type SourceEventData } from '@graphit/core';
import { EventStore } from '@graphit/storage';
import { MemoryService, entityTypes, relationTypes } from '@graphit/memory';
import { CodeGraphService, normalizePath } from '@graphit/codegraph';
import { RetrievalService, modes, type RetrievalQuery } from '@graphit/retrieval';
import { ContextCompiler } from '@graphit/context';

export const serverVersion = '0.0.0';
export const sdkVersion = '2.1.0';
const id = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(4000).refine((value) => value.trim().length > 0);
const sources = z.array(id).min(1).max(200);
const queryFields = {
  query: text, token_budget: z.number().int().positive().max(1000000).optional(), mode: z.enum(modes).optional(),
  current_files: z.array(z.string().min(1)).max(200).optional(), seed_symbols: z.array(id).max(200).optional(),
};
export const toolSchemas = {
  graphit_status: z.strictObject({}),
  graphit_handoff: z.strictObject({}),
  graphit_context: z.strictObject(queryFields),
  graphit_retrieve: z.strictObject({ ...queryFields, limit: z.number().int().min(1).max(2000).optional() }),
  graphit_find_symbol: z.strictObject({ query: text }),
  graphit_get_source: z.strictObject({ symbol_id: id }),
  graphit_callers: z.strictObject({ symbol_id: id }),
  graphit_callees: z.strictObject({ symbol_id: id }),
  graphit_impact: z.strictObject({ symbol_id: id, query: text.optional(), limit: z.number().int().min(1).max(2000).optional() }),
  graphit_checkpoint: z.strictObject({ name: text.optional() }),
  graphit_record_event: z.strictObject({
    event_type: z.enum(['conversation.user_message', 'conversation.assistant_message', 'tool.call', 'tool.result',
      'command.executed', 'command.result', 'file.changed', 'test.result']),
    payload: z.record(z.string(), z.json()),
  }),
  graphit_add_memory: z.strictObject({ entity_type: z.enum(entityTypes), content: z.string().min(1), source_event_ids: sources }),
  graphit_link_memory: z.strictObject({ from_memory_id: id, to_memory_id: id, relation_type: z.enum(relationTypes), source_event_ids: sources }),
};
export type ToolName = keyof typeof toolSchemas;
export const toolDescriptions: Record<ToolName, string> = {
  graphit_status: 'Read the selected project, sessions and checkpoints reconstructed from events.',
  graphit_handoff: 'Get provider-neutral durable memory and its exact provenance for continuation.',
  graphit_context: 'Compile the canonical P3 context packet. Check budget.budget_insufficient; no evidence is fabricated.',
  graphit_retrieve: 'Retrieve ranked memory/code evidence and graph paths in the selected project.',
  graphit_find_symbol: 'Find current symbols by exact name, qualified name or ID; preserve ambiguity.',
  graphit_get_source: 'Read only preserved immutable source for a current symbol or historical version ID.',
  graphit_callers: 'Find evidenced incoming CALLS edges for a current symbol.',
  graphit_callees: 'Find evidenced outgoing CALLS edges for a current symbol.',
  graphit_impact: 'Run bounded P3 impact retrieval seeded by a current symbol; not exhaustive dataflow analysis.',
  graphit_checkpoint: 'Append an immutable checkpoint for the selected project.',
  graphit_record_event: 'Append a validated source event. Command/tool records are data only; nothing is executed. No automatic memory promotion.',
  graphit_add_memory: 'Explicitly promote a durable P1 memory with same-project source_event_ids; deterministic and retry-idempotent.',
  graphit_link_memory: 'Explicitly link two same-project P1 memories with provenance; deterministic and retry-idempotent.',
};
export const writeTools = new Set<ToolName>(['graphit_checkpoint', 'graphit_record_event', 'graphit_add_memory', 'graphit_link_memory']);

/** Transport-independent, project-bound API. No client input can select another database/project. */
export class GraphitApi {
  readonly retrieval: RetrievalService;
  readonly compiler: ContextCompiler;
  readonly metadata: SessionMetadata;
  constructor(readonly store: EventStore, readonly projectId: string, readonly memory: MemoryService,
    readonly graph: CodeGraphService, metadata: SessionMetadata = {}) {
    store.getState(projectId);
    this.metadata = sessionMetadataSchema.parse(metadata);
    this.retrieval = new RetrievalService(store, memory, graph);
    this.compiler = new ContextCompiler(this.retrieval);
  }

  startSession(): void { this.store.withWriterSession(this.projectId, this.metadata, () => undefined); }
  doctor() { return { ...this.store.diagnostics(this.projectId), project_id: this.projectId,
    mcp_server_version: serverVersion, mcp_sdk_version: sdkVersion, handoff_schema_version: '1', context_schema_version: '1' }; }

  #query(input: z.infer<typeof toolSchemas.graphit_context>): RetrievalQuery {
    return { text: input.query, projectId: this.projectId,
      ...(input.token_budget === undefined ? {} : { tokenBudget: input.token_budget }),
      ...(input.mode === undefined ? {} : { mode: input.mode }),
      ...(input.current_files === undefined ? {} : { currentFiles: input.current_files.map(normalizePath) }),
      ...(input.seed_symbols === undefined ? {} : { seedSymbolIds: input.seed_symbols }) };
  }
  #symbol(symbolId: string) {
    const symbol = this.graph.getSymbol(this.projectId, symbolId);
    if (!symbol) throw new Error('Symbol does not exist in the selected project');
    return symbol;
  }

  call(name: ToolName, raw: unknown): unknown {
    // This validation also protects direct users of the transport-independent API.
    toolSchemas[name].parse(raw);
    const operation = (): unknown => this.#call(name, raw);
    return writeTools.has(name) ? this.store.withWriterSession(this.projectId, this.metadata, operation) : operation();
  }

  #call(name: ToolName, raw: unknown): unknown {
    const projectId = this.projectId;
    switch (name) {
      case 'graphit_status': return this.store.getState(projectId);
      case 'graphit_handoff': return this.memory.generateHandoff(projectId);
      case 'graphit_context': return this.compiler.compile(this.#query(toolSchemas[name].parse(raw)));
      case 'graphit_retrieve': {
        const input = toolSchemas[name].parse(raw);
        return this.retrieval.retrieve(this.#query(input), input.limit === undefined ? {} : { limit: input.limit });
      }
      case 'graphit_find_symbol': {
        const { query } = toolSchemas[name].parse(raw);
        const direct = this.graph.getSymbol(projectId, query);
        const candidates = direct ? [direct] : this.graph.findSymbolsByName(projectId, query);
        if (!candidates.length) throw new Error('No matching symbol in the selected project');
        return { query, ambiguous: candidates.length > 1, candidates };
      }
      case 'graphit_get_source': return this.graph.getSource(projectId, toolSchemas[name].parse(raw).symbol_id);
      case 'graphit_callers':
      case 'graphit_callees': {
        const symbol = this.#symbol(toolSchemas[name].parse(raw).symbol_id);
        return { symbol_id: symbol.logical_symbol_id, edges: name === 'graphit_callers'
          ? this.graph.getCallers(projectId, symbol.logical_symbol_id) : this.graph.getCallees(projectId, symbol.logical_symbol_id) };
      }
      case 'graphit_impact': {
        const input = toolSchemas[name].parse(raw);
        const symbol = this.#symbol(input.symbol_id);
        return this.retrieval.retrieve({ projectId, text: input.query ?? `impact ${symbol.name}`, mode: 'impact', seedSymbolIds: [symbol.logical_symbol_id] },
          input.limit === undefined ? {} : { limit: input.limit });
      }
      case 'graphit_checkpoint': return this.store.checkpoint(projectId, toolSchemas[name].parse(raw).name);
      case 'graphit_record_event': {
        const input = toolSchemas[name].parse(raw);
        const payload = sourcePayloadSchemas[input.event_type].parse(input.payload);
        if (input.event_type === 'file.changed') normalizePath(String(input.payload.path));
        const event = { event_type: input.event_type, payload } as SourceEventData;
        return this.store.withProjectTransaction(projectId, (tx) => tx.append(event));
      }
      case 'graphit_add_memory': {
        const input = toolSchemas[name].parse(raw);
        return this.memory.promoteMemory(projectId, { entityType: input.entity_type, content: input.content, sourceEventIds: input.source_event_ids });
      }
      case 'graphit_link_memory': {
        const input = toolSchemas[name].parse(raw);
        return this.memory.linkMemory(projectId, { fromEntityId: input.from_memory_id, toEntityId: input.to_memory_id,
          relationType: input.relation_type, sourceEventIds: input.source_event_ids });
      }
    }
  }

  resource(uri: string): string {
    switch (uri) {
      case 'graphit://project/status': return canonicalJson(this.store.getState(this.projectId));
      case 'graphit://project/handoff': return canonicalJson(this.memory.generateHandoff(this.projectId));
      case 'graphit://memory/current': {
        const memory = this.memory.getMemoryState(this.projectId);
        return canonicalJson({ ...memory, entities: memory.entities.filter((item) => item.valid_to_sequence === null) });
      }
      default: throw new Error('Unknown Graphit resource');
    }
  }
}
