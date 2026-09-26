import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { canonicalJson, createEvent, type AppendEventInput, type SourceEventData } from '@graphit/core';
import { EventStore } from '@graphit/storage';
import { entityTypes, memoryEntityId, relationTypes, type MemoryEntity } from '@graphit/memory';
import { fixture, message, track } from './helpers.js';

describe('explicit durable memory', () => {
  it.each(entityTypes)('promotes %s only when explicitly requested, retaining mandatory provenance', (entityType) => {
    const context = fixture();
    const source = message(context, 'why is this failing?');
    expect(context.memory.listMemory(context.id)).toEqual([]);
    const entity = context.memory.promoteMemory(context.id, { entityType, content: 'An explicit durable fact', sourceEventIds: [source.id] });
    expect(entity).toMatchObject({ project_id: context.id, entity_type: entityType, status: 'active',
      content: 'An explicit durable fact', valid_from_sequence: 4, valid_to_sequence: null, superseded_by: null, metadata: {} });
    expect(entity.source_event_ids).toContain(source.id);
    expect(entity.source_event_ids).toContain(context.store.readEvents(context.id).at(-1)!.id);
    expect(entity.created_by_session_id).toBe(source.session_id);
    expect(context.store.readEvents(context.id).find((event) => event.id === source.id)).toEqual(source);
  });

  it('has deterministic, retry-idempotent promotion independent of provenance ordering', () => {
    const context = fixture();
    const a = message(context, 'one');
    const b = message(context, 'two');
    const input = { entityType: 'decision' as const, content: 'Use SQLite', sourceEventIds: [a.id, b.id], metadata: { rationale: 'local' } };
    const first = context.memory.promoteMemory(context.id, input);
    const before = context.store.readEvents(context.id);
    const second = context.memory.promoteMemory(context.id, { ...input, sourceEventIds: [b.id, a.id] });
    expect(second).toEqual(first);
    expect(first.id).toBe(memoryEntityId(context.id, input));
    expect(context.store.readEvents(context.id)).toEqual(before);
  });

  it('fails missing and cross-project provenance without changing either project', () => {
    const context = fixture();
    const other = context.store.initializeProject(join(context.root, 'other'), 'Other');
    const foreignSource = context.store.readEvents(other.project!.id)[0]!;
    const before = context.store.readEvents(context.id);
    for (const sourceEventIds of [[], ['f'.repeat(64)], [foreignSource.id]]) {
      expect(() => context.memory.promoteMemory(context.id, { entityType: 'task', content: 'Do it', sourceEventIds })).toThrow();
    }
    expect(context.store.readEvents(context.id)).toEqual(before);
    expect(context.memory.listMemory(context.id)).toEqual([]);
    expect(context.store.readEvents(other.project!.id)).toHaveLength(2);
  });

  it('fails malformed memory payloads and missing projection handlers closed', () => {
    const context = fixture();
    const source = message(context, 'source');
    const before = context.store.readEvents(context.id);
    const envelope = { project_id: context.id, session_id: source.session_id, event_type: 'memory.entity.created' as const };
    const valid = { entity_id: memoryEntityId(context.id, { entityType: 'task', content: 'task', sourceEventIds: [source.id] }),
      entity_type: 'task', content: 'task', source_event_ids: [source.id], metadata: {} };
    for (const payload of [{}, { ...valid, source_event_ids: [] }, { ...valid, extra: 'no' },
      { ...valid, entity_type: 'invented' }, { ...valid, entity_id: '0'.repeat(64) },
      { ...valid, content: '  ' }, { ...valid, metadata: { bad: undefined } }]) {
      expect(() => context.store.appendEvent({ ...envelope, payload } as AppendEventInput)).toThrow();
    }
    const withoutMemory = track(new EventStore(context.path));
    expect(() => withoutMemory.appendEvent({ ...envelope, payload: valid })).toThrow('projection handler');
    expect(context.store.readEvents(context.id)).toEqual(before);
  });

  it('rejects events from inactive or nonexistent sessions', () => {
    const context = fixture();
    const source = message(context, 'old session');
    context.store.startSession(context.id, { provider: 'arbitrary-provider' });
    for (const session_id of [source.session_id, randomUUID()]) {
      expect(() => context.store.appendEvent({ project_id: context.id, session_id,
        event_type: 'conversation.assistant_message', payload: { content: 'stale writer' } })).toThrow('active session');
    }
  });
});

