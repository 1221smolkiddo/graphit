// Release acceptance: install the actual tarball outside this workspace; all Graphit actions use that installation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const archive = realpathSync(resolve(process.argv[2] ?? 'graphit-0.1.0.tgz'));
const sandbox = mkdtempSync(join(tmpdir(), 'graphit-packed-'));
const clients = new Set();
const env = { ...process.env }; delete env.NODE_PATH; delete env.NODE_OPTIONS;
const prefix = join(sandbox, 'prefix');
const project = join(sandbox, 'project');
const imported = join(sandbox, 'imported');
const installedRoot = join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'graphit');
const cli = join(installedRoot, 'dist/cli/index.js');
function run(cwd, ...args) { return execFileSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function connect(cwd, provider, agent) {
  const client = new Client({ name: agent, version: '1' }); clients.add(client);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [cli, 'mcp', '--project', cwd, '--provider', provider, '--agent', agent], cwd, stderr: 'pipe',
    env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) });
  await client.connect(transport); return { client, transport };
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args }); assert.notEqual(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content.find((item) => item.type === 'text').text);
}
try {
  assert.ok(process.env.npm_execpath, 'Run with npm run verify:packed -- <tarball>');
  execFileSync(process.execPath, [process.env.npm_execpath, 'install', '--global', '--prefix', prefix, archive,
    '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: sandbox, env, stdio: 'pipe' });
  assert.ok(existsSync(cli));
  assert.equal(existsSync(join(installedRoot, 'packages')), false, 'No workspace is shipped');
  assert.equal(existsSync(join(installedRoot, 'node_modules/@graphit')), false, 'No private runtime package resolution');
  const metadata = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
  assert.equal(metadata.version, '0.1.0'); assert.equal(metadata.bin.graphit, 'dist/cli/index.js');
  const binary = process.platform === 'win32' ? join(prefix, 'graphit.cmd') : join(prefix, 'bin/graphit');
  const version = process.platform === 'win32'
    ? execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${binary}" --version"`], { cwd: sandbox, env, encoding: 'utf8', windowsVerbatimArguments: true })
    : execFileSync(binary, ['--version'], { cwd: sandbox, env, encoding: 'utf8' });
  assert.equal(version.trim(), 'graphit 0.1.0');
  assert.ok(run(sandbox, '--help').includes('graphit export'));
  assert.ok(run(sandbox, 'doctor').includes('project_initialized: false'));
  mkdirSync(project); mkdirSync(imported);
  writeFileSync(join(project, 'example.ts'), 'export function greet(name: string) { return `Hello ${name}`; }\nexport function main() { return greet("World"); }\n');
  run(project, 'init', '--name', 'Fresh Install Test');
  run(project, 'index', '.');
  const stats = JSON.parse(run(project, 'code', 'stats', '--json')); assert.ok(stats.symbols > 0 && stats.edges > 0);
  const context = JSON.parse(run(project, 'context', 'explain this project', '--tokens', '1500', '--json'));
  assert.equal(context.budget.budget_insufficient, false); assert.ok(context.budget.estimated_tokens <= 1500);
  run(project, 'handoff'); run(project, 'mcp', 'doctor');
  const a = await connect(project, 'anthropic', 'claude-code');
  assert.equal((await a.client.listTools()).tools.length, 13);
  assert.equal((await a.client.listResources()).resources.length, 3);
  const symbol = (await call(a.client, 'graphit_find_symbol', { query: 'greet' })).candidates[0];
  assert.ok((await call(a.client, 'graphit_get_source', { symbol_id: symbol.symbol_version_id })).content.includes('Hello'));
  const source = await call(a.client, 'graphit_record_event', { event_type: 'conversation.user_message', payload: { content: 'Continue verifying fresh installation safely.' } });
  const required = [];
  for (const [entity_type, content] of [['goal', 'Verify fresh installation'], ['decision', 'Preserve SQLite evidence'], ['task', 'Verify portability']]) {
    required.push((await call(a.client, 'graphit_add_memory', { entity_type, content, source_event_ids: [source.id] })).id);
  }
  const test = await call(a.client, 'graphit_record_event', { event_type: 'test.result', payload: { status: 'passed', summary: 'Fresh CLI verified' } });
  required.push((await call(a.client, 'graphit_add_memory', { entity_type: 'result', content: 'Fresh CLI verified', source_event_ids: [test.id] })).id);
  await call(a.client, 'graphit_checkpoint');
  const before = await call(a.client, 'graphit_handoff');
  const pidA = a.transport.pid;
  await a.client.close(); clients.delete(a.client); assert.throws(() => process.kill(pidA, 0));
  const snapshot = join(sandbox, 'portable.graphit'); run(project, 'export', snapshot);
  run(imported, 'import', snapshot);
  const afterImport = JSON.parse(run(imported, 'handoff')); assert.deepEqual(afterImport, before);
  assert.deepEqual(JSON.parse(run(imported, 'code', 'stats', '--json')), stats);
  assert.equal(JSON.parse(run(imported, 'doctor', '--json')).retrieval_projection_valid, true);
  const b = await connect(imported, 'openai', 'codex');
  const handoff = await call(b.client, 'graphit_handoff');
  assert.deepEqual(handoff.goals, before.goals); assert.deepEqual(handoff.active_tasks, before.active_tasks);
  assert.equal(handoff.current_session.provider, 'openai');
  const packet = await call(b.client, 'graphit_context', { query: 'continue the current work', token_budget: 2000 });
  assert.equal(packet.budget.budget_insufficient, false); assert.ok(packet.budget.estimated_tokens <= 2000);
  assert.ok(required.every((id) => packet.evidence.some((unit) => unit.id === `memory:${id}`)));
  assert.ok(packet.provenance.includes(source.id) && packet.provenance.includes(test.id));
  await call(b.client, 'graphit_record_event', { event_type: 'conversation.assistant_message', payload: { content: 'Continue using the previous provider evidence.' } });
  console.log(JSON.stringify({ packed_install: 'passed', version: version.trim(), cli_commands: 'passed',
    isolated_prefix: true, runtime_workspace_dependency: false, tree_sitter: 'passed', migrations: 'passed',
    export_import: 'passed', doctor: 'passed', mcp_stdio: 'passed', tools: 13, resources: 3,
    provider_a_exited: true, provider_b_continued: true, handoff_bytes: Buffer.byteLength(JSON.stringify(handoff)),
    context_bytes: Buffer.byteLength(JSON.stringify(packet)), estimated_tokens: packet.budget.estimated_tokens,
    requested_tokens: 2000, required_evidence_retained: '4/4' }, null, 2));
} finally {
  for (const client of clients) await client.close();
  // Only this generated temporary tree; never the installation or project supplied by a user.
  if (resolve(sandbox).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) rmSync(sandbox, { recursive: true, force: true });
}
