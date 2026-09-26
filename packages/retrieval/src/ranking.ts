import { compareIds, lexicalTerms, type Ranking, type RetrievalConfig, type RetrievalEdge } from './domain.js';

export interface RankedList { channel: string; entries: { id: string; score?: number }[] }
export function reciprocalRankFusion(lists: readonly RankedList[], k = 60): { id: string; score: number; rankings: Ranking[] }[] {
  if (!Number.isFinite(k) || k <= 0) throw new Error('RRF k must be positive');
  const records = new Map<string, { id: string; score: number; rankings: Ranking[] }>();
  if (new Set(lists.map((list) => list.channel)).size !== lists.length) throw new Error('Duplicate ranking channel');
  for (const list of lists) {
    const seen = new Set<string>(); let rank = 0;
    for (const item of list.entries) {
      if (seen.has(item.id)) continue; seen.add(item.id); rank++;
      const entry = records.get(item.id) ?? { id: item.id, score: 0, rankings: [] };
      entry.score += 1 / (k + rank);
      entry.rankings.push({ channel: list.channel, rank, raw_score: item.score ?? null }); records.set(item.id, entry);
    }
  }
  return [...records.values()].sort((a,b) => b.score - a.score || compareIds(a.id,b.id));
}
export interface Expansion { ids: string[]; paths: Map<string, RetrievalEdge[]>; scores: Map<string, number>; iterations: number }
export function personalizedPageRank(seeds: readonly string[], edges: readonly RetrievalEdge[], config: RetrievalConfig, reverse = false): Expansion {
  const adjacency = new Map<string, { to: string; edge: RetrievalEdge }[]>();
  const connect = (from: string, to: string, edge: RetrievalEdge) => {
    const entries = adjacency.get(from) ?? []; entries.push({ to, edge }); adjacency.set(from, entries);
  };
  const impactTypes = new Set(['CALLS','REFERENCES','IMPORTS','DEPENDS_ON','TARGETS','BLOCKS','VERIFIED_BY','DEFINES','CONTAINS']);
  for (const edge of [...edges].sort((a,b) => compareIds(a.id,b.id))) {
    if (reverse) { if (impactTypes.has(edge.type)) connect(edge.to, edge.from, edge); }
    else { connect(edge.from,edge.to,edge); connect(edge.to,edge.from,edge); }
  }
  const initial = [...new Set(seeds)].sort().slice(0, config.maxCandidates);
  const paths = new Map<string, RetrievalEdge[]>(initial.map((id) => [id, []]));
  let frontier = initial;
  for (let hop = 0; hop < config.maxHops && paths.size < config.maxCandidates; hop++) {
    const next: string[] = [];
    for (const id of frontier) for (const item of adjacency.get(id) ?? []) {
      if (paths.has(item.to) || paths.size >= config.maxCandidates) continue;
      paths.set(item.to, [...paths.get(id)!, item.edge]); next.push(item.to);
    }
    frontier = next.sort();
  }
  const ids = [...paths.keys()].sort(); const personalization = new Map(initial.map((id) => [id, 1 / initial.length]));
  let scores = new Map(ids.map((id) => [id, personalization.get(id) ?? 0])); let iterations = 0;
  if (!ids.length) return { ids, paths, scores, iterations };
  for (; iterations < config.maxIterations; iterations++) {
    const next = new Map(ids.map((id) => [id, (1-config.damping)*(personalization.get(id) ?? 0)]));
    let dangling = 0;
    for (const id of ids) {
      const neighbors = (adjacency.get(id) ?? []).filter((item) => paths.has(item.to));
      const total = neighbors.reduce((sum,item) => sum + (config.edgeWeights[item.edge.type] ?? 1), 0);
      if (!total) { dangling += scores.get(id)!; continue; }
      for (const item of neighbors) next.set(item.to, next.get(item.to)! +
        config.damping * scores.get(id)! * (config.edgeWeights[item.edge.type] ?? 1) / total);
    }
    for (const id of ids) next.set(id, next.get(id)! + config.damping * dangling * (personalization.get(id) ?? 0));
    const error = ids.reduce((sum,id) => sum + Math.abs(next.get(id)! - scores.get(id)!), 0);
    scores = next;
    if (error < config.tolerance) { iterations++; break; }
  }
  return { ids, paths, scores, iterations };
}
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a); const right = new Set(b);
  const intersection = [...left].filter((item) => right.has(item)).length;
  return left.size + right.size - intersection ? intersection / (left.size + right.size - intersection) : 0;
}
export interface SimilarityItem {
  id: string; content: string; relevance_score: number; symbol_ids?: string[]; memory_ids?: string[];
  source_event_ids: string[]; path?: string; source_blob_hash?: string; source_span?: { startByte: number; endByte: number };
}
export function evidenceSimilarity(a: SimilarityItem, b: SimilarityItem): number {
  if (a.id === b.id || (a.memory_ids?.length && jaccard(a.memory_ids, b.memory_ids ?? []) === 1)) return 1;
  let overlap = 0;
  if (a.source_blob_hash && a.source_blob_hash === b.source_blob_hash && a.source_span && b.source_span) {
    const intersection = Math.max(0, Math.min(a.source_span.endByte,b.source_span.endByte)-Math.max(a.source_span.startByte,b.source_span.startByte));
    overlap = intersection / Math.max(1,Math.min(a.source_span.endByte-a.source_span.startByte,b.source_span.endByte-b.source_span.startByte));
  }
  return Math.max(overlap, 0.9*jaccard(a.symbol_ids ?? [],b.symbol_ids ?? []),
    0.7*jaccard(lexicalTerms(a.content),lexicalTerms(b.content)),
    0.3*jaccard(a.source_event_ids,b.source_event_ids), a.path && a.path === b.path ? 0.15 : 0);
}
export function mmrOrder<T extends SimilarityItem>(items: readonly T[], lambda = 0.7): { item: T; redundancy_penalty: number; score: number }[] {
  if (!Number.isFinite(lambda) || lambda < 0 || lambda > 1) throw new Error('Invalid MMR lambda');
  const pending = [...items]; const selected: { item: T; redundancy_penalty: number; score: number }[] = [];
  const penalties = new Map<string,number>();
  while (pending.length) {
    const ranked = pending.map((item) => {
      const penalty = penalties.get(item.id) ?? 0;
      return { item, redundancy_penalty: penalty, score: lambda*item.relevance_score-(1-lambda)*penalty };
    }).sort((a,b) => b.score-a.score || compareIds(a.item.id,b.item.id));
    const best = ranked[0]!; selected.push(best); pending.splice(pending.findIndex((item) => item.id === best.item.id),1);
    for (const item of pending) penalties.set(item.id,Math.max(penalties.get(item.id) ?? 0,evidenceSimilarity(item,best.item)));
  }
  return selected;
}
