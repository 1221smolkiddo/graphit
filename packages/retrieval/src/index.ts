import { performance } from 'node:perf_hooks';
import { contentHash, reconstructState, type GraphEvent, type Project } from '@graphit/core';
import { EventStore, type SearchDocuments } from '@graphit/storage';
import { MemoryService, memoryEntityId, memoryRelationId, replayMemory, type MemoryEntity, type Metadata } from '@graphit/memory';
import { CodeGraphService, type CodeSymbol } from '@graphit/codegraph';
import { compareIds, lexicalTerms, normalizeQuery, retrievalConfig, searchable, type Candidate, type GraphPath,
  type NormalizedQuery, type RetrievalConfig, type RetrievalEdge, type RetrievalQuery } from './domain.js';
import { personalizedPageRank, reciprocalRankFusion, type RankedList } from './ranking.js';
export * from './domain.js';
export * from './ranking.js';
export * from './metrics.js';

export interface RetrievalResult {
  project: Project; query: NormalizedQuery; candidates: Candidate[]; paths: GraphPath[];
  diagnostics: { channels: RankedList[]; ambiguous_exact_ids: string[]; historical_available: number; no_results: boolean;
    expanded_nodes: number; ppr_iterations: number; index_rebuilt: boolean; config: RetrievalConfig; warnings: string[] };
  metrics: { retrieval_ms: number; ppr_ms: number };
}
const currentMemory = (item: MemoryEntity): boolean => item.valid_to_sequence === null &&
  (['active','in_progress'].includes(item.status) || item.entity_type === 'result');
const key = (id: string, kind: 'memory' | 'symbol') => kind + ':' + id;
export class RetrievalService {
  readonly config: RetrievalConfig;
  constructor(readonly store: EventStore, readonly memory: MemoryService, readonly graph: CodeGraphService, config: Partial<RetrievalConfig> = {}) {
    this.config = retrievalConfig(config);
  }

  /** Explicit code artifact + P1 relation; both appends share one transaction. */
  linkMemoryToSymbol(projectId: string, memoryId: string, symbolId: string): { artifact_id: string; relation_id: string } {
    const sequence = this.store.getState(projectId).last_sequence;
    const symbol = this.graph.getSymbol(projectId, symbolId);
    if (!symbol) throw new Error('Symbol does not exist in this project');
    return this.store.withProjectTransaction(projectId, (tx) => {
      const events = tx.readEvents(); const state = replayMemory(events);
      if (events.at(-1)?.sequence !== sequence) throw new Error('Project changed during linking; retry');
      const from = state.entities.find((item) => item.id === memoryId);
      if (!from || !currentMemory(from)) throw new Error('Current memory entity does not exist in this project');
      const evidence = events.find((event) => event.id === symbol.observation_event_id);
      if (!evidence || evidence.event_type !== 'code.file.observed' || evidence.payload.content_hash !== symbol.span.contentHash) throw new Error('Invalid symbol provenance');
      const metadata: Metadata = { graphit_code_link: { symbol_id: symbol.logical_symbol_id, symbol_version_id: symbol.symbol_version_id,
        observation_event_id: symbol.observation_event_id, content_hash: symbol.span.contentHash, path: symbol.path } };
      const input = { entityType: 'artifact' as const, content: symbol.qualifiedName + ' — ' + symbol.path,
        sourceEventIds: [symbol.observation_event_id], metadata };
      const artifact_id = memoryEntityId(projectId, input);
      if (!state.entities.some((item) => item.id === artifact_id)) tx.append({ event_type: 'memory.entity.created',
        payload: { entity_id: artifact_id, entity_type: 'artifact', content: input.content, source_event_ids: input.sourceEventIds, metadata } });
      const sources = [...new Set([...from.source_event_ids, symbol.observation_event_id])].sort();
      const relationMetadata: Metadata = { link_type: 'TARGETS' };
      const relation_id = memoryRelationId(projectId,memoryId,artifact_id,'RELATED_TO',sources,relationMetadata);
      if (!state.relations.some((item) => item.id === relation_id)) tx.append({ event_type: 'memory.entity.linked',
        payload: { relation_id, from_entity_id: memoryId, to_entity_id: artifact_id, relation_type: 'RELATED_TO',
          source_event_ids: sources, metadata: relationMetadata } });
      return { artifact_id, relation_id };
    });
  }

