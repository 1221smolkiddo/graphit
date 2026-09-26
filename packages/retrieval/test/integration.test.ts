import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteDatabase } from '@graphit/storage';
import { describe,expect,it } from 'vitest';
import { canonicalJson } from '@graphit/core';
import { RetrievalService, retrievalMetrics } from '@graphit/retrieval';
import { retrievalFixture,temporary,track } from './helpers.js';
describe('retrieval integration',()=>{
  it('does not promote generic words in natural-language queries to mandatory local-variable matches',async()=>{
    const f=await retrievalFixture();
    writeFileSync(join(f.root,'locals.ts'),'const source = 1; const history = 2; const current = 3;');f.indexer.index(f.id,f.root);
    const result=f.retrieval.retrieve({projectId:f.id,text:'how does this preserve source history?',mode:'code'});
    expect(result.candidates.filter((item)=>item.priority<2)).toEqual([]);
    expect(f.retrieval.retrieve({projectId:f.id,text:'source',mode:'code'}).candidates[0]!.symbol?.name).toBe('source');
  });

  it('rolls back artifact and relation events together when explicit linking fails',async()=>{
    const f=await retrievalFixture();const before=f.store.readEvents(f.id);
    const db=track(new SqliteDatabase(f.path));
    db.exec("CREATE TRIGGER fail_link BEFORE INSERT ON memory_relations BEGIN SELECT RAISE(ABORT, 'link failure'); END;");
    expect(()=>f.retrieval.linkMemoryToSymbol(f.id,f.task.id,f.login.logical_symbol_id)).toThrow('link failure');
    expect(f.store.readEvents(f.id)).toEqual(before);
  });
  it('refreshes the FTS projection after new memory, supersession and code edits',async()=>{
    const f=await retrievalFixture();f.retrieval.retrieve({projectId:f.id,text:'x'});
    const decision=f.add('decision','Prefer journal checkpoints for retention.');
    expect(f.retrieval.retrieve({projectId:f.id,text:'journal'}).candidates.some((item)=>item.memory?.id===decision.id)).toBe(true);
    f.memory.supersedeMemory(f.id,decision.id,{content:'Prefer WAL checkpoints for retention.',sourceEventIds:f.task.source_event_ids});
    expect(f.retrieval.retrieve({projectId:f.id,text:'journal'}).candidates.some((item)=>item.memory?.id===decision.id)).toBe(false);
    expect(f.retrieval.retrieve({projectId:f.id,text:'journal',includeHistorical:true}).candidates.find((item)=>item.memory?.id===decision.id)?.current).toBe(false);
    writeFileSync(join(f.root,'new.ts'),'export function journalCheckpoint(){}');f.indexer.index(f.id,f.root);
    expect(f.retrieval.retrieve({projectId:f.id,text:'journalCheckpoint'}).candidates[0]!.symbol?.name).toBe('journalCheckpoint');
  });

  it('keeps completed tasks out of current context and explicitly reports no results',async()=>{
    const f=await retrievalFixture();f.memory.resolveMemory(f.id,f.task.id);
    expect(f.retrieval.retrieve({projectId:f.id,text:'continue refresh rotation'}).candidates.some((item)=>item.memory?.id===f.task.id)).toBe(false);
    const empty=f.retrieval.retrieve({projectId:f.id,text:'zzznomatchingtoken',mode:'code'});
    expect(empty.candidates).toEqual([]);expect(empty.diagnostics.no_results).toBe(true);
    const packet=f.compiler.compile({projectId:f.id,text:'zzznomatchingtoken',mode:'code'});
    expect(packet.retrieval_diagnostics.no_results).toBe(true);expect(packet.evidence).toEqual([]);
  });

  it('prioritizes exact names and paths and exposes independent rankings',async()=>{
    const f=await retrievalFixture();
    const exact=f.retrieval.retrieve({projectId:f.id,text:'refreshSession'});
    expect(exact.candidates[0]!.symbol?.logical_symbol_id).toBe(f.refresh.logical_symbol_id);
    expect(exact.candidates[0]!.rankings.some((rank)=>rank.channel==='exact')).toBe(true);
    expect(f.retrieval.retrieve({projectId:f.id,text:'session.ts'}).candidates[0]!.symbol?.kind).toBe('file');
    const ambiguous=f.retrieval.retrieve({projectId:f.id,text:'duplicate'});
    expect(ambiguous.diagnostics.ambiguous_exact_ids).toHaveLength(2);
    expect(ambiguous.candidates.slice(0,2).map((item)=>item.symbol?.path).sort()).toEqual(['duplicate.ts','other.ts']);
  });
  it('finds login, callers and current decisions with benchmark-required IDs',async()=>{
    const f=await retrievalFixture();
    const cases=[['where is login handled?','symbol:'+f.login.logical_symbol_id],
      ['what calls createSession?','symbol:'+f.login.logical_symbol_id],
      ['why are we using SQLite?','memory:'+f.decision.id]];
    for(const [text,id] of cases){
      const result=f.retrieval.retrieve({projectId:f.id,text:text!});
      expect(retrievalMetrics(result.candidates.map((item)=>item.id),[id!],10).recall_at_k,JSON.stringify({text,ranked:result.candidates.slice(0,12).map((item)=>item.symbol?.qualifiedName ?? item.memory?.entity_type)})).toBe(1);
      const packet=f.compiler.compile({projectId:f.id,text:text!,tokenBudget:4000},{requiredEvidenceIds:[id!]});
      expect(packet.evidence.some((unit)=>unit.id===id)).toBe(true);
    }
    const normal=f.retrieval.retrieve({projectId:f.id,text:'Neo4j SQLite'});
    expect(normal.candidates.some((item)=>item.memory?.id===f.old.id)).toBe(false);
    const historical=f.retrieval.retrieve({projectId:f.id,text:'Neo4j',seedMemoryIds:[f.old.id]});
    expect(historical.candidates.find((item)=>item.memory?.id===f.old.id)?.current).toBe(false);
  });
  it('expands explicit task links into current code with provenance and idempotent events',async()=>{
    const f=await retrievalFixture();const before=f.store.readEvents(f.id);
    f.retrieval.linkMemoryToSymbol(f.id,f.task.id,f.refresh.logical_symbol_id);
    expect(f.store.readEvents(f.id)).toEqual(before);
    const result=f.retrieval.retrieve({projectId:f.id,text:'continue implementing refresh rotation',mode:'continue'});
    expect(result.candidates.some((item)=>item.symbol?.logical_symbol_id===f.refresh.logical_symbol_id)).toBe(true);
    expect(result.paths.some((path)=>path.edges.some((edge)=>edge.type==='TARGETS'))).toBe(true);
    expect(result.paths.every((path)=>path.edges.every((edge)=>edge.source_event_ids.length))).toBe(true);
  });
  it('rebuilds stale/deleted search rows without changing canonical or P1/P2 state',async()=>{
    const f=await retrievalFixture();const q={projectId:f.id,text:'refreshSession'};
    const before=f.retrieval.retrieve(q).candidates;const db=track(new SqliteDatabase(f.path));
    const tables=['events','source_blobs','memory_entities','memory_relations','code_files','code_symbols','code_edges'];
    const snapshot=()=>tables.map((table)=>db.prepare(`SELECT * FROM ${table}`).all());
    const canonical=snapshot();
    db.exec('DELETE FROM retrieval_code_fts; DELETE FROM retrieval_memory_fts; DELETE FROM retrieval_projection_state;');
    expect(f.retrieval.retrieve(q).candidates).toEqual(before);expect(snapshot()).toEqual(canonical);
    db.exec("UPDATE retrieval_code_fts SET name = 'stale'");
    expect(f.retrieval.retrieve(q).candidates).toEqual(before);
    f.retrieval.rebuildSearchProjection(f.id);expect(snapshot()).toEqual(canonical);
  });
  it('rejects invalid seeds and isolates projects',async()=>{
    const f=await retrievalFixture();
    expect(()=>f.retrieval.retrieve({projectId:f.id,text:'x',seedMemoryIds:['0'.repeat(64)]})).toThrow('Memory seed');
    expect(()=>f.retrieval.retrieve({projectId:f.id,text:'x',seedSymbolIds:['0'.repeat(64)]})).toThrow();
    expect(()=>f.retrieval.retrieve({projectId:f.id,text:'x',currentFiles:['../outside.ts']})).toThrow();
    const root=temporary();writeFileSync(join(root,'private.ts'),'export function privateOnly(){}');
    const id=f.store.initializeProject(root,'Other').project!.id;f.indexer.index(id,root);
    const other=new RetrievalService(f.store,f.memory,f.graph);
    expect(other.retrieve({projectId:id,text:'SQLite'}).candidates).toEqual([]);
    expect(other.retrieve({projectId:f.id,text:'privateOnly',mode:'code'}).candidates).toEqual([]);
    expect(()=>other.linkMemoryToSymbol(id,f.task.id,f.refresh.logical_symbol_id)).toThrow();
  });
  it('keeps rankings deterministic and protects FTS syntax',async()=>{
    const f=await retrievalFixture();const q={projectId:f.id,text:'refresh OR "token" -- NEAR(*)'};
    expect(canonicalJson(f.retrieval.retrieve(q).candidates)).toBe(canonicalJson(f.retrieval.retrieve(q).candidates));
  });
});
