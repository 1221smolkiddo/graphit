import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteDatabase } from '@graphit/storage';
import { canonicalJson, contentHash, reconstructState, sha256, verifyEvent, type GraphEvent } from '@graphit/core';
import { nodeSupported, supportedNodeRange } from '@graphit/core';
import { migrations, readSourceBlob, assertSchemaObjects } from '@graphit/storage';
import { replayMemory } from '@graphit/memory';
import { assembleGraph, logicalSymbolId, replayCodeHistory, validateExtraction, type CodeFile } from '@graphit/codegraph';
import { createParserRegistry } from '@graphit/indexer';
import { searchable } from '@graphit/retrieval';
import { serverVersion, sdkVersion, toolSchemas } from '@graphit/mcp';

/** No EventStore: opening it would set pragmas/migrate. Every SQL statement here is read-only. */
export async function inspectProject(root: string | undefined, projectId?: string) {
  const report = { graphit_version: serverVersion, node_version: process.version, node_supported: nodeSupported(), supported_node: supportedNodeRange,
    platform: process.platform, architecture: process.arch, better_sqlite3_load: false, sqlite_version: null as string | null,
    integrity_check: 'not checked', migration_status: 'not checked', schema_version: 0, canonical_state_health: 'not checked',
    recovery_guidance: 'Preserve .graphit including WAL/SHM before recovery. Use graphit repair only for derived rows; restore a verified export into a new directory for canonical damage.',
    latest_interrupted_operation: null as unknown, mcp_server_version: serverVersion,
    mcp_sdk_version: sdkVersion, mcp_available: Object.keys(toolSchemas).length === 13,
    project_id: null as string | null, handoff_schema_version: '1', context_schema_version: '1',
    project_initialized: false, database_reachable: false, journal_mode: null as string | null,
    schema_versions: [] as { version: number; name: string }[], schema_valid: false,
    memory_projection_valid: false, memory_entity_count: 0, source_blob_integrity: 'not checked', source_blob_count: 0,
    code_index_present: false, code_projection_valid: false, retrieval_index_present: false, retrieval_projection_valid: false,
    last_index_status: 'none', latest_index_run: null as unknown, errors: [] as string[], warnings: [] as string[] };
  if (!report.node_supported) { report.errors.push(`Unsupported Node.js ${process.version}; Graphit requires ${supportedNodeRange}. Upgrade Node and reinstall Graphit.`); return report; }
  try {
    const probe = new SqliteDatabase(':memory:');
    try {
      report.better_sqlite3_load = true;
      report.sqlite_version = String(probe.prepare('SELECT sqlite_version() AS version').get()?.version);
    } finally { probe.close(); }
  } catch (error) { report.errors.push(String(error)); return report; }
  if (!root || !existsSync(join(root, '.graphit', 'graphit.db'))) { report.warnings.push('Not initialized; run graphit init'); return report; }
  let db: SqliteDatabase | undefined;
  try {
    db = new SqliteDatabase(join(root, '.graphit', 'graphit.db'), { readonly: true });
    const database = db;
    database.exec('BEGIN'); // One consistent WAL read snapshot; no repairs or checkpoints.
    report.database_reachable = true;
    report.integrity_check = 'failed';
    const integrity = database.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') throw new Error('SQLite integrity check failed; preserve database and recover from a verified backup');
    report.integrity_check = 'ok';
    report.journal_mode = String(database.prepare('PRAGMA journal_mode').get()?.journal_mode);
    if (report.journal_mode !== 'wal') report.errors.push('Database must use WAL');
    const ledger = database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
    report.schema_versions = ledger.map((item) => ({ version: Number(item.version), name: String(item.name) }));
    report.schema_version = Number(ledger.at(-1)?.version ?? 0);
    report.migration_status = 'inconsistent';
    const validPrefix = ledger.length > 0 && ledger.length <= migrations.length && ledger.every((item, index) => item.version === migrations[index]!.version && item.name === migrations[index]!.name && item.checksum === sha256(migrations[index]!.sql));
    let schemaObjectsValid = true;
    if (validPrefix) {
      try { assertSchemaObjects(database, ledger.length); }
      catch (error) { schemaObjectsValid = false; report.errors.push(String(error)); }
    }
    if (validPrefix && ledger.length < migrations.length) {
      if (!schemaObjectsValid) return report;
      report.migration_status = 'upgrade required';
      report.errors.push('Recognized older schema; back up .graphit, then run graphit status to apply normal migrations. Doctor does not migrate.');
      return report;
    }
    report.schema_valid = validPrefix && ledger.length === migrations.length && schemaObjectsValid;
    if (!validPrefix) throw new Error('Migration ledger mismatch; doctor will not migrate or repair it');
    report.migration_status = schemaObjectsValid ? 'current' : 'inconsistent';
    report.canonical_state_health = 'failed';
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
    report.canonical_state_health = report.source_blob_integrity === 'ok' ? 'ok' : 'failed';
    report.latest_interrupted_operation = codeHistory.runs.find(run => run.status === 'running') ?? null;
    if (report.latest_interrupted_operation) report.warnings.push('Unfinished index run detected; stop other writers, then run graphit index . --rebuild');
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
      const expected = assembleGraph(selected!, files, file => readSourceBlob(database, file.observation.content_hash).content);
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
      const graph = assembleGraph(selected!, files, file => readSourceBlob(database, file.observation.content_hash).content);
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
