import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import process from 'node:process';
import { EventStore } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry, RepositoryIndexer } from '@graphit/indexer';
import { RetrievalService, retrievalMetrics, evidenceQuality } from '@graphit/retrieval';
import { ContextCompiler } from '@graphit/context';

// Disposable benchmark: never adds synthetic memory to the user's project.
const root = mkdtempSync(join(tmpdir(), 'graphit-context-demo-'));
mkdirSync(join(root,'.graphit'));
const store = new EventStore(join(root, '.graphit', 'graphit.db'));
try {
  cpSync(fileURLToPath(new URL('../fixtures/repos/auth-retrieval', import.meta.url)), root, { recursive: true });
  const memory = new MemoryService(store);
  const registry = await createParserRegistry();
  const graph = new CodeGraphService(store, registry);
  const indexer = new RepositoryIndexer(store, graph, registry);
  const project = store.initializeProject(root, 'Authentication context demo').project;
  indexer.index(project.id, root);
  const retrieval = new RetrievalService(store, memory, graph);
  const compiler = new ContextCompiler(retrieval);
  const source = store.appendEvent({ project_id: project.id, session_id: store.getState(project.id).active_session_id,
    event_type: 'conversation.user_message', payload: { content: 'Implement refresh rotation with immutable history and no raw token persistence.' } });
  const add = (entityType, content) => memory.promoteMemory(project.id, { entityType, content, sourceEventIds: [source.id] });
  const goal = add('goal', 'Deliver reliable authentication.');
  const task = add('task', 'Continue implementing refresh rotation.');
  const constraint = add('constraint', 'Never persist raw refresh tokens.');
  const old = add('decision', 'Use Neo4j for history.');
  const decision = memory.supersedeMemory(project.id, old.id, { content: 'Use SQLite WAL to preserve immutable source history.', sourceEventIds: [source.id] }).replacement;
  const test = store.appendEvent({ project_id: project.id, session_id: store.getState(project.id).active_session_id,
    event_type: 'test.result', payload: { status: 'passed', summary: 'Refresh rotation concurrency test passed.', command: 'npm test' } });
  const result = memory.promoteMemory(project.id, { entityType: 'result', content: test.payload.summary, sourceEventIds: [test.id] });
  const symbol = (name) => graph.findSymbolsByName(project.id, name)[0];
  const refresh = symbol('refreshSession');
  retrieval.linkMemoryToSymbol(project.id, task.id, refresh.logical_symbol_id);
  for (let i = 0; i < 18; i++) add('artifact', `Reference ${i}: ` +
    'Refresh rotation background: investigate retry ordering, request lifetimes, token persistence and concurrent session updates. '.repeat(24));
  const required = [goal, task, constraint, decision, result].map((item) => 'memory:' + item.id).concat('symbol:' + refresh.logical_symbol_id);
  const queries = [
    ['where is login handled?', ['symbol:' + symbol('loginHandler').logical_symbol_id]],
    ['what calls createSession?', ['symbol:' + symbol('loginHandler').logical_symbol_id]],
    ['continue implementing refresh rotation', required],
    ['why are we using SQLite?', ['memory:' + decision.id]],
    ['what is affected by changing refreshSession?', ['symbol:' + symbol('createSession').logical_symbol_id, 'symbol:' + symbol('loginHandler').logical_symbol_id]],
  ];
  const retrievalBenchmarks = queries.map(([text, ids]) => {
    const ranked = retrieval.retrieve({ projectId: project.id, text });
    const context = compiler.compile({ projectId: project.id, text, tokenBudget: text.startsWith('continue') ? 2000 : 4000 },
      { requiredEvidenceIds: ids });
    return { query: text, ...retrievalMetrics(ranked.candidates.map((item) => item.id), ids, 10),
      required_ids: ids, ...ranked.metrics, context_quality: evidenceQuality(context.evidence.map((unit)=>unit.id),ids),
      selected_tokens: context.budget.estimated_tokens };
  });
  const budgets = [8000, 4000, 2000, 1000, 500].map((tokenBudget) => {
    const report = compiler.compileWithMetrics({ projectId: project.id, text: 'continue implementing refresh rotation', mode: 'continue', tokenBudget },
      { requiredEvidenceIds: required });
    return { ...report.packet.budget, ...evidenceQuality(report.packet.evidence.map((unit) => unit.id), required),
      compiler_quality: report.quality, evidence_count: report.packet.evidence.length, ...report.metrics };
  });
  const cli = spawnSync(process.execPath,[fileURLToPath(new URL('../packages/cli/dist/index.js',import.meta.url)),
    'context','continue implementing refresh rotation','--mode','continue','--tokens','2000','--json'],{cwd:root,encoding:'utf8'});
  if (cli.status !== 0) throw new Error('Demo CLI failed: '+cli.stderr+' '+cli.stdout);
  const packet = JSON.parse(cli.stdout);
  const cliQuality = evidenceQuality(packet.evidence.map((unit)=>unit.id),required);
  const output = { retrieval: retrievalBenchmarks, budgets, cli: {budget:packet.budget,quality:cliQuality} };
  console.log(JSON.stringify(output, null, 2));
  if (budgets.find((item) => item.requested_tokens === 2000).required_evidence_recall !== 1 || !cliQuality.passed ||
    retrievalBenchmarks.some((item)=>!item.context_quality.passed)) process.exitCode = 1;
} finally {
  store.close();
  rmSync(root, { recursive: true, force: true });
}
