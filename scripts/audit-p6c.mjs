import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import ts from 'typescript';
import { EventStore } from '@graphit/storage';
import { CodeGraphService, auditUnresolved } from '@graphit/codegraph';
import { RepositoryIndexer, createParserRegistry } from '@graphit/indexer';
const root = mkdtempSync(join(tmpdir(), 'graphit-p6c-audit-'));
let store;
try {
  const repository = process.argv.includes('--repository');
  if (repository) {
    const paths = execFileSync('rg', ['--files', 'packages', '-g', '*.ts'], { encoding: 'utf8' }).trim().split(/\r?\n/)
      .filter(path => path.replaceAll('\\', '/').includes('/src/'));
    for (const path of paths) { const destination = join(root, path); mkdirSync(dirname(destination), { recursive: true }); cpSync(path, destination); }
  } else cpSync('fixtures/repos/p6c-resolution', root, { recursive: true });
  mkdirSync(join(root, '.graphit'));
  store = new EventStore(join(root, '.graphit/graphit.db'));
  const id = store.initializeProject(root, 'P6C precision').project.id;
  const registry = await createParserRegistry(); const graphService = new CodeGraphService(store, registry);
  const run = new RepositoryIndexer(store, graphService, registry).index(id, root);
  if (run.status !== 'completed') throw new Error(JSON.stringify(run.errors));
  let graph = graphService.getGraph(id);
  // Re-run the committed resolver over identical extracted evidence. Only the
  // resolver is replaced; audit categorization stays identical before/after.
  let baseline_commit = null;
  if (process.argv.includes('--baseline')) {
    baseline_commit = execFileSync('git', ['rev-parse', '090f93f'], { encoding: 'utf8' }).trim();
    const source = execFileSync('git', ['show', baseline_commit + ':packages/codegraph/src/resolve.ts'], { encoding: 'utf8' });
    const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
      .replace("'./domain.js'", JSON.stringify(new URL('domain.js', import.meta.resolve('@graphit/codegraph')).href))
      .replace("'@graphit/core'", JSON.stringify(import.meta.resolve('@graphit/core')));
    const { assembleGraph } = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));
    graph = assembleGraph(id, graph.files);
  }
  const symbol = id => graph.symbols.find(symbol => symbol.logical_symbol_id === id);
  const calls = graph.edges.filter(edge => edge.edge_type === 'CALLS').map(edge => ({
    from: symbol(edge.source_id).qualifiedName, to: symbol(edge.target_id).path + ':' + symbol(edge.target_id).qualifiedName,
  })).sort((a, b) => a.from.localeCompare(b.from));
  const allowed = ['aliasCall', 'namespaceCall', 'barrelCall', 'chainCall', 'namespaceBarrelCall'];
  const audit = auditUnresolved(graph);
  const result = { fixture: repository ? 'current packages/*/src/**/*.ts snapshot' : 'fixtures/repos/p6c-resolution', baseline_commit, measured_at: new Date().toISOString(),
    files: graph.files.length, resolved_edges: graph.edges.filter(edge => edge.classification === 'RESOLVED').length,
    calls, expected_calls: repository ? null : allowed.length,
    false_positive_calls: repository ? null : calls.filter(call => !allowed.includes(call.from) || call.to !== 'leaf.ts:target').length,
    unresolved: { total: audit.total, counts: audit.counts } };
  writeFileSync(resolve(process.argv[2] ?? 'benchmarks/p6c-resolver-after.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { store?.close(); rmSync(root, { recursive: true, force: true }); }
