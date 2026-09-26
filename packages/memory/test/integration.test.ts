import { execFile, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { SqliteDatabase } from '@graphit/storage';
import { describe, expect, it } from 'vitest';
import { reconstructState, type ProjectState, type Session } from '@graphit/core';
import { buildHandoff, replayMemory, type HandoffPacket, type MemoryEntity } from '@graphit/memory';
import { fixture, message, track } from './helpers.js';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url));
function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
}
function json<T>(root: string, ...args: string[]): T {
  const result = run(root, ...args, '--json');
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as T;
}

describe('process and provider boundaries', () => {
  it('verifies and exactly regenerates the checked-in handoff example from its evidence', () => {
    const packet = JSON.parse(readFileSync(new URL('../../../examples/handoff.json', import.meta.url), 'utf8')) as HandoffPacket;
    expect(buildHandoff(reconstructState(packet.evidence), replayMemory(packet.evidence), packet.evidence)).toEqual(packet);
  });

  it('hands provider A memory to provider B after A exits, with exact provider-neutral evidence', async () => {
    const context = fixture();
    const script = `import { EventStore } from '@graphit/storage';
      import { MemoryService } from '@graphit/memory';
      const store = new EventStore(process.argv[1]);
      const memory = new MemoryService(store);
      try {
        const id = process.argv[2];
        const session = store.startSession(id, { provider: 'anthropic', agent_name: 'claude-code', external_session_id: 'external-A' });
        const source = store.appendEvent({ project_id: id, session_id: session.id,
          event_type: 'conversation.user_message', payload: { content: 'Build a local event-sourced memory system using SQLite.' } });
        for (const [entityType, content] of [['goal','Build project memory'], ['decision','Use SQLite'],
          ['task','Add memory tests'], ['result','Baseline tests passed']]) {
          memory.promoteMemory(id, { entityType, content, sourceEventIds: [source.id] });
        }
        console.log(JSON.stringify({ session, source }));
      } finally { store.close(); }`;
    const exitedA = await execute(process.execPath, ['--input-type=module', '-e', script, context.path, context.id], { cwd: process.cwd() });
    const a = JSON.parse(exitedA.stdout) as { session: Session; source: { id: string } };
    const before = context.store.readEvents(context.id);
    const b = json<Session>(context.root, 'session', 'start', '--provider', 'openai', '--agent', 'codex', '--model', 'gpt-6-astra');
    expect(b.id).not.toBe(a.session.id);
    const packet = json<HandoffPacket>(context.root, 'handoff');
    expect(packet.current_session).toMatchObject({ provider: 'openai', agent_name: 'codex', model_name: 'gpt-6-astra' });
    expect(packet.goals[0]!.content).toBe('Build project memory');
    expect(packet.decisions[0]!.content).toBe('Use SQLite');
    expect(packet.active_tasks[0]!.content).toBe('Add memory tests');
    expect(packet.recent_results[0]!.content).toBe('Baseline tests passed');
    expect(packet.goals[0]!.created_by_session_id).toBe(a.session.id);
    expect(packet.evidence.some((event) => event.id === a.source.id)).toBe(true);
    for (const item of [...packet.goals, ...packet.decisions, ...packet.active_tasks, ...packet.recent_results]) {
      expect(item.source_event_ids.every((id) => packet.evidence.some((event) => event.id === id))).toBe(true);
    }
    expect(context.store.readEvents(context.id).slice(0, before.length)).toEqual(before);
    const plain = run(context.root, 'handoff');
    expect(plain.status).toBe(0);
    expect(JSON.parse(plain.stdout)).toEqual(packet);
    const database = track(new SqliteDatabase(context.path));
    database.exec('DELETE FROM memory_relations; DELETE FROM memory_entities;');
    expect(json<HandoffPacket>(context.root, 'handoff')).toEqual(packet);
  });

  it('serializes concurrent memory promotions across independent processes', async () => {
    const context = fixture();
    const script = `import { EventStore } from '@graphit/storage';
      import { MemoryService } from '@graphit/memory';
      const store = new EventStore(process.argv[1]);
      const memory = new MemoryService(store);
      try {
        const id = process.argv[2];
        for (let i = 0; i < 5; i++) {
          const content = process.argv[3] + ':' + i;
          const source = store.appendEvent({ project_id: id, session_id: store.getState(id).active_session_id,
            event_type: 'conversation.user_message', payload: { content } });
          memory.promoteMemory(id, { entityType: 'task', content, sourceEventIds: [source.id] });
        }
      } finally { store.close(); }`;
    await Promise.all(Array.from({ length: 4 }, (_, worker) => execute(process.execPath,
      ['--input-type=module', '-e', script, context.path, context.id, String(worker)], { cwd: process.cwd() })));
    const events = context.store.readEvents(context.id);
    expect(events.map((event) => event.sequence)).toEqual(Array.from({ length: 42 }, (_, index) => index + 1));
    expect(new Set(events.map((event) => event.id)).size).toBe(42);
    expect(context.memory.listMemory(context.id)).toHaveLength(20);
  });
});

