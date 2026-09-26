import { fixture } from '../../indexer/test/helpers.js';
import { RetrievalService } from '@graphit/retrieval';
import { ContextCompiler } from '@graphit/context';
export { temporary, track } from '../../indexer/test/helpers.js';
export async function retrievalFixture(noise = false) {
  const f = await fixture('auth-retrieval'); const run = f.indexer.index(f.id,f.root);
  if (run.status !== 'completed') throw new Error(JSON.stringify(run.errors));
  const retrieval = new RetrievalService(f.store,f.memory,f.graph); const compiler = new ContextCompiler(retrieval);
  const source = f.store.appendEvent({project_id:f.id,session_id:f.store.getState(f.id).active_session_id!,
    event_type:'conversation.user_message',payload:{content:'Implement refresh rotation. Preserve SQLite evidence, prevent refresh token races.'}});
  const add = (entityType: 'goal'|'task'|'constraint'|'decision'|'result'|'artifact', content:string) =>
    f.memory.promoteMemory(f.id,{entityType,content,sourceEventIds:[source.id]});
  const goal=add('goal','Deliver reliable authentication.');
  const task=add('task','Continue implementing refresh rotation.');
  const constraint=add('constraint','Never persist raw refresh tokens.');
  const old=add('decision','Use Neo4j for history.');
  const decision=f.memory.supersedeMemory(f.id,old.id,{content:'Use SQLite WAL to preserve immutable source history.',sourceEventIds:[source.id]}).replacement;
  const tested=f.store.appendEvent({project_id:f.id,session_id:f.store.getState(f.id).active_session_id!,event_type:'test.result',
    payload:{status:'passed',summary:'Refresh rotation concurrency test passed.',command:'npm test'}});
  const result=f.memory.promoteMemory(f.id,{entityType:'result',content:'Refresh rotation concurrency test passed.',sourceEventIds:[tested.id]});
  const symbol=(name:string) => f.graph.findSymbolsByName(f.id,name)[0]!;
  const refresh=symbol('refreshSession'); const login=symbol('loginHandler'); const create=symbol('createSession');
  retrieval.linkMemoryToSymbol(f.id,task.id,refresh.logical_symbol_id);
  if(noise) for(let i=0;i<18;i++) add('artifact',`Reference ${i}: `+
    'Refresh rotation background: investigate retry ordering, request lifetimes, token persistence and concurrent session updates. '.repeat(24));
  const required=['memory:'+goal.id,'memory:'+task.id,'memory:'+constraint.id,'memory:'+decision.id,'memory:'+result.id,'symbol:'+refresh.logical_symbol_id];
  return {...f,retrieval,compiler,goal,task,constraint,old,decision,result,refresh,login,create,required,add};
}
