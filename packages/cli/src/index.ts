#!/usr/bin/env node
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { EventStore } from '@graphit/storage';
import type { ProjectState } from '@graphit/core';

const usage = `Graphit P0 — local project event history

  graphit init [--name <name>] [--json]
  graphit status [--json]
  graphit checkpoint [--name <name>] [--json]
  graphit resume [--checkpoint <id>] [--json]

Commands discover .graphit/graphit.db from the current directory upward.
Resume creates a new session linked to a checkpoint; it does not rewind history.`;

function findRoot(start: string): string | undefined {
  let candidate = start;
  while (true) {
    if (existsSync(join(candidate, '.graphit', 'graphit.db'))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
}

function requiredProject(store: EventStore, root: string): ProjectState {
  const state = store.findProject(root);
  if (!state?.project) throw new Error('No project matches this directory; run graphit init');
  return state;
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      name: { type: 'string' },
      checkpoint: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) { console.log(usage); return; }
  const command = positionals[0];
  if (positionals.length !== 1 || !command || !['init', 'status', 'checkpoint', 'resume'].includes(command)) {
    throw new Error(`Expected one command: init, status, checkpoint, or resume\n${usage}`);
  }
  if (values.name !== undefined && command !== 'init' && command !== 'checkpoint') throw new Error('--name is only valid for init and checkpoint');
  if (values.checkpoint !== undefined && command !== 'resume') throw new Error('--checkpoint is only valid for resume');
  const cwd = realpathSync(resolve(process.cwd()));
  const existingRoot = findRoot(cwd);
  if (command !== 'init' && !existingRoot) throw new Error('No Graphit project found; run graphit init');
  if (command === 'init' && existingRoot && existingRoot !== cwd) throw new Error(`Already inside a Graphit project: ${existingRoot}`);
  const root = existingRoot ?? cwd;
  if (command === 'init') mkdirSync(join(root, '.graphit'), { recursive: true });
  const store = new EventStore(join(root, '.graphit', 'graphit.db'));
  try {
    let output: unknown;
    let message: string;
    if (command === 'init') {
      const state = store.initializeProject(root, values.name ?? (basename(root) || 'project'));
      output = state;
      message = `Initialized ${state.project?.name}\nProject: ${state.project?.id}\nSession: ${state.active_session_id}\nDatabase: ${join(root, '.graphit', 'graphit.db')}`;
    } else {
      const state = requiredProject(store, root);
      const projectId = state.project!.id;
      switch (command) {
        case 'status':
          output = state;
          message = `Project: ${state.project!.name} (${projectId})\nEvents: ${state.last_sequence}\nActive session: ${state.active_session_id ?? 'none'}\nSessions: ${state.sessions.length}\nCheckpoints: ${state.checkpoints.length}\nLatest checkpoint: ${state.checkpoints.at(-1)?.id ?? 'none'}`;
          break;
        case 'checkpoint': {
          const checkpoint = store.checkpoint(projectId, values.name);
          output = checkpoint;
          message = `Checkpoint: ${checkpoint.id}\nName: ${checkpoint.name}\nThrough event: ${checkpoint.through_sequence}`;
          break;
        }
        case 'resume': {
          const result = store.resume(projectId, values.checkpoint);
          output = result;
          message = `Resumed checkpoint: ${result.checkpoint.id}\nNew session: ${result.session.id}\nCheckpoint context through event: ${result.checkpoint.through_sequence}\nCurrent event sequence: ${result.state.last_sequence}`;
          break;
        }
        default: throw new Error('Unknown command');
      }
    }
    console.log(values.json ? JSON.stringify(output, null, 2) : message);
  } finally {
    store.close();
  }
}

try {
  main();
} catch (error) {
  console.error(`graphit: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