describe('temporal transitions and relationships', () => {
  it('preserves Neo4j history while exposing SQLite as the sole active decision', () => {
    const context = fixture();
    const neo4j = message(context, 'Use Neo4j');
    const a = context.memory.promoteMemory(context.id, { entityType: 'decision', content: 'Use Neo4j', sourceEventIds: [neo4j.id] });
    const sqlite = message(context, 'Use SQLite');
    const before = context.store.readEvents(context.id);
    const { previous, replacement } = context.memory.supersedeMemory(context.id, a.id, { content: 'Use SQLite', sourceEventIds: [sqlite.id] });
    expect(previous).toMatchObject({ status: 'superseded', content: 'Use Neo4j', superseded_by: replacement.id,
      valid_from_sequence: a.valid_from_sequence, valid_to_sequence: before.length + 2 });
    expect(replacement).toMatchObject({ status: 'active', content: 'Use SQLite', valid_to_sequence: null });
    expect(context.memory.getMemoryState(context.id, a.valid_from_sequence).entities).toEqual([a]);
    expect(context.store.readEvents(context.id).slice(0, before.length)).toEqual(before);
    const packet = context.memory.generateHandoff(context.id);
    expect(packet.decisions.map((entity) => entity.content)).toEqual(['Use SQLite']);
    expect(packet.history.find((entity) => entity.id === a.id)).toEqual(previous);
    expect(packet.relations).toContainEqual(expect.objectContaining({ relation_type: 'SUPERSEDES', from_entity_id: replacement.id, to_entity_id: a.id }));
    expect(packet.evidence.map((event) => event.id)).toEqual(expect.arrayContaining([neo4j.id, sqlite.id]));
  });

  it.each(['task', 'goal', 'action', 'blocker', 'question'] as const)('resolves %s by appending a transition event', (entityType) => {
    const context = fixture();
    const source = message(context, 'Work to finish');
    const item = context.memory.promoteMemory(context.id, { entityType, content: 'Work to finish', sourceEventIds: [source.id] });
    const original = context.store.readEvents(context.id);
    const resolved = context.memory.resolveMemory(context.id, item.id);
    expect(resolved.status).toBe(['blocker', 'question'].includes(entityType) ? 'resolved' : 'completed');
    expect(resolved.content).toBe(item.content);
    expect(context.store.readEvents(context.id).slice(0, original.length)).toEqual(original);
    expect(context.store.readEvents(context.id).at(-1)!.event_type).toBe('memory.entity.status_changed');
    expect(context.memory.getMemoryState(context.id, item.valid_from_sequence).entities[0]!.status).toBe('active');
    expect(() => context.memory.resolveMemory(context.id, item.id)).toThrow('Terminal');
  });

  it('distinguishes active/completed tasks and unresolved blockers/questions', () => {
    const context = fixture();
    const source = message(context, 'requirements');
    const promote = (entityType: MemoryEntity['entity_type'], content: string) => context.memory.promoteMemory(context.id,
      { entityType, content, sourceEventIds: [source.id] });
    const active = promote('task', 'active');
    const completed = promote('task', 'done');
    const blocker = promote('blocker', 'blocked');
    const question = promote('question', 'why?');
    promote('constraint', 'Stay local');
    promote('result', 'tests passed');
    promote('artifact', 'report.json');
    context.memory.changeStatus(context.id, active.id, 'in_progress');
    context.memory.resolveMemory(context.id, completed.id);
    context.memory.resolveMemory(context.id, blocker.id);
    context.memory.resolveMemory(context.id, question.id);
    const packet = context.memory.generateHandoff(context.id);
    expect(packet.active_tasks.map((entity) => entity.id)).toEqual([active.id]);
    expect(packet.completed_tasks.map((entity) => entity.id)).toEqual([completed.id]);
    expect(packet.blockers).toEqual([]);
    expect(packet.open_questions).toEqual([]);
    expect(packet.constraints[0]!.content).toBe('Stay local');
    expect(packet.recent_results[0]!.content).toBe('tests passed');
    expect(packet.artifacts[0]!.content).toBe('report.json');
  });

  it('rolls back replacement creation if supersession is invalid', () => {
    const context = fixture();
    const source = message(context, 'source');
    const a = context.memory.promoteMemory(context.id, { entityType: 'decision', content: 'A', sourceEventIds: [source.id] });
    context.memory.supersedeMemory(context.id, a.id, { content: 'B', sourceEventIds: [source.id] });
    const events = context.store.readEvents(context.id);
    const state = context.memory.getMemoryState(context.id);
    expect(() => context.memory.supersedeMemory(context.id, a.id, { content: 'C', sourceEventIds: [source.id] })).toThrow('supersession');
    expect(context.store.readEvents(context.id)).toEqual(events);
    expect(context.memory.getMemoryState(context.id)).toEqual(state);
  });

  it.each(relationTypes)('replays %s relationships with provenance', (relationType) => {
    const context = fixture();
    const source = message(context, 'relation evidence');
    const a = context.memory.promoteMemory(context.id, { entityType: 'decision', content: 'A', sourceEventIds: [source.id] });
    const b = context.memory.promoteMemory(context.id, { entityType: 'decision', content: 'B', sourceEventIds: [source.id] });
    const input = { fromEntityId: b.id, toEntityId: a.id, relationType, sourceEventIds: [source.id] };
    const relation = context.memory.linkMemory(context.id, input);
    expect(relation.source_event_ids).toContain(source.id);
    expect(context.memory.getMemoryState(context.id).relations).toEqual([relation]);
    expect(context.memory.linkMemory(context.id, input)).toEqual(relation);
    if (relationType === 'SUPERSEDES') expect(context.memory.getMemoryState(context.id).entities[0]!.status).toBe('superseded');
  });

  it('rejects relationship endpoints outside the project and forged transitions', () => {
    const context = fixture();
    const source = message(context, 'source');
    const a = context.memory.promoteMemory(context.id, { entityType: 'decision', content: 'A', sourceEventIds: [source.id] });
    expect(() => context.memory.linkMemory(context.id, { fromEntityId: a.id, toEntityId: 'f'.repeat(64),
      relationType: 'RELATED_TO', sourceEventIds: [source.id] })).toThrow('does not exist');
    expect(() => context.memory.changeStatus(context.id, a.id, 'completed')).toThrow('Invalid decision status');
    expect(() => context.memory.resolveMemory(context.id, a.id)).toThrow('Cannot resolve');
  });
});

