import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, codeEventTypes, contentHash } from '@graphit/core';
import { EventStore, readSourceBlob, type EventProjection } from '@graphit/storage';
import { assembleGraph } from './resolve.js';
import { replayCodeHistory, type CodeHistory } from './replay.js';
import { codePayloadSchemas, emptyGraph, logicalSymbolId, normalizePath, validateExtraction,
  type CodeFile, type CodeGraph, type CodeSymbol, type ExtractedFile, type FileObservation, type IndexRun, type ParserRegistry } from './domain.js';
export * from './domain.js';
export * from './resolve.js';
export * from './replay.js';

interface Snapshot { graph: CodeGraph; runs: IndexRun[]; last_event_sequence: number; graph_hash: string | null }
const tables = ['code_files', 'code_symbols', 'code_edges', 'code_imports', 'code_index_runs', 'code_projection_state'] as const;

export class CodeGraphService {
  #registry: ParserRegistry | undefined;
  readonly #staged = new Map<string, ExtractedFile>();
  constructor(readonly store: EventStore, registry?: ParserRegistry) {
    this.#registry = registry;
    const projection: EventProjection = {
      name: 'code', eventTypes: codeEventTypes,
      rebuild: (database, projectId, events) => {
        const history = replayCodeHistory(events);
        const graph = this.#build(database, projectId, history, [], true);
        this.#persist(database, projectId, graph, history);
      },
      read: (database, projectId) => this.#read(database, projectId),
      onAppend: (database, projectId, events) => {
        const last = events.at(-1)!;
        if (!last.event_type.startsWith('code.')) return;
        const history = replayCodeHistory(events);
        if (last.event_type === 'code.file.observed') {
          const observation = codePayloadSchemas[last.event_type].parse(last.payload);
          if (readSourceBlob(database, observation.content_hash).byte_length !== observation.byte_length) throw new Error('Observation byte length does not match source blob');
        }
        if (last.event_type === 'code.index.completed') {
          const cached = this.#read(database, projectId);
          const graph = this.#build(database, projectId, history, cached.graph.files, false);
          this.#persist(database, projectId, graph, history);
        } else this.#persistRuns(database, projectId, history);
      },
    };
    store.registerProjection(projection);
  }
  setParserRegistry(registry: ParserRegistry): void { this.#registry = registry; }
  stageExtraction(extraction: ExtractedFile): void {
    this.#staged.set(this.#cacheKey(extraction), extraction);
  }
  clearStaged(): void { this.#staged.clear(); }
  #cacheKey(extraction: ExtractedFile): string { return `${extraction.path}:${extraction.contentHash}:${extraction.parserId}:${extraction.parserVersion}`; }
  #parse(observation: FileObservation, bytes: Uint8Array): ExtractedFile {
    if (!this.#registry) throw new Error('A parser registry is required to rebuild code projections');
    const adapter = this.#registry.get(observation.language, observation.parser_id, observation.parser_version);
    return validateExtraction(adapter.parse(bytes, observation.path), bytes, observation.path, observation.language);
  }
  #build(database: DatabaseSync, projectId: string, history: CodeHistory, cached: CodeFile[], force: boolean): CodeGraph {
    const files: CodeFile[] = [];
    for (const observation of [...history.active.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
      const bytes = readSourceBlob(database, observation.content_hash).content;
      const previous = cached.find((file) => file.extraction.path === observation.path && file.observation.content_hash === observation.content_hash && file.observation.parser_version === observation.parser_version && file.observation.parser_id === observation.parser_id);
      const key = `${observation.path}:${observation.content_hash}:${observation.parser_id}:${observation.parser_version}`;
      const candidate = force ? undefined : this.#staged.get(key) ?? previous?.extraction;
      const extraction = candidate ? validateExtraction(candidate, bytes, observation.path, observation.language) : this.#parse(observation, bytes);
      if (extraction.parserId !== observation.parser_id || extraction.parserVersion !== observation.parser_version || extraction.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) throw new Error('Recorded successful index cannot be reconstructed with this parser');
      files.push({ id: logicalSymbolId(projectId, extraction, extraction.symbols.find((symbol) => symbol.key === '$file')!), observation, extraction });
    }
    return assembleGraph(projectId, files);
  }
  #persistRuns(database: DatabaseSync, projectId: string, history: CodeHistory): void {
    database.prepare('DELETE FROM code_index_runs WHERE project_id = ?').run(projectId);
    const insert = database.prepare('INSERT INTO code_index_runs (project_id, index_run_id, started_sequence, data) VALUES (?, ?, ?, ?)');
    for (const run of history.runs) insert.run(projectId, run.index_run_id, run.started_sequence, canonicalJson(run));
    // The graph still corresponds to the latest successful run. Run observations do not publish partial state.
    database.prepare('UPDATE code_projection_state SET last_event_sequence = ? WHERE project_id = ?').run(history.last_event_sequence, projectId);
  }
  #persist(database: DatabaseSync, projectId: string, graph: CodeGraph, history: CodeHistory): void {
    for (const table of tables) database.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    const fileInsert = database.prepare('INSERT INTO code_files (project_id, path, file_id, content_hash, observation_event_id, extraction_hash, extraction_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const file of graph.files) fileInsert.run(projectId, file.extraction.path, file.id, file.observation.content_hash,
      file.observation.event_id, contentHash(file), canonicalJson(file));
    const symbolInsert = database.prepare('INSERT INTO code_symbols (project_id, logical_symbol_id, symbol_version_id, file_id, name, kind, data) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const symbol of graph.symbols) symbolInsert.run(projectId, symbol.logical_symbol_id, symbol.symbol_version_id, symbol.file_id, symbol.name, symbol.kind, canonicalJson(symbol));
    const edgeInsert = database.prepare('INSERT INTO code_edges (project_id, id, source_id, target_id, edge_type, data) VALUES (?, ?, ?, ?, ?, ?)');
    for (const edge of graph.edges) edgeInsert.run(projectId, edge.id, edge.source_id, edge.target_id, edge.edge_type, canonicalJson(edge));
    const importInsert = database.prepare('INSERT INTO code_imports (project_id, id, file_id, data) VALUES (?, ?, ?, ?)');
    for (const item of graph.imports) importInsert.run(projectId, item.id, item.file_id, canonicalJson(item));
    database.prepare('INSERT INTO code_projection_state (project_id, last_event_sequence, graph_hash, diagnostics_json) VALUES (?, ?, ?, ?)')
      .run(projectId, history.last_event_sequence, contentHash(graph), canonicalJson(graph.diagnostics));
    this.#persistRuns(database, projectId, history);
  }
  #read(database: DatabaseSync, projectId: string): Snapshot {
    const rows = (table: string, column: string, order: string): unknown[] => database.prepare(`SELECT ${column} FROM ${table} WHERE project_id = ? ORDER BY ${order}`).all(projectId)
      .map((row) => JSON.parse(String(row[column])) as unknown);
    const state = database.prepare('SELECT * FROM code_projection_state WHERE project_id = ?').get(projectId);
    return { graph: {
      files: rows('code_files', 'extraction_json', 'path') as CodeFile[],
      symbols: rows('code_symbols', 'data', 'logical_symbol_id') as CodeGraph['symbols'],
      edges: rows('code_edges', 'data', 'id') as CodeGraph['edges'],
      imports: rows('code_imports', 'data', 'id') as CodeGraph['imports'],
      diagnostics: state ? JSON.parse(String(state.diagnostics_json)) as CodeGraph['diagnostics'] : [],
    }, runs: rows('code_index_runs', 'data', 'started_sequence') as IndexRun[],
    last_event_sequence: Number(state?.last_event_sequence ?? 0), graph_hash: state ? String(state.graph_hash) : null };
  }
  rebuildCodeProjection(projectId: string): CodeGraph {
    return this.store.withProjectTransaction(projectId, (tx) => (tx.rebuildProjection('code') as Snapshot).graph);
  }
  getGraph(projectId: string): CodeGraph {
    return this.store.withProjectTransaction(projectId, (tx) => {
      const history = replayCodeHistory(tx.readEvents());
      let cached: Snapshot;
      try { cached = tx.readProjection('code') as Snapshot; }
      catch { return (tx.rebuildProjection('code') as Snapshot).graph; }
      if (cached.last_event_sequence !== history.last_event_sequence || cached.graph_hash !== contentHash(cached.graph)) {
        if (!history.last_event_sequence && !cached.graph.files.length) return emptyGraph();
        return (tx.rebuildProjection('code') as Snapshot).graph;
      }
      for (const file of cached.graph.files) this.store.readSourceBlob(file.observation.content_hash);
      return cached.graph;
    });
  }
  getRuns(projectId: string): IndexRun[] { return replayCodeHistory(this.store.readEvents(projectId)).runs; }
  getSymbol(projectId: string, id: string): CodeSymbol | undefined {
    return this.getGraph(projectId).symbols.find((symbol) => symbol.logical_symbol_id === id || symbol.symbol_version_id === id);
  }
  findSymbolsByName(projectId: string, name: string): CodeSymbol[] { return this.getGraph(projectId).symbols.filter((symbol) => symbol.name === name || symbol.qualifiedName === name); }
  getFile(projectId: string, path: string): CodeFile | undefined { return this.getGraph(projectId).files.find((file) => file.extraction.path === normalizePath(path)); }
  getOutgoingEdges(projectId: string, id: string) { return this.getGraph(projectId).edges.filter((edge) => edge.source_id === id); }
  getIncomingEdges(projectId: string, id: string) { return this.getGraph(projectId).edges.filter((edge) => edge.target_id === id); }
  getCallers(projectId: string, id: string) { return this.getIncomingEdges(projectId, id).filter((edge) => edge.edge_type === 'CALLS'); }
  getCallees(projectId: string, id: string) { return this.getOutgoingEdges(projectId, id).filter((edge) => edge.edge_type === 'CALLS'); }
  getImports(projectId: string, fileId: string) { return this.getGraph(projectId).imports.filter((item) => item.file_id === fileId); }
  getDefinitions(projectId: string, fileId: string) {
    const graph = this.getGraph(projectId); const ids = new Set(graph.edges.filter((edge) => edge.source_id === fileId && edge.edge_type === 'DEFINES').map((edge) => edge.target_id));
    return graph.symbols.filter((symbol) => ids.has(symbol.logical_symbol_id));
  }
  getSource(projectId: string, id: string): { symbol: CodeSymbol; content: string; content_hash: string } {
    let symbol = this.getSymbol(projectId, id);
    if (!symbol) {
      const events = this.store.readEvents(projectId);
      const completed = new Set(replayCodeHistory(events).runs.filter((run) => run.status === 'completed').map((run) => run.index_run_id));
      for (const event of events.filter((item) => item.event_type === 'code.file.observed' && completed.has(String(item.payload.index_run_id)))) {
        const observation = { ...codePayloadSchemas['code.file.observed'].parse(event.payload), event_id: event.id, sequence: event.sequence };
        const bytes = this.store.readSourceBlob(observation.content_hash).content;
        const extraction = this.#parse(observation, bytes);
        const historical = assembleGraph(projectId, [{ id: logicalSymbolId(projectId, extraction, extraction.symbols.find((item) => item.key === '$file')!), observation, extraction }]);
        symbol = historical.symbols.find((item) => item.symbol_version_id === id);
        if (symbol) break;
      }
    }
    if (!symbol) throw new Error('Symbol or historical symbol version does not exist in this project');
    const blob = this.store.readSourceBlob(symbol.span.contentHash);
    return { symbol, content: Buffer.from(blob.content).subarray(symbol.span.startByte, symbol.span.endByte).toString('utf8'), content_hash: blob.content_hash };
  }
  stats(projectId: string) {
    const graph = this.getGraph(projectId); const counts: Record<string, number> = {};
    for (const file of graph.files) counts[file.extraction.language] = (counts[file.extraction.language] ?? 0) + 1;
    return { files: graph.files.length, symbols: graph.symbols.length, edges: graph.edges.length, languages: counts,
      unresolved_references: graph.diagnostics.filter((item) => item.code.startsWith('UNRESOLVED_')).length,
      last_index_status: this.getRuns(projectId).at(-1)?.status ?? 'not_indexed', last_index_run: this.getRuns(projectId).at(-1) ?? null };
  }
}
