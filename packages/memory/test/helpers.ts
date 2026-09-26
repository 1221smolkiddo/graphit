import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { EventStore } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';

const directories: string[] = [];
const handles = new Set<{ close(): void }>();
export function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'graphit-p1-test-'));
  directories.push(directory);
  return directory;
}
export function track<T extends { close(): void }>(handle: T): T { handles.add(handle); return handle; }
export function close(handle: { close(): void }): void { handle.close(); handles.delete(handle); }
export function fixture(): { root: string; path: string; store: EventStore; memory: MemoryService; id: string } {
  const root = temporary();
  mkdirSync(join(root, '.graphit'));
  const path = join(root, '.graphit', 'graphit.db');
  const store = track(new EventStore(path));
  const memory = new MemoryService(store);
  const id = store.initializeProject(root, 'P1 test').project!.id;
  return { root, path, store, memory, id };
}
export type Fixture = ReturnType<typeof fixture>;
export function message(context: Fixture, content: string) {
  return context.store.appendEvent({ project_id: context.id, session_id: context.store.getState(context.id).active_session_id!,
    event_type: 'conversation.user_message', payload: { content } });
}
afterEach(() => {
  for (const handle of [...handles].reverse()) close(handle);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
