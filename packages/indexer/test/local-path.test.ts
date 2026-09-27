import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalLocalPath } from '@graphit/core';
import { EventStore } from '@graphit/storage';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry, RepositoryIndexer } from '@graphit/indexer';
import { openGraphit } from '@graphit/mcp';
import { temporary, track } from './helpers.js';

// Simulate macOS /var -> /private/var on every OS (junctions need no Windows
// symlink privilege). Keep both paths under the fixture's cleanup directory.
function aliases() {
  const parent = temporary();
  const real = join(parent, 'private', 'var');
  const alias = join(parent, 'var');
  mkdirSync(real, { recursive: true });
  symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  return { real, alias };
}

describe('canonical local project identity', () => {
  it('resolves aliases and not-yet-created descendants through the same helper', () => {
    const { real, alias } = aliases();
    expect(canonicalLocalPath(alias)).toBe(realpathSync.native(real));
    expect(canonicalLocalPath(join(alias, 'new', 'project'))).toBe(join(realpathSync.native(real), 'new', 'project'));
    if (process.platform === 'win32') {
      expect(canonicalLocalPath(real[0]!.toLowerCase() + real.slice(1))).toBe(canonicalLocalPath(real));
    }
  });

  it('initializes once across aliases and discovers the same project after reopening', () => {
    const { real, alias } = aliases();
    mkdirSync(join(real, '.graphit'));
    const store = track(new EventStore(join(alias, '.graphit', 'graphit.db')));
    const state = store.initializeProject(alias, 'Alias');
    expect(state.project!.root_path).toBe(canonicalLocalPath(real));
    expect(store.findProject(real)?.project!.id).toBe(state.project!.id);
    expect(() => store.initializeProject(real, 'Duplicate')).toThrow('already initialized');
    const reopened = track(new EventStore(join(real, '.graphit', 'graphit.db')));
    expect(reopened.findProject(alias)).toEqual(state);
  });

  it('indexes legacy alias-path history without rewriting source events and retains subtree safety', async () => {
    const { real, alias } = aliases();
    mkdirSync(join(real, '.graphit'));
    writeFileSync(join(real, 'example.ts'), 'export function aliasEvidence() { return 1; }');
    const store = track(new EventStore(join(real, '.graphit', 'graphit.db')));
    const project_id = randomUUID(), session_id = randomUUID();
    store.appendEvent({ project_id, session_id, event_type: 'project.created', payload: { name: 'Legacy', root_path: alias } });
    store.appendEvent({ project_id, session_id, event_type: 'session.started', payload: {} });
    const history = store.readEvents(project_id);
    const parsers = await createParserRegistry();
    const graph = new CodeGraphService(store, parsers);
    const indexer = new RepositoryIndexer(store, graph, parsers);
    expect(indexer.index(project_id, real).status).toBe('completed');
    expect(indexer.index(project_id, alias).status).toBe('completed');
    expect(store.readEvents(project_id).slice(0, history.length)).toEqual(history);
    expect(store.getState(project_id).project!.root_path).toBe(alias);
    expect(graph.getGraph(project_id).files[0]!.observation.path).toBe('example.ts');
    mkdirSync(join(real, 'subtree'));
    expect(() => indexer.index(project_id, join(alias, 'subtree'))).toThrow('not a subtree');
    const mcp = await openGraphit({ project: alias });
    mcp.close();
    const cli = fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url));
    for (const args of [['status', '--json'], ['doctor', '--json'], ['index', alias, '--json']]) {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: real, encoding: 'utf8' });
      expect(result.status, result.stderr + result.stdout).toBe(0);
    }
  });

  it('honors a moved/imported project binding via either alias without changing historical paths', () => {
    const { real, alias } = aliases();
    mkdirSync(join(real, '.graphit'));
    const store = track(new EventStore(join(alias, '.graphit', 'graphit.db')));
    const historicalRoot = join(temporary(), 'original-location');
    const state = store.initializeProject(historicalRoot, 'Moved');
    writeFileSync(join(real, '.graphit', 'project.json'), JSON.stringify({ project_id: state.project!.id }));
    const events = store.readEvents(state.project!.id);
    expect(store.findProject(real)).toEqual(state);
    expect(store.findProject(alias)).toEqual(state);
    expect(store.readEvents(state.project!.id)).toEqual(events);
    expect(store.getState(state.project!.id).project!.root_path).toBe(canonicalLocalPath(historicalRoot));
  });
});
