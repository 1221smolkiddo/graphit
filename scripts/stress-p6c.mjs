import { mkdirSync, mkdtempSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import console from 'node:console';
import { Session } from 'node:inspector';

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
let sqlProfile = null;
const originalPrepare = SqliteDatabase.prototype.prepare;
if (process.env.GRAPHIT_PROFILE === '1') SqliteDatabase.prototype.prepare = function (sql) {
  const start = performance.now(); const statement = originalPrepare.call(this, sql);
  const key = sql.replace(/\s+/g, ' ').trim();
  const entry = sqlProfile && (sqlProfile[key] ??= { prepare_count: 0, calls: 0, elapsed_ms: 0 });
  if (entry) { entry.prepare_count++; entry.elapsed_ms += performance.now() - start; }
  for (const method of ['get', 'all', 'run']) {
    const operation = statement[method];
    statement[method] = (...args) => {
      const start = performance.now();
      try { return operation(...args); }
      finally { if (entry) { entry.calls++; entry.elapsed_ms += performance.now() - start; } }
    };
  }
  return statement;
};
const measure = (name, operation) => {
  console.error('Starting ' + name);
  sqlProfile = process.env.GRAPHIT_PROFILE === '1' ? {} : null;
  const start = performance.now();
  const result = operation();
  const elapsed_ms = performance.now() - start;
  samples.push({ name, elapsed_ms, memory_after: process.memoryUsage(), ...(result?.metrics ? { index_metrics: result.metrics } : {}),
    ...(sqlProfile ? { sql_profile: sqlProfile } : {}) });
  sqlProfile = null;
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
  let profiler;
  if (process.env.GRAPHIT_PROFILE === '1') {
    profiler = new Session(); profiler.connect();
    profiler.post('Profiler.enable'); profiler.post('Profiler.start');
  }
  measure('unchanged_index', () => indexer.index(id, root));
  if (profiler) {
    const profile = await new Promise((resolve, reject) => profiler.post('Profiler.stop', (error, result) => error ? reject(error) : resolve(result.profile)));
    const counts = new Map();
    for (const [i, sample] of profile.samples.entries()) counts.set(sample, (counts.get(sample) ?? 0) + profile.timeDeltas[i]);
    samples.at(-1).cpu_self_ms = profile.nodes.map(node => ({ function: node.callFrame.functionName,
      file: node.callFrame.url.replaceAll('\\', '/').split('/').slice(-4).join('/'),
      line: node.callFrame.lineNumber + 1, self_ms: (counts.get(node.id) ?? 0) / 1000 }))
      .filter(node => node.self_ms > 0).sort((a, b) => b.self_ms - a.self_ms).slice(0, 40);
    profiler.disconnect();
  }
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
    notes: ['Single local run; not a cross-platform SLA.', 'Unchanged indexing validates graph/source integrity and appends run events; valid graph rows can be reused.',
      'retrieval_ms includes PPR and projection validation; bm25_sql_only isolates FTS5.', 'Memory samples are process-wide; maxRSS is OS high-water mark.'] };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  store?.close();
  rmSync(root, { recursive: true, force: true });
}
