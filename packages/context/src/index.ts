import { performance } from 'node:perf_hooks';
import { canonicalJson } from '@graphit/core';
import { compareIds, evidenceQuality, evidenceSimilarity, mmrOrder, type RetrievalQuery, type RetrievalResult, type RetrievalService } from '@graphit/retrieval';
import { defaultEstimator, estimate, evidenceUnits, type EvidenceUnit, type TokenEstimator } from './evidence.js';
export * from './evidence.js';

export interface CompileOptions {
  estimator?: TokenEstimator; lambda?: number; maxSourceBytes?: number;
  requiredEvidenceIds?: string[]; minimumReservations?: Partial<Record<EvidenceUnit['section'],number>>;
}
export interface ContextPacket {
  schema_version: '1'; project: {id:string;name:string};
  query: {text:string;mode:string;requested_budget:number};
  budget: {estimator:string;estimator_version:string;requested_tokens:number;estimated_tokens:number;candidate_tokens:number;
    reduction_ratio:number;budget_insufficient:boolean};
  project_state: {goals:string[];active_tasks:string[];constraints:string[];blockers:string[];decisions:string[]};
  graph: {symbols:string[];paths:string[]}; evidence: EvidenceUnit[]; provenance: string[];
  retrieval_diagnostics: {candidate_count:number;selected_count:number;excluded_count:number;no_results:boolean;
    ambiguous_exact_count:number;mandatory_missing:string[];diagnostics_available_via:string;warnings:string[]};
}
export interface CompileReport {
  packet: ContextPacket; retrieval: RetrievalResult;
  selections: {id:string;included:boolean;reason:string;token_cost:number;redundancy_penalty:number;rrf_score:number;ppr_score:number}[];
  metrics: {retrieval_ms:number;ppr_ms:number;packing_ms:number;total_ms:number};
  quality: ReturnType<typeof evidenceQuality>;
}
export const serializeContext = (packet: ContextPacket): string => canonicalJson(packet);
export function renderContext(packet: ContextPacket): string {
  const sections = ['project_state','active_task','decisions','constraints','graph','source','results'] as const;
  const lines = [`Graphit context: ${packet.query.text}`,
    `Estimated tokens: ${packet.budget.estimated_tokens}/${packet.budget.requested_tokens} (${packet.budget.estimator}@${packet.budget.estimator_version})`,
    `Budget insufficient: ${packet.budget.budget_insufficient}`];
  for (const section of sections) {
    const units = packet.evidence.filter((unit) => unit.section === section); if (!units.length) continue;
    lines.push('\n'+section.toUpperCase().replaceAll('_',' '));
    for (const unit of units) lines.push(`[${unit.id}] ${unit.current ? 'CURRENT' : 'HISTORICAL'}${unit.path ? ' '+unit.path : ''}${unit.metadata.symbol ? ' '+String(unit.metadata.symbol) : ''}${unit.source_span ? ' lines '+unit.source_span.startLine+'-'+unit.source_span.endLine : ''}`,
      unit.graph_path ? canonicalJson(unit.graph_path) : unit.content,`Provenance: ${unit.source_event_ids.join(', ')}${unit.source_blob_hash ? ' | blob '+unit.source_blob_hash : ''}`);
  }
  if (packet.retrieval_diagnostics.no_results) lines.push('No matching evidence.');
  lines.push(...packet.retrieval_diagnostics.warnings);
  return lines.join('\n');
}
export class ContextCompiler {
  constructor(readonly retrieval: RetrievalService) {}
  compile(query: RetrievalQuery, options: CompileOptions = {}): ContextPacket { return this.compileWithMetrics(query,options).packet; }
  compileWithMetrics(query: RetrievalQuery, options: CompileOptions = {}): CompileReport {
    const totalStart = performance.now(); const result = this.retrieval.retrieve(query); const packStart = performance.now();
    const estimator = options.estimator ?? defaultEstimator;
    if (!estimator.id || !estimator.version) throw new Error('Estimator must identify itself');
    const units = evidenceUnits(result,this.retrieval,estimator,options.maxSourceBytes ?? 1800);
    const ordered = mmrOrder(units,options.lambda ?? 0.7);
    const required = new Set(options.requiredEvidenceIds ?? []);
    // Small adaptive mandatory set; explicit requirements may demand more. Never imply completeness when it cannot fit.
    for (const type of ['goal','task','constraint','blocker','decision']) {
      const first = result.candidates.find((item) => item.current && item.memory?.entity_type === type);
      if (first) required.add(first.id);
    }
    const exact = result.candidates.filter((item) => item.priority < 2);
    for (const item of exact) required.add(item.id);
    if (!exact.some((item) => item.kind === 'symbol')) {
      const source = result.candidates.find((item) => item.kind === 'symbol'); if (source) required.add(source.id);
    }
    if (result.query.mode === 'continue') {
      const recent = result.candidates.find((item) => item.current && item.memory?.entity_type === 'result'); if (recent) required.add(recent.id);
    }
    const reserved = {graph:1,results:1,...options.minimumReservations};
    for (const [section,count] of Object.entries(reserved)) {
      if (!Number.isSafeInteger(count) || count! < 0 || count! > 100) throw new Error('Invalid section reservation');
      for (const item of ordered.filter((entry) => entry.item.section === section).slice(0,count)) required.add(item.item.id);
    }
    const budget = result.query.tokenBudget;
    const make = (selected: EvidenceUnit[], candidateTokens: number): ContextPacket => {
      const ids = (type:string) => selected.filter((unit) => unit.current && unit.metadata.entity_type === type).map((unit) => unit.id);
      const missing = [...required].filter((id) => !selected.some((unit) => unit.id === id)).sort();
      const packet: ContextPacket = {schema_version:'1',project:{id:result.project.id,name:result.project.name},
        query:{text:result.query.text,mode:result.query.mode,requested_budget:budget},
        budget:{estimator:estimator.id,estimator_version:estimator.version,requested_tokens:budget,estimated_tokens:0,candidate_tokens:candidateTokens,
          reduction_ratio:0,budget_insufficient:missing.length > 0},
        project_state:{goals:ids('goal'),active_tasks:ids('task'),constraints:ids('constraint'),blockers:ids('blocker'),decisions:ids('decision')},
        graph:{symbols:[...new Set(selected.flatMap((unit) => unit.symbol_ids ?? []))].sort(),paths:selected.filter((unit) => unit.kind === 'graph_path').map((unit) => unit.id)},
        evidence:selected,provenance:[...new Set(selected.flatMap((unit) => unit.source_event_ids))].sort(),
        retrieval_diagnostics:{candidate_count:units.length,selected_count:selected.length,excluded_count:units.length-selected.length,
          no_results:result.diagnostics.no_results,ambiguous_exact_count:result.diagnostics.ambiguous_exact_ids.length,mandatory_missing:missing,
          diagnostics_available_via:'retrieve or compileWithMetrics',warnings:result.diagnostics.warnings}};
      // Account for the complete canonical JSON envelope, including provenance and these numeric fields.
      for (let pass=0;pass<20;pass++) {
        const cost = Math.max(packet.budget.estimated_tokens,estimate(estimator,serializeContext(packet)));
        const ratio = candidateTokens ? Number(Math.max(0,1-cost/candidateTokens).toFixed(6)) : 0;
        const insufficient = missing.length > 0 || cost > budget;
        if (packet.budget.estimated_tokens === cost && packet.budget.reduction_ratio === ratio && packet.budget.budget_insufficient === insufficient) return packet;
        packet.budget.estimated_tokens=cost; packet.budget.reduction_ratio=ratio; packet.budget.budget_insufficient=insufficient;
      }
      throw new Error('Token estimator does not converge for packet accounting');
    };
    const candidateTokens = make(units,0).budget.estimated_tokens;
    let selected: EvidenceUnit[] = []; const reasons = new Map<string,string>();
    const utility = (entry: typeof ordered[number]) => Math.max(0.001,entry.score) / Math.sqrt(Math.max(1,entry.item.estimated_tokens));
    const criticality = (unit: EvidenceUnit): number => {
      if (!required.has(unit.id)) return 5;
      if (result.candidates.find((item) => item.id === unit.id)?.priority === 0) return 0;
      if (['goal','task'].includes(String(unit.metadata.entity_type))) return 1;
      if (['decision','constraint','blocker'].includes(String(unit.metadata.entity_type)) || unit.kind === 'source') return 2;
      return 3;
    };
    const priority = [...ordered].sort((a,b) => criticality(a.item)-criticality(b.item) ||
      utility(b)-utility(a) || compareIds(a.item.id,b.item.id));
    for (const entry of priority) {
      if (!required.has(entry.item.id) && selected.some((unit) => evidenceSimilarity(unit,entry.item) >= 0.98)) {
        reasons.set(entry.item.id,'redundant'); continue;
      }
      const proposed = [...selected,entry.item];
      if (make(proposed,candidateTokens).budget.estimated_tokens <= budget) {
        selected=proposed; reasons.set(entry.item.id,required.has(entry.item.id) ? 'mandatory_or_reserved' : 'utility_per_cost');
      } else reasons.set(entry.item.id,'budget');
    }
    const packet = make(selected,candidateTokens);
    const quality = evidenceQuality(selected.map((unit) => unit.id),[...required]);
    const selections = ordered.map((entry) => {
      const candidate = result.candidates.find((item) => item.id === entry.item.id);
      return {id:entry.item.id,included:selected.some((unit) => unit.id === entry.item.id),reason:reasons.get(entry.item.id) ?? 'excluded',
        token_cost:entry.item.estimated_tokens,redundancy_penalty:entry.redundancy_penalty,
        rrf_score:candidate?.rrf_score ?? 0,ppr_score:candidate?.ppr_score ?? 0};
    });
    return {packet,retrieval:result,selections,quality,metrics:{...result.metrics,packing_ms:performance.now()-packStart,total_ms:performance.now()-totalStart}};
  }
}
