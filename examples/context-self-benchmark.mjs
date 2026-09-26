import { realpathSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import { join } from 'node:path';
import { EventStore } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry } from '@graphit/indexer';
import { RetrievalService } from '@graphit/retrieval';
import { ContextCompiler } from '@graphit/context';

const root = realpathSync(process.cwd());
const store = new EventStore(join(root, '.graphit', 'graphit.db'));
try {
  const memory = new MemoryService(store);
  const graph = new CodeGraphService(store, await createParserRegistry());
  const project = store.findProject(root)?.project;
  if (!project) throw new Error('Index this repository first');
  const retrieval = new RetrievalService(store, memory, graph);
  const compiler = new ContextCompiler(retrieval);
  const ranked = retrieval.retrieve({ projectId: project.id, text: 'handoff' }, { limit: 10 });
  const contexts = [
    { text: 'how does Graphit preserve source history?', tokenBudget: 2000 },
    { text: 'continue current Graphit work', mode: 'continue', tokenBudget: 1500 },
  ].map((query) => {
    const report = compiler.compileWithMetrics({ projectId: project.id, ...query });
    return { query, ...report.packet.budget, ...report.metrics, quality: report.quality,
      memory_evidence: report.packet.evidence.filter((item) => item.provenance === 'canonical_memory').length,
      source_paths: report.packet.evidence.filter((item) => item.kind === 'source').map((item) => item.path) };
  });
  console.log(JSON.stringify({ graph: graph.stats(project.id), retrieval: { query: 'handoff', ...ranked.metrics,
    candidates: ranked.candidates.map((item) => ({ id: item.id, name: item.symbol?.qualifiedName, path: item.symbol?.path })) }, contexts }, null, 2));
} finally { store.close(); }
