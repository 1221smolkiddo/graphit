import { mkdirSync, mkdtempSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import console from 'node:console';

// Optional installed package root exercises exactly the packed code.
const installed = process.env.GRAPHIT_PACKAGE_ROOT;
const load = (name) => installed ? import(pathToFileURL(join(installed, 'dist', name, 'index.js')).href) : import('@graphit/' + name);
const { EventStore, SqliteDatabase } = await load('storage');
const { MemoryService } = await load('memory');
const { CodeGraphService, assembleGraph } = await load('codegraph');
const { RepositoryIndexer, createParserRegistry } = await load('indexer');
const { RetrievalService } = await load('retrieval');
const { ContextCompiler } = await load('context');
const count = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw new Error('Expected 1..10000 files');
const output = resolve(process.argv[3] ?? 'benchmarks/p6c-stress.json');
const root = mkdtempSync(join(tmpdir(), 'graphit-p6c-stress-'));
const source = (i, changed = false) => Array.from({ length: 20 }, (_, n) =>
  'export function work' + i + '_' + n + '() { return ' + (n ? 'work' + i + '_' + (n - 1) + '()' : changed ? '2' : '1') + '; }').join('\n') + '\n';
const samples = [];
const measure = (name, operation) => {
  console.error('Starting ' + name);
  const start = performance.now();
  const result = operation();
  const elapsed_ms = performance.now() - start;
  samples.push({ name, elapsed_ms, memory_after: process.memoryUsage(), ...(result?.metrics ? { index_metrics: result.metrics } : {}) });
  console.error(name + ': ' + elapsed_ms.toFixed(2) + ' ms');
  if (result?.status && result.status !== 'completed') throw new Error(JSON.stringify(result));
  return result;
};
let store;
try {
  for (let i = 0; i < count; i++) writeFileSync(join(root, 'file' + i + '.ts'), source(i));
  mkdirSync(join(root, '.graphit'));
  const database = join(root, '.graphit', 'graphit.db');
  store = new EventStore(database);
  const id = store.initializeProject(root, 'Deterministic P6C stress').project.id;
  const memory = new MemoryService(store);
  const graph = new CodeGraphService(store, await createParserRegistry());
  const indexer = new RepositoryIndexer(store, graph, await createParserRegistry());
  measure('initial_index', () => indexer.index(id, root));
  const snapshot = measure('read_graph', () => graph.getGraph(id));
  measure('assemble_graph', () => assembleGraph(id, snapshot.files));
  measure('unchanged_index', () => indexer.index(id, root));
  writeFileSync(join(root, 'file0.ts'), source(0, true));
  measure('one_file_index', () => indexer.index(id, root));
  const retrieval = new RetrievalService(store, memory, graph);
  const compiler = new ContextCompiler(retrieval);
  const queries = [];
  for (let i = 0; i < 3; i++) {
    const report = measure('context_' + i, () => compiler.compileWithMetrics({ projectId: id, text: 'work0_19', tokenBudget: 4000, mode: 'code' }));
    queries.push({ cache: i ? 'warm' : 'cold_search_projection', ...report.metrics,
      evidence_count: report.packet.evidence.length, tokens: report.packet.budget.estimated_tokens });
  }
  const bm25 = measure('bm25_sql_only', () => store.withProjectTransaction(id, tx => tx.search('code', ['work0'], 50)));
  const plain = join(root, 'plain.graphit');
  const start = performance.now();
  await store.exportArchive(id, plain, '0.1.0');
  const archive_ms = performance.now() - start;
  const secure = join(root, 'secure.graphit');
  const secureStart = performance.now();
  await store.exportArchive(id, secure, '0.1.0', { passphrase: 'synthetic stress benchmark only' });
  const encrypted_archive_ms = performance.now() - secureStart;
  const db = new SqliteDatabase(database);
  let sizes;
  try {
    const scalar = sql => Number(Object.values(db.prepare(sql).get())[0]);
    sizes = { source_blob_bytes: scalar('SELECT sum(byte_length) FROM source_blobs'),
      // Serialized projection payloads, not SQLite allocated pages (indexes excluded).
      graph_projection_json_bytes: scalar('SELECT sum(length(CAST(extraction_json AS BLOB))) FROM code_files') +
        ['code_symbols', 'code_edges', 'code_imports'].reduce((sum, table) => sum + scalar('SELECT coalesce(sum(length(CAST(data AS BLOB))),0) FROM ' + table), 0),
      archive_bytes: statSync(plain).size, encrypted_archive_bytes: statSync(secure).size };
  } finally { db.close(); }
  store.close(); store = undefined;
  sizes.database_bytes_after_close = statSync(database).size;
  const report = { schema_version: 1, measured_at: new Date().toISOString(), node: process.version,
    platform: process.platform, arch: process.arch, installed_package: !!installed, fixture: { generator: 'scripts/stress-p6c.mjs',
      files: count, functions_per_file: 20, symbols: snapshot.symbols.length, edges: snapshot.edges.length },
    samples, queries, bm25_hit_count: bm25.length, archive_ms, encrypted_archive_ms, sizes,
    peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
    notes: ['Single local run; not a cross-platform SLA.', 'Unchanged indexing still validates and republishes derived projections.',
      'retrieval_ms includes PPR and projection validation; bm25_sql_only isolates FTS5.', 'Memory samples are process-wide; maxRSS is OS high-water mark.'] };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  store?.close();
  rmSync(root, { recursive: true, force: true });
}
