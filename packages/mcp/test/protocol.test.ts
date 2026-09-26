import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteDatabase } from '@graphit/storage';
import { describe, expect, it } from 'vitest';
import { canonicalJson, type GraphEvent, type ProjectState } from '@graphit/core';
import { type MemoryEntity, type HandoffPacket } from '@graphit/memory';
import { type CodeSymbol } from '@graphit/codegraph';
import { type ContextPacket } from '@graphit/context';
import { type RetrievalResult } from '@graphit/retrieval';
import { EventStore } from '@graphit/storage';
import { openGraphit, resourceUris, toolSchemas } from '../src/index.js';
import { call, cli, closeStore, connect, fixture, rejects } from './helpers.js';

describe('actual MCP stdio protocol', () => {
  it('lists all 13 strict tools and three resources, selects by path and by project ID, and diagnoses without event writes', async () => {
    const f = await fixture();
    const before = f.store.readEvents(f.id);
    const doctor = spawnSync(process.execPath, [cli, 'mcp', 'doctor', '--project', f.root], { encoding: 'utf8' });
    expect(doctor.status, doctor.stderr).toBe(0);
    expect(JSON.parse(doctor.stdout)).toMatchObject({ database_reachable: true, project_initialized: true, journal_mode: 'wal',
      code_index_present: false, retrieval_index_present: false, mcp_sdk_version: '2.1.0', schema_versions: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }] });
    expect(f.store.readEvents(f.id)).toEqual(before);
    const a = await connect(f.root, 'arbitrary-provider', 'arbitrary-agent', f.root);
    const tools = (await a.client.listTools()).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(toolSchemas).sort());
    expect(tools.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
    expect((await a.client.listResources()).resources.map((resource) => resource.uri).sort()).toEqual([...resourceUris].sort());
    for (const uri of resourceUris) expect((await a.client.readResource({ uri })).contents).toHaveLength(1);
    const state = await call<ProjectState>(a.client, 'graphit_status');
    expect(state.project!.id).toBe(f.id);
    expect(state.sessions.at(-1)).toMatchObject({ provider: 'arbitrary-provider', agent_name: 'arbitrary-agent', model_name: 'arbitrary-model', client_name: 'vitest', external_session_id: 'external-test' });
    await a.close();
    const b = await connect(f.root, 'second', 'test', f.id);
    expect((await call<ProjectState>(b.client, 'graphit_status')).project!.id).toBe(f.id);
  });

  it('continues across fully exited Anthropic and OpenAI processes using unchanged evidence and canonical budgeted context', async () => {
    const f = await fixture(true);
    const a = await connect(f.root, 'anthropic', 'claude-code');
    const initial = f.store.readEvents(f.id);
    const source = await call<GraphEvent>(a.client, 'graphit_record_event', { event_type: 'conversation.user_message',
      payload: { content: 'Finish refreshSession safely. Keep SQLite as the canonical store.', metadata: { arbitrary_chat_format: 'ignored' } } });
    const entities: MemoryEntity[] = [];
    for (const [entity_type, content] of [['goal', 'Finish refreshSession safely'], ['decision', 'Keep SQLite as the canonical store'], ['task', 'Verify refreshSession continuation']]) {
      entities.push(await call<MemoryEntity>(a.client, 'graphit_add_memory', { entity_type, content, source_event_ids: [source.id] }));
    }
    const result = await call<GraphEvent>(a.client, 'graphit_record_event', { event_type: 'test.result', payload: { status: 'passed', summary: 'refreshSession continuation test passed', command: 'npm test' } });
    entities.push(await call<MemoryEntity>(a.client, 'graphit_add_memory', { entity_type: 'result', content: 'refreshSession continuation test passed', source_event_ids: [result.id] }));
    await call(a.client, 'graphit_checkpoint', { name: 'provider-handoff' });
    const handoffA = await call<HandoffPacket>(a.client, 'graphit_handoff');
    const before = f.store.readEvents(f.id);
    const pidA = a.transport.pid;
    await a.close();
    expect(a.transport.pid).toBeNull();
    expect(() => process.kill(pidA!, 0)).toThrow();
    closeStore(f.store); // No open Graphit store or server A survives into phase B.
    const b = await connect(f.root, 'openai', 'codex');
    expect(b.transport.pid).not.toBe(pidA);
    const handoffB = await call<HandoffPacket>(b.client, 'graphit_handoff');
    expect(handoffB.current_session).toMatchObject({ provider: 'openai', agent_name: 'codex' });
    for (const field of ['goals', 'active_tasks', 'decisions', 'recent_results', 'artifacts', 'relations'] as const) expect(handoffB[field]).toEqual(handoffA[field]);
    expect(handoffB.evidence.map((event) => event.id)).toEqual(expect.arrayContaining([source.id, result.id]));
    const packet = await call<ContextPacket>(b.client, 'graphit_context', { query: 'continue the current work', token_budget: 6000, mode: 'continue' });
    expect(packet.budget.budget_insufficient).toBe(false);
    expect(packet.budget.estimated_tokens).toBeLessThanOrEqual(6000);
    expect(Math.ceil(Buffer.byteLength(canonicalJson(packet)) / 4)).toBeLessThanOrEqual(packet.budget.estimated_tokens);
    expect(packet.evidence.map((unit) => unit.id)).toEqual(expect.arrayContaining(entities.map((entity) => `memory:${entity.id}`)));
    expect(packet.provenance).toEqual(expect.arrayContaining([source.id, result.id]));
    const direct = await openGraphit({ project: f.root });
    try { expect(canonicalJson(packet)).toBe(canonicalJson(direct.api.compiler.compile({ projectId: f.id, text: 'continue the current work', tokenBudget: 6000, mode: 'continue' }))); }
    finally { direct.close(); }
    const continued = await call<GraphEvent>(b.client, 'graphit_record_event', { event_type: 'conversation.assistant_message',
      payload: { content: 'Continue the existing refreshSession task using the previous test evidence.' } });
    const action = await call<MemoryEntity>(b.client, 'graphit_add_memory', { entity_type: 'action',
      content: 'Continue refreshSession verification', source_event_ids: [source.id, result.id, continued.id] });
    expect(action.source_event_ids).toEqual(expect.arrayContaining([source.id, result.id, continued.id]));
    expect((await call<ProjectState>(b.client, 'graphit_status')).sessions.find((session) => session.id === continued.session_id)?.provider).toBe('openai');
    const db = new EventStore(f.path);
    try {
      expect(db.readEvents(f.id).slice(0, before.length)).toEqual(before);
      expect(db.readEvents(f.id).slice(0, initial.length)).toEqual(initial);
    } finally { db.close(); }
    console.info('P4 handoff measurement', JSON.stringify({ handoff_bytes: Buffer.byteLength(canonicalJson(handoffB)),
      context_bytes: Buffer.byteLength(canonicalJson(packet)), estimated_tokens: packet.budget.estimated_tokens, requested_tokens: 6000,
      required_memory_evidence: entities.length, preserved_required_memory_evidence: entities.filter((entity) => packet.evidence.some((unit) => unit.id === `memory:${entity.id}`)).length }));
  }, 40000);

  it('serves preserved source, callers, callees, impact and retrieval without reading changed working-tree files', async () => {
    const f = await fixture(true); const a = await connect(f.root);
    const found = await call<{ candidates: CodeSymbol[] }>(a.client, 'graphit_find_symbol', { query: 'refreshSession' });
    const symbol = found.candidates[0]!;
    const source = f.graph.getSource(f.id, symbol.logical_symbol_id);
    writeFileSync(join(f.root, symbol.path), 'THIS LIVE FILE MUST NOT BE RETURNED');
    expect(await call(a.client, 'graphit_get_source', { symbol_id: symbol.symbol_version_id })).toEqual(source);
    for (const name of ['graphit_callers', 'graphit_callees']) expect(await call(a.client, name, { symbol_id: symbol.logical_symbol_id })).toHaveProperty('edges');
    const impact = await call<RetrievalResult>(a.client, 'graphit_impact', { symbol_id: symbol.logical_symbol_id });
    expect(impact.query.mode).toBe('impact'); expect(impact.candidates.length).toBeGreaterThan(0);
    expect((await call<RetrievalResult>(a.client, 'graphit_retrieve', { query: 'refreshSession', limit: 2 })).candidates.length).toBeLessThanOrEqual(2);
  });

  it('promotes and links memories explicitly and idempotently, and never executes recorded commands', async () => {
    const f = await fixture(); const a = await connect(f.root);
    const marker = join(f.root, 'must-not-exist');
    const event = await call<GraphEvent>(a.client, 'graphit_record_event', { event_type: 'command.executed', payload: {
      command_id: 'record-only', command: `node -e "require('fs').writeFileSync(${JSON.stringify(marker)},'bad')"` } });
    expect(existsSync(marker)).toBe(false);
    expect(f.memory.listMemory(f.id)).toEqual([]);
    const args = { entity_type: 'task', content: 'Review the recorded command', source_event_ids: [event.id] };
    const one = await call<MemoryEntity>(a.client, 'graphit_add_memory', args);
    const two = await call<MemoryEntity>(a.client, 'graphit_add_memory', { ...args, entity_type: 'goal' });
    const before = f.store.readEvents(f.id);
    expect(await call(a.client, 'graphit_add_memory', args)).toEqual(one);
    expect(f.store.readEvents(f.id)).toEqual(before);
    const link = { from_memory_id: one.id, to_memory_id: two.id, relation_type: 'PART_OF', source_event_ids: [event.id] };
    const first = await call(a.client, 'graphit_link_memory', link);
    const linked = f.store.readEvents(f.id);
    expect(await call(a.client, 'graphit_link_memory', link)).toEqual(first);
    expect(f.store.readEvents(f.id)).toEqual(linked);
  });

  it.each([
    ['conversation.user_message', { content: 'user evidence' }],
    ['conversation.assistant_message', { content: 'assistant evidence' }],
    ['tool.call', { call_id: '1', tool_name: 'compiler', input: { x: 1 } }],
    ['tool.result', { call_id: '1', output: { ok: true } }],
    ['command.executed', { command_id: '1', command: 'npm test' }],
    ['command.result', { command_id: '1', exit_code: 0, stdout: 'ok', stderr: '' }],
    ['file.changed', { path: 'src/main.ts', change_type: 'modified' }],
    ['test.result', { status: 'passed', summary: 'ok' }],
  ])('accepts validated raw %s records without promotion', async (event_type, payload) => {
    const f = await fixture(); const a = await connect(f.root);
    const event = await call<GraphEvent>(a.client, 'graphit_record_event', { event_type, payload });
    expect(event.event_type).toBe(event_type); expect(event.payload).toEqual(payload);
    expect(f.memory.listMemory(f.id)).toEqual([]);
  });

  it('rejects invalid/extra arguments, malformed events, traversal, unknown IDs and cross-project evidence without partial writes', async () => {
    const f = await fixture(true);
    const foreign = f.store.initializeProject(join(f.root, 'other'), 'Other').project!.id;
    const foreignEvent = f.store.withProjectTransaction(foreign, (tx) => tx.append({ event_type: 'conversation.user_message', payload: { content: 'foreign' } }));
    const foreignMemory = f.memory.promoteMemory(foreign, { entityType: 'goal', content: 'foreign', sourceEventIds: [foreignEvent.id] });
    const a = await connect(f.root);
    const before = f.store.readEvents(f.id);
    const cases: [string, Record<string, unknown>][] = [
      ['graphit_status', { project_id: foreign }], ['graphit_context', { query: 'x', token_budget: '100' }],
      ['graphit_context', { query: 'x', current_files: ['../secret'] }],
      ['graphit_context', { query: 'x', current_files: ['C:\\secret'] }],
      ['graphit_context', { query: 'x', seed_symbols: ['f'.repeat(64)] }],
      ['graphit_get_source', { symbol_id: 'f'.repeat(64) }], ['graphit_get_source', { symbol_id: '../../secret' }],
      ['graphit_callers', { symbol_id: 'f'.repeat(64) }], ['graphit_callees', { symbol_id: 'f'.repeat(64) }],
      ['graphit_impact', { symbol_id: 'f'.repeat(64) }],
      ['graphit_record_event', { event_type: 'test.result', payload: { status: 'maybe', summary: 'bad' } }],
      ['graphit_record_event', { event_type: 'conversation.user_message', payload: { content: 'x', injected: true } }],
      ['graphit_record_event', { event_type: 'session.started', payload: {} }],
      ['graphit_record_event', { event_type: 'file.changed', payload: { path: '..\\secret', change_type: 'added' } }],
      ['graphit_add_memory', { entity_type: 'goal', content: 'bad', source_event_ids: [foreignEvent.id] }],
      ['graphit_add_memory', { entity_type: 'goal', content: 'bad', source_event_ids: [] }],
      ['graphit_link_memory', { from_memory_id: foreignMemory.id, to_memory_id: 'f'.repeat(64), relation_type: 'RELATED_TO', source_event_ids: [foreignEvent.id] }],
    ];
    for (const [name, args] of cases) { await rejects(a.client, name, args); expect(f.store.readEvents(f.id)).toEqual(before); }
    await expect(a.client.readResource({ uri: 'file:///etc/passwd' })).rejects.toThrow();
    const other = spawnSync(process.execPath, [cli, 'mcp', '--project', randomUUID()], { cwd: f.root, encoding: 'utf8', timeout: 5000 });
    expect(other.status).not.toBe(0); expect(other.stdout).toBe(''); expect(other.stderr).toContain('Project does not exist');
  });

  it('returns the canonical explicit insufficient-budget packet', async () => {
    const f = await fixture(); const a = await connect(f.root);
    const packet = await call<ContextPacket>(a.client, 'graphit_context', { query: 'continue the current work', token_budget: 1 });
    expect(packet.budget.budget_insufficient).toBe(true);
    expect(packet.budget.requested_tokens).toBe(1);
  });

  it.each(['missing', 'corrupt'])('fails closed on %s immutable source evidence', async (failure) => {
    const f = await fixture(true); const a = await connect(f.root);
    const symbol = f.graph.findSymbolsByName(f.id, 'refreshSession')[0]!;
    const db = new SqliteDatabase(f.path);
    // Deliberate fixture-only damage, simulating disk corruption; production never offers this operation.
    try {
      if (failure === 'missing') { db.exec('DROP TRIGGER source_blobs_no_delete'); db.prepare('DELETE FROM source_blobs WHERE content_hash = ?').run(symbol.span.contentHash); }
      else { db.exec('DROP TRIGGER source_blobs_no_update'); db.prepare('UPDATE source_blobs SET content = ?, byte_length = 7 WHERE content_hash = ?').run(Buffer.from('corrupt'), symbol.span.contentHash); }
    } finally { db.close(); }
    await rejects(a.client, 'graphit_get_source', { symbol_id: symbol.logical_symbol_id });
    await rejects(a.client, 'graphit_context', { query: 'refreshSession' });
  });

  it('survives an interrupted client and server restart with all acknowledged events intact', async () => {
    const f = await fixture(); const a = await connect(f.root);
    const event = await call<GraphEvent>(a.client, 'graphit_record_event', { event_type: 'test.result', payload: { status: 'passed', summary: 'durable' } });
    process.kill(a.transport.pid!, 'SIGKILL'); await a.close();
    const b = await connect(f.root);
    expect((await call<ProjectState>(b.client, 'graphit_status')).last_sequence).toBeGreaterThan(event.sequence);
    expect(f.store.readEvents(f.id).find((item) => item.id === event.id)).toEqual(event);
    await call(b.client, 'graphit_checkpoint', { name: 'after-interruption' });
  });

  it('serializes concurrent clients and preserves per-writer attribution and project sequences', async () => {
    const f = await fixture(); const [a, b] = await Promise.all([connect(f.root, 'provider-a'), connect(f.root, 'provider-b')]);
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => call<GraphEvent>(index % 2 ? b.client : a.client,
      'graphit_record_event', { event_type: 'conversation.assistant_message', payload: { content: `writer-${index % 2 ? 'b' : 'a'}-${index}` } })));
    const state = f.store.getState(f.id);
    for (const [index, event] of results.entries()) expect(state.sessions.find((session) => session.id === event.session_id)?.provider)
      .toBe(index % 2 ? 'provider-b' : 'provider-a');
    const events = f.store.readEvents(f.id);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(new Set(results.map((event) => event.id)).size).toBe(12);
    const before = f.store.readEvents(f.id);
    await rejects(a.client, 'graphit_record_event', { event_type: 'test.result', payload: { invalid: true } });
    expect(f.store.readEvents(f.id)).toEqual(before); // Includes rollback of any attempted session switch.
  });
});
