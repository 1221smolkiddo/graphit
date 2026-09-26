import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Checkpoint, ProjectState } from '@graphit/core';
import type { ResumeResult } from '@graphit/storage';
import type { CodeSymbol, IndexRun } from '@graphit/codegraph';

const executable = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const directories: string[] = [];

function temporary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'graphit-cli-test-'));
  directories.push(directory);
  return directory;
}

function run(cwd: string, ...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [executable, ...args], { cwd, encoding: 'utf8' });
}

function json<T>(cwd: string, ...args: string[]): T {
  const result = run(cwd, ...args, '--json');
  expect(result.status, String(result.stderr)).toBe(0);
  return JSON.parse(String(result.stdout)) as T;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('graphit CLI', () => {
  it('indexes a non-Git repository, disambiguates names and serves preserved source across processes', () => {
    const root = temporary();
    writeFileSync(join(root, 'one.ts'), 'export function value(){ return 1; }\nexport function caller(){ return value(); }');
    writeFileSync(join(root, 'two.ts'), 'export function value(){ return 2; }');
    const indexed = json<IndexRun>(root, 'index', '.'); expect(indexed.status).toBe('completed'); expect(indexed.files_changed).toBe(2);
    const symbols = json<{ ambiguous: boolean; candidates: CodeSymbol[] }>(root, 'code', 'symbol', 'value');
    expect(symbols.ambiguous).toBe(true); expect(symbols.candidates).toHaveLength(2);
    expect(json<{ ambiguous: boolean; candidates: CodeSymbol[] }>(root, 'code', 'callers', 'value')).toEqual(symbols);
    const original = symbols.candidates.find((item) => item.path === 'one.ts')!;
    writeFileSync(join(root, 'one.ts'), 'export function value(){ return 3; }');
    expect(json<{ content: string }>(root, 'code', 'source', original.logical_symbol_id).content).toContain('return 1');
    expect(json<unknown[]>(root, 'code', 'callers', original.logical_symbol_id)).toHaveLength(1);
    expect(json<unknown[]>(root, 'code', 'imports', 'one.ts')).toEqual([]);
    expect(json<IndexRun>(root, 'index', '.', '--rebuild').status).toBe('completed');
    expect(json<{ content: string }>(root, 'code', 'source', original.symbol_version_id).content).toContain('return 1');
    expect(json<{ files: number; last_index_status: string }>(root, 'code', 'stats')).toMatchObject({ files: 2, last_index_status: 'completed' });
    expect(json<IndexRun>(root, 'index', '.').metrics.files_parsed).toBe(0);
  }, 30000);

  it('returns an explicit failed index summary and nonzero exit for syntax errors', () => {
    const root = temporary(); writeFileSync(join(root, 'broken.ts'), 'export function broken( {');
    const result = run(root, 'index', '.', '--json'); expect(result.status).toBe(1);
    expect(JSON.parse(String(result.stdout))).toMatchObject({ status: 'failed', parse_errors: 1 });
    expect(json<{ last_index_status: string; files: number }>(root, 'code', 'stats')).toMatchObject({ last_index_status: 'failed', files: 0 });
  });

  it('runs init → status → checkpoint → resume across separate processes', () => {
    const root = temporary();
    const initial = json<ProjectState>(root, 'init', '--name', 'Example');
    expect(initial.project?.name).toBe('Example');
    expect(initial.last_sequence).toBe(2);
    expect(existsSync(join(root, '.graphit', 'graphit.db'))).toBe(true);
    expect(json<ProjectState>(root, 'status')).toEqual(initial);
    const checkpoint = json<Checkpoint>(root, 'checkpoint', '--name', 'first');
    expect(checkpoint.through_sequence).toBe(2);
    const resumed = json<ResumeResult>(root, 'resume');
    expect(resumed.checkpoint.id).toBe(checkpoint.id);
    expect(resumed.checkpoint_state).toEqual(initial);
    expect(resumed.session.id).not.toBe(initial.active_session_id);
    const status = json<ProjectState>(root, 'status');
    expect(status.last_sequence).toBe(4);
    expect(status.sessions).toHaveLength(2);
    expect(status.checkpoints).toHaveLength(1);
  });

  it('discovers the project from a nested directory and rejects nested initialization', () => {
    const root = temporary();
    const initial = json<ProjectState>(root, 'init');
    const nested = join(root, 'src', 'nested');
    mkdirSync(nested, { recursive: true });
    expect(json<ProjectState>(nested, 'status')).toEqual(initial);
    const result = run(nested, 'init');
    expect(result.status).toBe(1);
    expect(String(result.stderr)).toContain('Already inside');
    expect(existsSync(join(nested, '.graphit'))).toBe(false);
  });

  it('rejects duplicate initialization without changing history', () => {
    const root = temporary();
    const initial = json<ProjectState>(root, 'init');
    expect(run(root, 'init').status).toBe(1);
    expect(json<ProjectState>(root, 'status')).toEqual(initial);
  });

  it.each(['status', 'checkpoint', 'resume'])('fails %s outside a project without creating a database', (command) => {
    const root = temporary();
    const result = run(root, command);
    expect(result.status).toBe(1);
    expect(String(result.stderr)).toContain('run graphit init');
    expect(existsSync(join(root, '.graphit'))).toBe(false);
  });

  it('resumes a specified checkpoint and preserves state on invalid checkpoint requests', () => {
    const root = temporary();
    json(root, 'init');
    const first = json<Checkpoint>(root, 'checkpoint');
    json(root, 'checkpoint', '--name', 'newer');
    expect(json<ResumeResult>(root, 'resume', '--checkpoint', first.id).checkpoint.id).toBe(first.id);
    const before = json<ProjectState>(root, 'status');
    expect(run(root, 'resume', '--checkpoint', 'missing').status).toBe(1);
    expect(json<ProjectState>(root, 'status')).toEqual(before);
  });

  it('fails resume without a checkpoint and rejects invalid checkpoint payloads', () => {
    const root = temporary();
    const initial = json<ProjectState>(root, 'init');
    expect(run(root, 'resume').status).toBe(1);
    expect(run(root, 'checkpoint', '--name', '   ').status).toBe(1);
    expect(json<ProjectState>(root, 'status')).toEqual(initial);
  });

  it.each([
    ['unknown'], ['status', 'extra'], ['status', '--name', 'wrong'],
    ['init', '--checkpoint', 'wrong'], ['init', '--wat'], [],
  ])('rejects unsupported CLI arguments %j', (...args) => {
    const root = temporary();
    expect(run(root, ...args).status).toBe(1);
    expect(existsSync(join(root, '.graphit'))).toBe(false);
  });

  it('prints help and useful human-readable command output', () => {
    const root = temporary();
    expect(String(run(root, '--help').stdout)).toContain('graphit checkpoint');
    expect(String(run(root, 'init').stdout)).toContain('Initialized');
    expect(String(run(root, 'status').stdout)).toContain('Events: 2');
    expect(String(run(root, 'checkpoint').stdout)).toContain('Through event: 2');
    expect(String(run(root, 'resume').stdout)).toContain('New session:');
  });
});
