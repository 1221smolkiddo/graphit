import { z } from 'zod';
import { hashSchema } from '@graphit/core';
import { normalizePath, type CodeSymbol, type SourceSpan } from '@graphit/codegraph';
import type { MemoryEntity } from '@graphit/memory';

export const modes = ['auto', 'code', 'memory', 'impact', 'continue'] as const;
export const querySchema = z.object({
  text: z.string().max(4000).refine((s) => s.trim().length > 0, 'Query cannot be empty'),
  projectId: z.string().uuid(), tokenBudget: z.number().int().positive().max(1000000).optional(),
  activeSessionId: z.string().uuid().optional(), seedSymbolIds: z.array(hashSchema).max(200).optional(),
  seedMemoryIds: z.array(hashSchema).max(200).optional(), currentFiles: z.array(z.string()).max(200).optional(),
  mode: z.enum(modes).optional(), includeHistorical: z.boolean().optional(),
}).strict();
export type RetrievalQuery = z.infer<typeof querySchema>;
export interface NormalizedQuery {
  text: string; projectId: string; mode: typeof modes[number]; tokenBudget: number;
  activeSessionId: string | null; seedSymbolIds: string[]; seedMemoryIds: string[]; currentFiles: string[];
  includeHistorical: boolean; terms: string[];
}
export const compareIds = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const lexicalTerms = (text: string): string[] => [...new Set((text.normalize('NFKC')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
  .toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).flatMap((word) => word.split('_')).filter(Boolean))];
export const searchable = (text: string): string => text + ' ' + lexicalTerms(text).join(' ');
const stop = new Set('a an and are as at be by does for from how i if in is it of on or the this to using we what where why with work current'.split(' '));
export function normalizeQuery(input: RetrievalQuery): NormalizedQuery {
  const q = querySchema.parse(input);
  const text = q.text.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const terms = lexicalTerms(text).filter((term) => !stop.has(term)).slice(0, 32);
  const mode = q.mode && q.mode !== 'auto' ? q.mode : /\b(affected|impact|breaks|callers|calls)\b/i.test(text) ? 'impact' :
    /^continue\b/i.test(text) ? 'continue' : 'auto';
  return { text, projectId: q.projectId, mode, tokenBudget: q.tokenBudget ?? 2000, activeSessionId: q.activeSessionId ?? null,
    seedSymbolIds: [...new Set(q.seedSymbolIds ?? [])].sort(), seedMemoryIds: [...new Set(q.seedMemoryIds ?? [])].sort(),
    currentFiles: [...new Set((q.currentFiles ?? []).map(normalizePath))].sort(), includeHistorical: q.includeHistorical ?? false, terms };
}
export interface Ranking { channel: string; rank: number; raw_score: number | null }
export interface Candidate {
  id: string; kind: 'symbol' | 'memory'; current: boolean; symbol?: CodeSymbol; memory?: MemoryEntity;
  rankings: Ranking[]; rrf_score: number; ppr_score: number; relevance: number; priority: number;
}
export interface RetrievalEdge {
  id: string; from: string; to: string; type: string; source_event_ids: string[];
  span?: SourceSpan;
}
export interface GraphPath { id: string; nodes: { id: string; label: string; path?: string }[]; edges: RetrievalEdge[] }
export interface RetrievalConfig {
  rrfK: number; damping: number; maxHops: number; maxCandidates: number; minGraphScore: number;
  maxIterations: number; tolerance: number; edgeWeights: Record<string, number>;
}
export const defaultEdgeWeights: Readonly<Record<string, number>> = Object.freeze({
  CALLS: 3, REFERENCES: 3, TARGETS: 3, DEPENDS_ON: 3, BLOCKS: 3, VERIFIED_BY: 3,
  IMPORTS: 2, EXTENDS: 2, IMPLEMENTS: 2, DEFINES: 2, CONTAINS: 2, EXPORTS: 2,
  RELATED_TO: 1, PART_OF: 2, RESOLVES: 3, PRODUCED: 2,
});
export const defaultConfig: RetrievalConfig = { rrfK: 60, damping: 0.85, maxHops: 3, maxCandidates: 200,
  minGraphScore: 0.000001, maxIterations: 100, tolerance: 1e-10, edgeWeights: { ...defaultEdgeWeights } };
export function retrievalConfig(input: Partial<RetrievalConfig> = {}): RetrievalConfig {
  return z.object({
    rrfK: z.number().finite().positive(), damping: z.number().finite().min(0).lt(1),
    maxHops: z.number().int().min(0).max(10), maxCandidates: z.number().int().min(1).max(2000),
    minGraphScore: z.number().finite().nonnegative(), maxIterations: z.number().int().min(1).max(1000),
    tolerance: z.number().finite().positive(), edgeWeights: z.record(z.number().finite().positive()),
  }).strict().parse({ ...defaultConfig, ...input, edgeWeights: { ...defaultEdgeWeights, ...input.edgeWeights } });
}