describe('projection preservation', () => {
  it('fails closed on hash-valid but semantically corrupt history before clearing projections', () => {
    const context = fixture();
    const source = message(context, 'real evidence');
    context.memory.promoteMemory(context.id, { entityType: 'goal', content: 'Valid goal', sourceEventIds: [source.id] });
    const database = track(new DatabaseSync(context.path));
    const before = database.prepare('SELECT * FROM memory_entities').all();
    const fakeSource = 'f'.repeat(64);
    const invalid = createEvent({ project_id: context.id, session_id: source.session_id,
      sequence: context.store.getState(context.id).last_sequence + 1, created_at: source.created_at,
      event_type: 'memory.entity.created', payload: {
        entity_id: memoryEntityId(context.id, { entityType: 'decision', content: 'Forged', sourceEventIds: [fakeSource] }),
        entity_type: 'decision', content: 'Forged', source_event_ids: [fakeSource], metadata: {},
      } });
    database.prepare(`INSERT INTO events (id, project_id, session_id, sequence, event_type, payload, created_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(invalid.id, invalid.project_id, invalid.session_id, invalid.sequence, invalid.event_type,
        canonicalJson(invalid.payload), invalid.created_at, invalid.content_hash);
    expect(() => context.memory.generateHandoff(context.id)).toThrow('Provenance');
    expect(() => context.memory.rebuildMemoryProjection(context.id)).toThrow('Provenance');
    expect(database.prepare('SELECT * FROM memory_entities').all()).toEqual(before);
    expect(context.store.readEvents(context.id).at(-1)).toEqual(invalid);
  });

  it('recreates identical project-scoped rows and handoff after deleting derived memory', () => {
    const context = fixture();
    const raw = message(context, 'unpromoted conversation');
    const source = message(context, 'source decision');
    const a = context.memory.promoteMemory(context.id, { entityType: 'decision', content: 'A', sourceEventIds: [source.id] });
    context.memory.supersedeMemory(context.id, a.id, { content: 'B', sourceEventIds: [source.id] });
    const other = context.store.initializeProject(join(context.root, 'other'), 'Other').project!.id;
    const otherSource = context.store.readEvents(other)[0]!;
    context.memory.promoteMemory(other, { entityType: 'goal', content: 'Other project', sourceEventIds: [otherSource.id] });
    const database = track(new DatabaseSync(context.path));
    const rows = () => database.prepare('SELECT * FROM memory_entities ORDER BY project_id, id').all();
    const originalRows = rows();
    const originalRelations = database.prepare('SELECT * FROM memory_relations').all();
    const events = database.prepare('SELECT * FROM events ORDER BY project_id, sequence').all();
    const packet = context.memory.generateHandoff(context.id);
    database.prepare('DELETE FROM memory_relations WHERE project_id = ?').run(context.id);
    database.prepare('DELETE FROM memory_entities WHERE project_id = ?').run(context.id);
    context.memory.rebuildMemoryProjection(context.id);
    expect(rows()).toEqual(originalRows);
    expect(database.prepare('SELECT * FROM memory_relations').all()).toEqual(originalRelations);
    database.exec('DELETE FROM memory_relations; DELETE FROM memory_entities;');
    expect(canonicalJson(context.memory.generateHandoff(context.id))).toBe(canonicalJson(packet));
    expect(database.prepare('SELECT * FROM memory_entities WHERE project_id = ?').all(other)).toEqual([]);
    expect(database.prepare('SELECT * FROM events ORDER BY project_id, sequence').all()).toEqual(events);
    expect(context.store.readEvents(context.id).some((event) => event.id === raw.id)).toBe(true);
    expect(packet.evidence.some((event) => event.id === raw.id)).toBe(false);
  });

  it('rolls back source and derived rows if memory projection persistence fails', () => {
    const context = fixture();
    const source = message(context, 'source');
    const database = track(new DatabaseSync(context.path));
    database.exec(`CREATE TRIGGER test_memory_failure BEFORE INSERT ON memory_entities
      BEGIN SELECT RAISE(ABORT, 'injected memory projection failure'); END;`);
    const events = context.store.readEvents(context.id);
    expect(() => context.memory.promoteMemory(context.id, { entityType: 'goal', content: 'goal', sourceEventIds: [source.id] })).toThrow('injected');
    expect(context.store.readEvents(context.id)).toEqual(events);
    expect(context.memory.getMemoryState(context.id).entities).toEqual([]);
  });
});

describe('provider-neutral raw source schemas', () => {
  const cases: SourceEventData[] = [
    { event_type: 'conversation.user_message', payload: { content: 'user', metadata: { format: 'any' } } },
    { event_type: 'conversation.assistant_message', payload: { content: 'assistant' } },
    { event_type: 'tool.call', payload: { call_id: 'call-1', tool_name: 'inspect', input: { path: 'src' } } },
    { event_type: 'tool.result', payload: { call_id: 'call-1', output: ['file.ts'], is_error: false } },
    { event_type: 'command.executed', payload: { command_id: 'cmd-1', command: 'npm test' } },
    { event_type: 'command.result', payload: { command_id: 'cmd-1', exit_code: 0, stdout: 'passed', stderr: '' } },
    { event_type: 'file.changed', payload: { path: 'src/index.ts', change_type: 'modified', diff: '+line' } },
    { event_type: 'test.result', payload: { status: 'passed', summary: 'all tests passed' } },
  ];
  it.each(cases)('validates and preserves $event_type without automatic promotion', (input) => {
    const context = fixture();
    const base = { project_id: context.id, session_id: context.store.getState(context.id).active_session_id! };
    const event = context.store.appendEvent({ ...base, ...input });
    expect(event.payload).toEqual(input.payload);
    expect(context.memory.listMemory(context.id)).toEqual([]);
    expect(() => context.store.appendEvent({ ...base, event_type: input.event_type, payload: {} } as AppendEventInput)).toThrow();
    expect(context.store.readEvents(context.id).at(-1)).toEqual(event);
  });
});
