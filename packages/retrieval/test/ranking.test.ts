import { describe,expect,it } from 'vitest';
import { evidenceSimilarity, mmrOrder, normalizeQuery, personalizedPageRank, reciprocalRankFusion, retrievalConfig,
  retrievalMetrics, evidenceQuality, type RetrievalEdge } from '@graphit/retrieval';
const projectId='11111111-1111-4111-8111-111111111111';
describe('deterministic retrieval primitives',()=>{
  it('enforces node/hop caps and deterministic edge-order independent expansion',()=>{
    const edges:RetrievalEdge[]=Array.from({length:300},(_,i)=>({id:String(i).padStart(3,'0'),from:'root',to:'n'+i,type:'CALLS',source_event_ids:['e']}));
    const config=retrievalConfig({maxCandidates:10,maxHops:1});
    const first=personalizedPageRank(['root'],edges,config);
    const second=personalizedPageRank(['root'],[...edges].reverse(),config);
    expect(first.ids).toHaveLength(10);expect([...first.scores]).toEqual([...second.scores]);
    expect(personalizedPageRank(['root'],edges,retrievalConfig({maxHops:0})).ids).toEqual(['root']);
  });
  it('normalizes intent and camelCase without an LLM',()=>{
    const q=normalizeQuery({projectId,text:'  what calls refreshSession?  '});
    expect(q.text).toBe('what calls refreshSession?'); expect(q.mode).toBe('impact');
    expect(q.terms).toContain('refresh');expect(q.terms).toContain('session');
    expect(normalizeQuery({projectId,text:'continue task',currentFiles:['src\\auth.ts']}).currentFiles).toEqual(['src/auth.ts']);
  });
  it.each(['','   '])('rejects empty query %j',(text)=>expect(()=>normalizeQuery({projectId,text})).toThrow());
  it('uses canonical RRF and keeps raw scores diagnostic only',()=>{
    const rank=reciprocalRankFusion([{channel:'a',entries:[{id:'x',score:999},{id:'y',score:1}]},
      {channel:'b',entries:[{id:'y',score:-100},{id:'x',score:-200}]}]);
    expect(rank[0]!.id).toBe('x');expect(rank[0]!.score).toBeCloseTo(1/61+1/62,12);
    expect(rank[0]!.rankings.map((item)=>item.rank)).toEqual([1,2]);
    expect(()=>reciprocalRankFusion([],0)).toThrow();
  });
  it('handles personalized dangling mass and bounds reverse expansion',()=>{
    const edge=(from:string,to:string):RetrievalEdge=>({id:from+to,from,to,type:'CALLS',source_event_ids:['e']});
    const config=retrievalConfig({maxHops:1,maxCandidates:2});
    const result=personalizedPageRank(['c'],[edge('a','b'),edge('b','c')],config,true);
    expect(result.ids).toEqual(['b','c']);
    expect([...result.scores.values()].reduce((a,b)=>a+b,0)).toBeCloseTo(1,10);
    expect(result.scores.get('c')).toBeGreaterThan(0);
    const isolated=personalizedPageRank(['z'],[],config);expect(isolated.scores.get('z')).toBeCloseTo(1);
    expect(personalizedPageRank([],[],config).ids).toEqual([]);
  });
  it('MMR penalizes duplicate content and exact overlapping source spans',()=>{
    const base={content:'refresh rotation token',relevance_score:1,source_event_ids:['e']};
    const items=[{...base,id:'a'},{...base,id:'b'}, {...base,id:'c',content:'SQLite WAL immutable history',relevance_score:0.95}];
    expect(mmrOrder(items).map((item)=>item.item.id)).toEqual(['a','c','b']);
    expect(evidenceSimilarity({...items[0]!,source_blob_hash:'h',source_span:{startByte:0,endByte:10}},
      {...items[2]!,source_blob_hash:'h',source_span:{startByte:2,endByte:8}})).toBe(1);
  });
  it('measures evidence retention, not just reduction',()=>{
    expect(retrievalMetrics(['a','b'],['b','c'],2)).toEqual({recall_at_k:0.5,mrr:0.5});
    expect(evidenceQuality(['a'],['a','b'])).toEqual({passed:false,required_evidence_recall:0.5,missing:['b']});
  });
});