  retrieve(input: RetrievalQuery, options: { limit?: number; rebuild?: boolean } = {}): RetrievalResult {
    const start = performance.now(); const query = normalizeQuery(input);
    const limit = options.limit ?? this.config.maxCandidates;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new Error('Invalid retrieval limit');
    // Graph reads validate immutable source. Compare sequence under the final lock to reject mixed snapshots.
    const initial = this.store.getState(query.projectId);
    const projectTerms = new Set(lexicalTerms(initial.project!.name));
    query.terms = query.terms.filter((term) => !projectTerms.has(term) && !(query.mode === 'continue' && term === 'continue'));
    const graph = this.graph.getGraph(query.projectId);
    const historicalSymbols: CodeSymbol[] = [];
    for (const id of query.seedSymbolIds) if (!graph.symbols.some((symbol) => symbol.logical_symbol_id === id || symbol.symbol_version_id === id)) {
      historicalSymbols.push(this.graph.getSource(query.projectId,id).symbol);
    }
    return this.store.withProjectTransaction(query.projectId, (tx) => {
      const events = tx.readEvents(); const state = reconstructState(events);
      if (!state.project || state.last_sequence !== initial.last_sequence) throw new Error('Project changed during retrieval; retry');
      if (query.activeSessionId && !state.sessions.some((session) => session.id === query.activeSessionId)) throw new Error('Session does not exist in this project');
      const memory = replayMemory(events);
      const documents: SearchDocuments = {
        memory: memory.entities.map((entity) => ({ id: entity.id, content: searchable(entity.content), entity_type: entity.entity_type, status: entity.status })),
        code: graph.symbols.map((symbol) => ({ id: symbol.logical_symbol_id, name: searchable(symbol.name),
          qualified_name: searchable(symbol.qualifiedName), path: searchable(symbol.path), signature: searchable(symbol.signature ?? '') })),
      };
      const rebuilt = tx.ensureSearch(documents, options.rebuild);
      const candidates = new Map<string,Candidate>();
      const addSymbol = (symbol: CodeSymbol, current: boolean) => {
        const id = key(current ? symbol.logical_symbol_id : symbol.symbol_version_id,'symbol');
        candidates.set(id,{ id,kind:'symbol',current,symbol,rankings:[],rrf_score:0,ppr_score:0,relevance:0,priority:2 }); return id;
      };
      const addMemory = (item: MemoryEntity) => {
        const id = key(item.id,'memory'); candidates.set(id,{ id,kind:'memory',current:currentMemory(item),memory:item,
          rankings:[],rrf_score:0,ppr_score:0,relevance:0,priority:2 }); return id;
      };
      for (const symbol of graph.symbols) if (query.mode !== 'memory') addSymbol(symbol,true);
      for (const item of memory.entities) if (query.mode !== 'code' && (currentMemory(item) || query.includeHistorical || query.seedMemoryIds.includes(item.id))) addMemory(item);
      const explicit: string[] = [];
      for (const id of query.seedSymbolIds) {
        const symbol = graph.symbols.find((item) => item.logical_symbol_id === id || item.symbol_version_id === id);
        const historical = historicalSymbols.find((item) => item.symbol_version_id === id);
        if (!symbol && !historical) throw new Error('Invalid symbol seed');
        explicit.push(addSymbol((symbol ?? historical)!,!!symbol));
      }
      for (const id of query.seedMemoryIds) {
        const item = memory.entities.find((entity) => entity.id === id);
        if (!item) throw new Error('Memory seed does not exist in this project');
        explicit.push(addMemory(item));
      }
      for (const path of query.currentFiles) {
        const file = graph.files.find((item) => item.extraction.path === path);
        if (!file) throw new Error('File seed does not exist in current graph');
        explicit.push(addSymbol(graph.symbols.find((symbol) => symbol.logical_symbol_id === file.id)!,true));
      }
      const symbols = [...candidates.values()].filter((item) => item.symbol);
      const phrase = query.text.toLowerCase();
      const words = query.text.match(/[\p{L}\p{N}_.$/\\-]+/gu)?.map((word) => word.toLowerCase()) ?? [];
      const exact = symbols.filter((item) => {
        const symbol = item.symbol!;
        return [...(symbol.kind === 'module' ? [] : [symbol.name,symbol.qualifiedName]),symbol.logical_symbol_id,symbol.symbol_version_id].some((name) =>
          name.toLowerCase() === phrase || (['function','method','class','interface','type'].includes(symbol.kind) && words.includes(name.toLowerCase())));
      }).map((item) => item.id).sort();
      const pathMatches = symbols.filter((item) => item.symbol!.kind === 'file' &&
        (item.symbol!.path.toLowerCase() === phrase.replaceAll('\\','/') ||
          item.symbol!.path.toLowerCase().includes(phrase.replaceAll('\\','/')))).map((item) => item.id).sort();
      const rank = (channel: string, ids: string[]): RankedList => ({ channel,entries: [...new Set(ids)].map((id) => ({id})) });
      const lists: RankedList[] = [rank('explicit',explicit),rank('exact',exact),rank('path',pathMatches)];
      lists.push({channel:'symbol_terms',entries:symbols.filter((item) => ['function','method','class','interface','type'].includes(item.symbol!.kind)).map((item) => ({id:item.id,
        score:lexicalTerms(item.symbol!.name).filter((term) => query.terms.includes(term)).length}))
        .filter((item) => item.score > 0).sort((a,b) => b.score-a.score || compareIds(a.id,b.id))});
      for (const kind of ['code','memory'] as const) {
        if ((query.mode === 'code' && kind === 'memory') || (query.mode === 'memory' && kind === 'code')) continue;
        const hits = tx.search(kind,query.terms,this.config.maxCandidates*4);
        lists.push({channel:'bm25_'+kind,entries:hits.map((hit) => ({id:key(hit.id,kind === 'code' ? 'symbol' : 'memory'),score:hit.score})).filter((hit) => candidates.has(hit.id)).slice(0,this.config.maxCandidates)});
      }
      const stateOrder = ['goal','task','constraint','blocker','decision','result','question'];
      const active = [...candidates.values()].filter((item) => item.memory && currentMemory(item.memory) && stateOrder.includes(item.memory.entity_type))
        .sort((a,b) => stateOrder.indexOf(a.memory!.entity_type)-stateOrder.indexOf(b.memory!.entity_type) ||
          b.memory!.valid_from_sequence-a.memory!.valid_from_sequence || compareIds(a.id,b.id)).slice(0,30);
      lists.push(rank('project_state',active.map((item) => item.id)));
      if (query.mode === 'continue') lists.push(rank('continue',active.filter((item) => !query.activeSessionId || item.memory!.created_by_session_id === query.activeSessionId).map((item) => item.id)));
      const edges: RetrievalEdge[] = graph.edges.map((edge) => ({ id:edge.id,from:key(edge.source_id,'symbol'),to:key(edge.target_id,'symbol'),
        type:edge.edge_type,source_event_ids:[edge.observation_event_id],span:edge.span }));
      for (const relation of memory.relations) {
        if (relation.valid_to_sequence !== null || relation.relation_type === 'SUPERSEDES') continue;
        edges.push({id:relation.id,from:key(relation.from_entity_id,'memory'),to:key(relation.to_entity_id,'memory'),
          type:relation.relation_type,source_event_ids:relation.source_event_ids});
      }
      // Only explicit artifacts with validated source references bridge the two graphs.
      const sourceEvents = new Map(events.map((event) => [event.id,event]));
      for (const entity of memory.entities) {
        const link = entity.metadata.graphit_code_link;
        if (entity.entity_type !== 'artifact' || !link || typeof link !== 'object' || Array.isArray(link)) continue;
        const symbol = graph.symbols.find((item) => item.logical_symbol_id === link.symbol_id);
        const observation = sourceEvents.get(String(link.observation_event_id));
        if (!symbol || !observation || observation.event_type !== 'code.file.observed' ||
          observation.payload.content_hash !== link.content_hash || observation.payload.path !== link.path || symbol.path !== link.path ||
          !entity.source_event_ids.includes(observation.id)) continue;
        edges.push({id:contentHash({domain:'graphit:target:v1',entity:entity.id,symbol:symbol.logical_symbol_id}),
          from:key(entity.id,'memory'),to:key(symbol.logical_symbol_id,'symbol'),type:'TARGETS',source_event_ids:entity.source_event_ids});
      }
      const currentEdges = edges.filter((edge) => candidates.get(edge.from)?.current && candidates.get(edge.to)?.current);
      const seeds = [...new Set([...explicit,...exact,...pathMatches,
        ...lists.filter((list) => list.channel.startsWith('bm25')).flatMap((list) => list.entries.slice(0,8).map((entry) => entry.id)),
        ...active.filter((item) => ['goal','task'].includes(item.memory!.entity_type)).slice(0,8).map((item) => item.id)])]
        .filter((id) => candidates.get(id)?.current);
      const pprStart = performance.now(); const expansion = personalizedPageRank(seeds,currentEdges,this.config,query.mode === 'impact');
      const ppr_ms = performance.now()-pprStart;
      const ppr = [...expansion.scores].filter(([,score]) => score >= this.config.minGraphScore)
        .sort((a,b) => b[1]-a[1] || compareIds(a[0],b[0]));
      lists.push({channel:'ppr',entries:ppr.map(([id,score]) => ({id,score}))});
      if (query.mode === 'impact') lists.push(rank('reverse_impact',expansion.ids.filter((id) => expansion.paths.get(id)!.length > 0)
        .sort((a,b) => expansion.paths.get(a)!.length-expansion.paths.get(b)!.length || compareIds(a,b))));
      const fused = reciprocalRankFusion(lists,this.config.rrfK);
      const explicitSet = new Set(explicit);
      const exactSet = new Set([...exact,...pathMatches.filter((id) => candidates.get(id)!.symbol!.path.toLowerCase() === phrase.replaceAll('\\','/'))]);
      const ranked = fused.map((item) => ({...candidates.get(item.id)!, rankings:item.rankings,rrf_score:item.score,ppr_score:expansion.scores.get(item.id) ?? 0,
        priority:explicitSet.has(item.id) ? 0 : exactSet.has(item.id) ? 1 :
          query.mode === 'impact' && (expansion.paths.get(item.id)?.length ?? 0) > 0 ? 2 : 3,relevance:0}))
        .sort((a,b) => a.priority-b.priority || b.rrf_score-a.rrf_score || compareIds(a.id,b.id)).slice(0,Math.min(limit,this.config.maxCandidates));
      const max = Math.max(1e-12,...ranked.map((item) => item.rrf_score));
      for (const item of ranked) item.relevance = item.priority < 2 ? 1 : item.rrf_score/max;
      const paths: GraphPath[] = [];
      // Edges between two seed nodes still matter even when both have a zero-hop BFS path.
      const rankedIds = new Set(ranked.map((item) => item.id));
      for (const edge of currentEdges.filter((edge) => rankedIds.has(edge.from) && rankedIds.has(edge.to))
        .sort((a,b) => (this.config.edgeWeights[b.type] ?? 1)-(this.config.edgeWeights[a.type] ?? 1) || compareIds(a.id,b.id)).slice(0,20)) {
        paths.push({id:contentHash({domain:'graphit:path:v1',edges:[edge.id]}),edges:[edge],
          nodes:[edge.from,edge.to].map((id) => { const node = candidates.get(id)!; return {id,label:node.symbol?.qualifiedName ?? node.memory!.entity_type,
            ...(node.symbol ? {path:node.symbol.path} : {})}; })});
      }
      for (const candidate of ranked) {
        const path = expansion.paths.get(candidate.id);
        if (!path?.length) continue;
        const ids = [...new Set(path.flatMap((edge) => [edge.from,edge.to]))];
        paths.push({id:contentHash({domain:'graphit:path:v1',edges:path.map((edge) => edge.id)}),
          nodes:ids.map((id) => { const node = candidates.get(id)!; return {id,label:node.symbol?.qualifiedName ?? node.memory!.entity_type,
            ...(node.symbol ? {path:node.symbol.path} : {})}; }),edges:path});
      }
      return { project:state.project,query,candidates:ranked,paths:[...new Map(paths.map((path) => [path.id,path])).values()],
        diagnostics:{channels:lists,ambiguous_exact_ids:exact.length > 1 ? exact : [],historical_available:memory.entities.filter((item) => !currentMemory(item)).length,
          no_results:ranked.length === 0,expanded_nodes:expansion.ids.length,ppr_iterations:expansion.iterations,index_rebuilt:rebuilt,config:this.config,
          warnings:query.mode === 'continue' && !active.some((item) => ['goal','task'].includes(item.memory!.entity_type)) ? ['No current goal or task has been recorded; continuation state is unavailable.'] : []},
        metrics:{retrieval_ms:performance.now()-start,ppr_ms} };
    });
  }
  rebuildSearchProjection(projectId: string): void { this.retrieve({projectId,text:'rebuild search projections'}, {rebuild:true}); }
  readEvidenceBytes(hash: string): Uint8Array { return this.store.readSourceBlob(hash).content; }
  readEvents(projectId: string): GraphEvent[] { return this.store.readEvents(projectId); }
}
