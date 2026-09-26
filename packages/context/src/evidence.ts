import { canonicalJson } from '@graphit/core';
import { spanForBytes, type SourceSpan } from '@graphit/codegraph';
import { lexicalTerms, type Candidate, type GraphPath, type RetrievalResult, type RetrievalService } from '@graphit/retrieval';

export interface TokenEstimator { readonly id: string; readonly version: string; estimate(text: string): number }
export const defaultEstimator: TokenEstimator = Object.freeze({ id: 'graphit:utf8-bytes-per-four', version: '1',
  estimate: (text: string) => Math.ceil(Buffer.byteLength(text,'utf8')/4) });
export function estimate(estimator: TokenEstimator, text: string): number {
  const tokens = estimator.estimate(text);
  if (!Number.isSafeInteger(tokens) || tokens < 0 || (!tokens && text.length)) throw new Error('Token estimator returned an invalid cost');
  return tokens;
}
export interface EvidenceUnit {
  id: string; kind: 'memory' | 'source' | 'test_result' | 'command_result' | 'graph_path';
  section: 'project_state' | 'active_task' | 'decisions' | 'constraints' | 'graph' | 'source' | 'results';
  relevance_score: number; content: string; estimated_tokens: number; source_event_ids: string[];
  provenance: 'canonical_memory' | 'immutable_source' | 'evidenced_graph';
  current: boolean; source_blob_hash?: string; source_span?: SourceSpan; symbol_ids?: string[]; memory_ids?: string[];
  path?: string; metadata: { [key: string]: unknown };
  graph_path?: GraphPath;
}
function sourceWindow(bytes: Uint8Array, span: SourceSpan, query: string, maxBytes: number): SourceSpan {
  if (span.endByte-span.startByte <= maxBytes) return span;
  // Select a contiguous original line window. Never rewrite or append ellipses to source.
  const terms = lexicalTerms(query); const lines: {start:number;end:number;text:string}[] = [];
  let start = span.startByte;
  for (let end = start; end <= span.endByte; end++) if (end === span.endByte || bytes[end] === 10) {
    const stop = end === span.endByte ? end : end+1;
    lines.push({start,end:stop,text:Buffer.from(bytes.subarray(start,stop)).toString('utf8')}); start = stop;
  }
  const scored = lines.map((line,index) => ({index,score:terms.filter((term) => line.text.toLowerCase().includes(term)).length}));
  scored.sort((a,b) => b.score-a.score || a.index-b.index);
  const match = scored[0]?.index ?? 0; const first = Math.max(0,match-1);
  let last = Math.max(first,match);
  while (last+1 < lines.length && lines[last+1]!.end-lines[first]!.start <= maxBytes) last++;
  return spanForBytes(bytes,lines[first]!.start,lines[last]!.end);
}
function memorySection(type: string): EvidenceUnit['section'] {
  if (type === 'task') return 'active_task';
  if (type === 'decision') return 'decisions';
  if (type === 'constraint') return 'constraints';
  if (['result','action'].includes(type)) return 'results';
  return 'project_state';
}
export function evidenceUnits(result: RetrievalResult, service: RetrievalService, estimator: TokenEstimator = defaultEstimator, maxSourceBytes = 1800): EvidenceUnit[] {
  if (!Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1) throw new Error('Invalid source window limit');
  const units: EvidenceUnit[] = []; const blobs = new Map<string,Uint8Array>();
  const events = new Map(service.readEvents(result.project.id).map((event) => [event.id,event]));
  for (const candidate of result.candidates) {
    let unit: EvidenceUnit;
    if (candidate.memory) {
      const item = candidate.memory;
      const sourceTypes = item.source_event_ids.map((id) => events.get(id)?.event_type);
      unit = {id:candidate.id,kind:item.entity_type === 'result' && sourceTypes.includes('test.result') ? 'test_result' :
        sourceTypes.includes('command.result') ? 'command_result' : 'memory',
        section:memorySection(item.entity_type),relevance_score:candidate.relevance,content:item.content,estimated_tokens:0,
        source_event_ids:item.source_event_ids,provenance:'canonical_memory',current:candidate.current,memory_ids:[item.id],
        metadata:{entity_type:item.entity_type,status:item.status,superseded_by:item.superseded_by}};
    } else {
      const symbol = candidate.symbol!;
      let bytes = blobs.get(symbol.span.contentHash);
      if (!bytes) { bytes = service.readEvidenceBytes(symbol.span.contentHash); blobs.set(symbol.span.contentHash,bytes); }
      const span = sourceWindow(bytes,symbol.span,result.query.text,maxSourceBytes);
      unit = {id:candidate.id,kind:'source',section:'source',relevance_score:candidate.relevance,
        content:Buffer.from(bytes.subarray(span.startByte,span.endByte)).toString('utf8'),estimated_tokens:0,
        source_event_ids:[symbol.observation_event_id],provenance:'immutable_source',current:candidate.current,
        source_blob_hash:span.contentHash,source_span:span,symbol_ids:[symbol.logical_symbol_id],path:symbol.path,
        metadata:{symbol:symbol.qualifiedName,symbol_version_id:symbol.symbol_version_id,partial:span.startByte !== symbol.span.startByte || span.endByte !== symbol.span.endByte}};
    }
    units.push(unit);
  }
  for (const path of result.paths.slice(0,20)) {
    const candidates = result.candidates.filter((item) => path.nodes.some((node) => node.id === item.id));
    units.push({id:'path:'+path.id,kind:'graph_path',section:'graph',relevance_score:Math.max(0,...candidates.map((item) => item.relevance))*0.9,
      content:'',graph_path:path,estimated_tokens:0,source_event_ids:[...new Set(path.edges.flatMap((edge) => edge.source_event_ids))].sort(),
      provenance:'evidenced_graph',current:true,symbol_ids:path.nodes.filter((node) => node.id.startsWith('symbol:')).map((node) => node.id.slice(7)),metadata:{}});
  }
  for (const unit of units) {
    if (!unit.source_event_ids.length || unit.source_event_ids.some((id) => !events.has(id))) throw new Error('Evidence has missing canonical provenance');
    unit.estimated_tokens = estimate(estimator,canonicalJson(unit));
  }
  return units;
}
export function candidateForUnit(unit: EvidenceUnit, candidates: Candidate[]): Candidate | undefined { return candidates.find((item) => item.id === unit.id); }
