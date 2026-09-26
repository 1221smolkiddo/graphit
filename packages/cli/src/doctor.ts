import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, contentHash, reconstructState, sha256, verifyEvent, type GraphEvent } from '@graphit/core';
import { migrations, readSourceBlob } from '@graphit/storage';
import { replayMemory } from '@graphit/memory';
import { assembleGraph, logicalSymbolId, replayCodeHistory, validateExtraction, type CodeFile } from '@graphit/codegraph';
import { createParserRegistry } from '@graphit/indexer';
import { searchable } from '@graphit/retrieval';
import { serverVersion, sdkVersion, toolSchemas } from '@graphit/mcp';

/** No EventStore: opening it would set pragmas/migrate. Every SQL statement here is read-only. */
export async function inspectProject(root: string | undefined, projectId?: string) {
  const report = { graphit_version: serverVersion, node_version: process.version, mcp_server_version: serverVersion,
    mcp_sdk_version: sdkVersion, mcp_available: Object.keys(toolSchemas).length === 13,
    project_id: null as string | null, handoff_schema_version: '1', context_schema_version: '1',
    project_initialized: false, database_reachable: false, journal_mode: null as string | null,
    schema_versions: [] as { version: number; name: string }[], schema_valid: false,
    memory_projection_valid: false, memory_entity_count: 0, source_blob_integrity: 'not checked', source_blob_count: 0,
    code_index_present: false, code_projection_valid: false, retrieval_index_present: false, retrieval_projection_valid: false,
    last_index_status: 'none', latest_index_run: null as unknown, errors: [] as string[], warnings: [] as string[] };
  if (!root || !existsSync(join(root, '.graphit', 'graphit.db'))) { report.warnings.push('Not initialized; run graphit init'); return report; }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(join(root, '.graphit', 'graphit.db'), { readOnly: true });
    const database = db;
    database.exec('BEGIN'); // One consistent WAL read snapshot; no repairs or checkpoints.
    report.database_reachable = true;
    report.journal_mode = String(database.prepare('PRAGMA journal_mode').get()?.journal_mode);
    if (report.journal_mode !== 'wal') report.errors.push('Database must use WAL');
    const ledger = database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
    report.schema_versions = ledger.map((item) => ({ version: Number(item.version), name: String(item.name) }));
    report.schema_valid = ledger.length === migrations.length && ledger.every((item, index) => item.version === migrations[index]!.version && item.name === migrations[index]!.name && item.checksum === sha256(migrations[index]!.sql));
    if (!report.schema_valid) throw new Error('Migration ledger mismatch; doctor will not migrate or repair it');
    if (database.prepare('PRAGMA integrity_check').all().some((item) => item.integrity_check !== 'ok')) report.errors.push('SQLite integrity check failed');
    const events = database.prepare('SELECT * FROM events ORDER BY project_id, sequence').all().map((row) => {
      const event = verifyEvent({ ...row, payload: JSON.parse(String(row.payload)) as unknown });
      if (row.payload !== canonicalJson(event.payload)) throw new Error('Non-canonical stored event');
      return event;
    });
    const bindingPath = join(root, '.graphit', 'project.json');
    let selected = projectId;
    if (!selected && existsSync(bindingPath)) {
      const binding: unknown = JSON.parse(readFileSync(bindingPath, 'utf8'));
      if (!binding || typeof binding !== 'object' || Object.keys(binding).join() !== 'project_id' || !('project_id' in binding) || typeof binding.project_id !== 'string') throw new Error('Invalid local project binding');
      selected = binding.project_id;
    }
    selected ??= events.find((event) => event.event_type === 'project.created' && event.payload.root_path === root)?.project_id;
    if (!selected) throw new Error('No project matches this directory');
    const history: GraphEvent[] = events.filter((event) => event.project_id === selected);
    if (!reconstructState(history).project) throw new Error('Project does not exist');
    report.project_id = selected;
    report.project_initialized = true;
    const check = (label: string, operation: () => void): void => { try { operation(); } catch (error) { report.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); } };
    const memory = replayMemory(history);
    report.memory_entity_count = memory.entities.length;
    check('Memory projection', () => {
      const decode = (table: string) => database.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY valid_from_sequence, id`).all(selected!)
        .map((row) => ({ ...row, source_event_ids: JSON.parse(String(row.source_event_ids)) as unknown, metadata: JSON.parse(String(row.metadata)) as unknown }));
      report.memory_projection_valid = canonicalJson({ entities: decode('memory_entities'), relations: decode('memory_relations') }) === canonicalJson(memory);
      if (!report.memory_projection_valid) throw new Error('Rows differ from canonical replay');
    });
    check('Source blobs', () => {
      report.source_blob_integrity = 'failed';
      for (const row of database.prepare('SELECT content_hash FROM source_blobs').all()) { readSourceBlob(database, String(row.content_hash)); report.source_blob_count++; }
      for (const event of history) if (event.event_type === 'code.file.observed') {
        if (readSourceBlob(database, String(event.payload.content_hash)).byte_length !== event.payload.byte_length) throw new Error('Observation size mismatch');
      }
      report.source_blob_integrity = 'ok';
    });
    const codeHistory = replayCodeHistory(history);
    report.latest_index_run = codeHistory.runs.at(-1) ?? null;
    report.last_index_status = codeHistory.runs.at(-1)?.status ?? 'none';
    report.code_index_present = codeHistory.runs.some((run) => run.status === 'completed');
    const parsers = await createParserRegistry();
    const files: CodeFile[] = [];
    check('Code projection', () => {
      for (const observation of [...codeHistory.active.values()].sort((a, b) => a.path < b.path ? -1 : 1)) {
        const bytes = readSourceBlob(database, observation.content_hash).content;
        const parser = parsers.get(observation.language, observation.parser_id, observation.parser_version);
        const extraction = validateExtraction(parser.parse(bytes, observation.path), bytes, observation.path, observation.language);
        files.push({ id: logicalSymbolId(selected!, extraction, extraction.symbols.find((symbol) => symbol.key === '$file')!), observation, extraction });
      }
      const expected = assembleGraph(selected!, files);
      const rows = (table: string, column: string, order: string) => database.prepare(`SELECT ${column} FROM ${table} WHERE project_id = ? ORDER BY ${order}`).all(selected!)
        .map((row) => JSON.parse(String(row[column])) as unknown);
      const cursor = database.prepare('SELECT * FROM code_projection_state WHERE project_id = ?').get(selected!);
      const cached = { files: rows('code_files', 'extraction_json', 'path'), symbols: rows('code_symbols', 'data', 'logical_symbol_id'),
        edges: rows('code_edges', 'data', 'id'), imports: rows('code_imports', 'data', 'id'),
        diagnostics: cursor ? JSON.parse(String(cursor.diagnostics_json)) as unknown : [] };
      report.code_projection_valid = contentHash(cached) === contentHash(expected) && (!codeHistory.last_event_sequence || cursor?.last_event_sequence === codeHistory.last_event_sequence);
      if (!report.code_projection_valid) throw new Error('Rows differ from preserved-source replay');
    });
    check('Retrieval projection', () => {
      const cursor = database.prepare('SELECT document_hash FROM retrieval_projection_state WHERE project_id = ?').get(selected!);
      report.retrieval_index_present = !!cursor;
      if (!cursor) { report.warnings.push('Retrieval index not built; run graphit retrieve'); return; }
      const graph = assembleGraph(selected!, files);
      const sort = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id < b.id ? -1 : 1);
      const expected = { memory: sort(memory.entities.map((entity) => ({ id: entity.id, content: searchable(entity.content), entity_type: entity.entity_type, status: entity.status }))),
        code: sort(graph.symbols.map((symbol) => ({ id: symbol.logical_symbol_id, name: searchable(symbol.name), qualified_name: searchable(symbol.qualifiedName), path: searchable(symbol.path), signature: searchable(symbol.signature ?? '') }))) };
      const rows = (kind: string) => database.prepare(`SELECT * FROM retrieval_${kind}_fts WHERE project_id = ? ORDER BY id`).all(selected!)
        .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'project_id')));
      const digest = contentHash(expected);
      report.retrieval_projection_valid = cursor.document_hash === digest && contentHash({ memory: rows('memory'), code: rows('code') }) === digest;
      if (!report.retrieval_projection_valid) throw new Error('Index is stale or corrupt; rerun retrieval to rebuild');
      database.prepare("SELECT bm25(retrieval_code_fts) FROM retrieval_code_fts WHERE retrieval_code_fts MATCH 'graphit' AND project_id = ?").all(selected!);
    });
    if (!report.code_index_present) report.warnings.push('Code has not been indexed');
  } catch (error) { report.errors.push(error instanceof Error ? error.message : String(error)); }
  finally { db?.close(); }
  return report;
}
