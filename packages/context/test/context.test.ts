import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe,expect,it } from 'vitest';
import { defaultEstimator, serializeContext } from '@graphit/context';
import { retrievalFixture,track } from '../../retrieval/test/helpers.js';
describe('provenance-preserving context compiler',()=>{
  it('selects exact UTF-8 line windows from oversized symbols and keeps paths structural',async()=>{
    const f=await retrievalFixture();
    const bytes=Buffer.from('export function largeHistory(){\r\n'+Array.from({length:180},(_,i)=>`  const value${i} = "π😀";\r\n`).join('')+'  return 1;\r\n}');
    writeFileSync(join(f.root,'large.ts'),bytes);f.indexer.index(f.id,f.root);
    const packet=f.compiler.compile({projectId:f.id,text:'largeHistory',mode:'code',tokenBudget:4000},{maxSourceBytes:300});
    const unit=packet.evidence.find((item)=>item.metadata.symbol==='largeHistory')!;
    expect(unit.metadata.partial).toBe(true);
    expect(unit.content).toBe(bytes.subarray(unit.source_span!.startByte,unit.source_span!.endByte).toString('utf8'));
    const linked=f.compiler.compile({projectId:f.id,text:'continue implementing refresh rotation',tokenBudget:4000});
    const path=linked.evidence.find((item)=>item.kind==='graph_path')!;
    expect(path.graph_path!.edges.length).toBeGreaterThan(0);expect(path.graph_path!.nodes.length).toBeGreaterThan(1);
  });
  it('retains REQUIRED fixture evidence under 2000 estimated tokens despite large candidate context',async()=>{
    const f=await retrievalFixture(true);
    const report=f.compiler.compileWithMetrics({projectId:f.id,text:'continue implementing refresh rotation',mode:'continue',tokenBudget:2000},
      {requiredEvidenceIds:f.required});
    expect(report.packet.budget.candidate_tokens).toBeGreaterThan(8000);
    expect(report.packet.budget.estimated_tokens).toBeLessThanOrEqual(2000);
    expect(report.quality,JSON.stringify({budget:report.packet.budget,missing:report.quality.missing})).toMatchObject({passed:true,required_evidence_recall:1});
    expect(report.packet.graph.paths.length).toBeGreaterThan(0);
    expect(report.packet.evidence.every((unit)=>unit.source_event_ids.length>0)).toBe(true);
    expect(report.packet.budget.reduction_ratio).toBeGreaterThan(0.5);
  },30000);
  it('accounts for full serialized JSON and produces stable packets',async()=>{
    const f=await retrievalFixture();const query={projectId:f.id,text:'refreshSession',tokenBudget:4000};
    const first=f.compiler.compile(query);const second=f.compiler.compile(query);
    expect(serializeContext(first)).toBe(serializeContext(second));
    expect(defaultEstimator.estimate(serializeContext(first))).toBeLessThanOrEqual(first.budget.estimated_tokens);
  });
  it('preserves original source after filesystem edits and marks historical versions',async()=>{
    const f=await retrievalFixture();
    writeFileSync(join(f.root,'session.ts'),'export function refreshSession(token: string){ return "CHANGED"; }');
    const before=f.compiler.compile({projectId:f.id,text:'refreshSession',mode:'code',tokenBudget:2000});
    expect(before.evidence.find((unit)=>unit.kind==='source')!.content).toContain(':rotated');
    f.indexer.index(f.id,f.root);
    const historical=f.compiler.compile({projectId:f.id,text:'refreshSession',mode:'code',seedSymbolIds:[f.refresh.symbol_version_id],tokenBudget:4000});
    expect(historical.evidence.some((unit)=>!unit.current && unit.content.includes(':rotated'))).toBe(true);
  });
  it('degrades visibly across 8000,4000,2000,1000,500 and tiny budgets',async()=>{
    const f=await retrievalFixture();let last=Infinity;
    for(const tokenBudget of [8000,4000,2000,1000,500,1]){
      const report=f.compiler.compileWithMetrics({projectId:f.id,text:'continue implementing refresh rotation',tokenBudget},{requiredEvidenceIds:f.required});
      expect(report.packet.evidence.length).toBeLessThanOrEqual(last);last=report.packet.evidence.length;
      if(tokenBudget>=2000) expect(report.quality.passed,JSON.stringify(report.quality)).toBe(true);
      if(!report.quality.passed) expect(report.packet.budget.budget_insufficient).toBe(true);
      if(tokenBudget>=500) expect(report.packet.budget.estimated_tokens).toBeLessThanOrEqual(tokenBudget);
    }
  });
  it('detects missing and corrupt source evidence instead of returning invented context',async()=>{
    const f=await retrievalFixture();const db=track(new DatabaseSync(f.path));
    db.exec('DROP TRIGGER source_blobs_no_update; DROP TRIGGER source_blobs_no_delete;');
    db.prepare('UPDATE source_blobs SET content=?,byte_length=? WHERE content_hash=?').run(Buffer.from('bad'),3,f.refresh.span.contentHash);
    expect(()=>f.compiler.compile({projectId:f.id,text:'refreshSession'})).toThrow('integrity');
    db.prepare('DELETE FROM source_blobs WHERE content_hash=?').run(f.refresh.span.contentHash);
    expect(()=>f.compiler.compile({projectId:f.id,text:'refreshSession'})).toThrow('does not exist');
  });
  it('validates token estimators and reports unknown mandatory IDs',async()=>{
    const f=await retrievalFixture();
    expect(()=>f.compiler.compile({projectId:f.id,text:'x'},{estimator:{id:'bad',version:'1',estimate:()=>NaN}})).toThrow('invalid cost');
    const result=f.compiler.compile({projectId:f.id,text:'x',tokenBudget:4000},{requiredEvidenceIds:['missing']});
    expect(result.budget.budget_insufficient).toBe(true);expect(result.retrieval_diagnostics.mandatory_missing).toContain('missing');
  });
});