describe('P1 CLI and P0 compatibility', () => {
  it('supports memory add/list/supersede/resolve with filters and P0 resume', () => {
    const context = fixture();
    const sourceA = message(context, 'Use Neo4j');
    const a = json<MemoryEntity>(context.root, 'memory', 'add', '--type', 'decision', '--content', 'Use Neo4j', '--source-event', sourceA.id);
    const sourceB = message(context, 'Use SQLite');
    const result = json<{ previous: MemoryEntity; replacement: MemoryEntity }>(context.root,
      'memory', 'supersede', a.id, '--content', 'Use SQLite', '--source-event', sourceB.id);
    const filtered = json<MemoryEntity[]>(context.root, 'memory', 'list', '--type', 'decision', '--status', 'active');
    expect(filtered).toEqual([result.replacement]);
    expect(json<MemoryEntity[]>(context.root, 'memory', 'list', '--status', 'superseded')).toEqual([result.previous]);
    const task = json<MemoryEntity>(context.root, 'memory', 'add', '--type', 'task', '--content', 'Build P1',
      '--source-event', sourceA.id, '--source-event', sourceB.id);
    expect(json<MemoryEntity>(context.root, 'memory', 'resolve', task.id).status).toBe('completed');
    const checkpoint = context.store.checkpoint(context.id);
    const resume = json<{ checkpoint: { id: string }; state: ProjectState }>(context.root, 'resume');
    expect(resume.checkpoint.id).toBe(checkpoint.id);
    expect(json<HandoffPacket>(context.root, 'handoff').completed_tasks[0]!.id).toBe(task.id);
    expect(run(context.root, 'memory', 'list').stdout).toContain('Use SQLite');
  });

  it('supports an existing replacement and arbitrary or absent session metadata', () => {
    const context = fixture();
    const source = message(context, 'evidence');
    const add = (content: string) => json<MemoryEntity>(context.root, 'memory', 'add', '--type', 'decision', '--content', content, '--source-event', source.id);
    const a = add('A');
    const b = add('B');
    expect(json<{ previous: MemoryEntity }>(context.root, 'memory', 'supersede', a.id, '--with', b.id).previous.superseded_by).toBe(b.id);
    const session = json<Session>(context.root, 'session', 'start', '--provider', 'future-vendor', '--agent', 'custom-agent',
      '--external-session-id', 'external-42', '--client', 'local-client');
    expect(session).toMatchObject({ provider: 'future-vendor', agent_name: 'custom-agent', external_session_id: 'external-42', client_name: 'local-client' });
    const unspecified = json<Session>(context.root, 'session', 'start');
    expect(unspecified).not.toHaveProperty('provider');
    expect(unspecified).not.toHaveProperty('agent_name');
  });

  it.each([
    ['memory', 'add', '--type', 'decision', '--content', 'no evidence'],
    ['memory', 'add', '--type', 'made-up', '--content', 'invalid', '--source-event', 'no'],
    ['memory', 'list', '--status', 'made-up'],
    ['memory', 'supersede', 'missing'],
    ['memory', 'resolve', 'missing'],
    ['handoff', '--content', 'unexpected'],
    ['session', 'start', '--provider', ''],
  ])('rejects invalid P1 command %j without adding events', (...args) => {
    const context = fixture();
    const events = context.store.readEvents(context.id);
    expect(run(context.root, ...args).status).toBe(1);
    expect(context.store.readEvents(context.id)).toEqual(events);
  });
});
