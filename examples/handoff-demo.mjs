import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log } from 'node:console';
import { EventStore } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';

// Disposable, local demonstration; no provider API calls or user repository changes.
const directory = mkdtempSync(join(tmpdir(), 'graphit-handoff-demo-'));
let store;
try {
  store = new EventStore(join(directory, 'graphit.db'), { clock: () => '2026-09-26T00:00:00.000Z' });
  const memory = new MemoryService(store);
  const project = store.initializeProject('/example/graphit', 'Graphit example').project;
  const author = store.startSession(project.id, { provider: 'provider-a', agent_name: 'agent-a' });
  const source = store.appendEvent({ project_id: project.id, session_id: author.id,
    event_type: 'conversation.user_message', payload: { content: 'Build durable local memory using SQLite, add handoff tests, and preserve the passing P0 baseline.' } });
  for (const [entityType, content] of [
    ['goal', 'Build durable project memory'], ['decision', 'Use SQLite for local persistence'],
    ['task', 'Add provider-neutral handoff tests'], ['result', 'P0 baseline tests pass'],
  ]) memory.promoteMemory(project.id, { entityType, content, sourceEventIds: [source.id] });
  store.startSession(project.id, { provider: 'provider-b', agent_name: 'agent-b' });
  log(JSON.stringify(memory.generateHandoff(project.id), null, 2));
} finally {
  store?.close();
  rmSync(directory, { recursive: true, force: true });
}
