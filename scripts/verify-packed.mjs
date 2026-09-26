// Release acceptance: install the actual tarball outside this workspace; all Graphit actions use that installation.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const archive = realpathSync(resolve(process.argv[2] ?? 'graphit-0.1.0.tgz'));
const sandbox = mkdtempSync(join(tmpdir(), 'graphit-packed-'));
const clients = new Set();
const serverLogs = [];
const env = { ...process.env }; delete env.NODE_PATH; delete env.NODE_OPTIONS; delete env.NODE_NO_WARNINGS;
const prefix = join(sandbox, 'prefix');
const project = join(sandbox, 'project');
const imported = join(sandbox, 'imported');
const installedRoot = join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'graphit');
const cli = join(installedRoot, 'dist/cli/index.js');
function checked(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.doesNotMatch(result.stderr + result.stdout, /ExperimentalWarning/i);
  return result.stdout.trim();
}
function run(cwd, ...args) { return checked(process.execPath, [cli, ...args], { cwd, env }); }
async function connect(cwd, provider, agent) {
  const client = new Client({ name: agent, version: '1' }); clients.add(client);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [cli, 'mcp', '--project', cwd, '--provider', provider, '--agent', agent], cwd, stderr: 'pipe',
    env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) });
  const log = { stderr: '' }; serverLogs.push(log);
  transport.stderr.on('data', chunk => { log.stderr += chunk.toString(); });
  await client.connect(transport); return { client, transport };
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args }); assert.notEqual(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content.find((item) => item.type === 'text').text);
}
try {
  assert.ok(process.env.npm_execpath, 'Run with npm run verify:packed -- <tarball>');
  execFileSync(process.execPath, [process.env.npm_execpath, 'install', '--global', '--prefix', prefix, archive,
    '--no-audit', '--no-fund'], { cwd: sandbox, env, stdio: 'pipe' });
  assert.ok(existsSync(cli));
  assert.equal(existsSync(join(installedRoot, 'packages')), false, 'No workspace is shipped');
  assert.equal(existsSync(join(installedRoot, 'node_modules/@graphit')), false, 'No private runtime package resolution');
  const metadata = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
  assert.equal(metadata.version, '0.1.0'); assert.equal(metadata.bin.graphit, 'dist/cli/index.js');
  const binary = process.platform === 'win32' ? join(prefix, 'graphit.cmd') : join(prefix, 'bin/graphit');
  const version = process.platform === 'win32'
    ? checked(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${binary}" --version"`], { cwd: sandbox, env, windowsVerbatimArguments: true })
    : checked(binary, ['--version'], { cwd: sandbox, env });
  assert.equal(version.trim(), 'graphit 0.1.0');
  assert.ok(run(sandbox, '--help').includes('graphit export'));
  assert.ok(run(sandbox, 'doctor').includes('project_initialized: false'));
  // Exercise the installed native loader's source-build-required branch without
  // changing installed binaries or pretending a native compilation succeeded.
  const missingNative = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    const exists = fs.existsSync;
    fs.existsSync = path => String(path).includes('prebuilds') ? false : exists(path);
    process.argv = [process.execPath, 'doctor', '--json'];
    await import(${JSON.stringify(pathToFileURL(cli).href)});
  `], { cwd: sandbox, env, encoding: 'utf8' });
  assert.equal(missingNative.status, 1, missingNative.stderr);
  assert.ok(JSON.parse(missingNative.stdout).errors.join(' ').includes('C++ toolchain and Python'));
  mkdirSync(project); mkdirSync(imported);
  writeFileSync(join(project, 'example.ts'), 'export function greet(name: string) { return `Hello ${name}`; }\nexport function main() { return greet("World"); }\n');
  run(project, 'init', '--name', 'CI Smoke');
  run(project, 'index', '.');
  const stats = JSON.parse(run(project, 'code', 'stats', '--json')); assert.ok(stats.symbols > 0 && stats.edges > 0);
  const context = JSON.parse(run(project, 'context', 'explain this project', '--tokens', '1000', '--json'));
  assert.equal(context.budget.budget_insufficient, false); assert.ok(context.budget.estimated_tokens <= 1000);
  run(project, 'handoff'); run(project, 'mcp', 'doctor');
  assert.equal(JSON.parse(run(project, 'repair', '--json')).canonical_unchanged, true);
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
  // P6C encrypted transport: real installed CLI, no secret in argv.
  const secure = join(sandbox, 'secure.graphit');
  const secureEnv = { ...env, GRAPHIT_PACKED_PASSPHRASE: 'isolated packaged verification secret' };
  const secretRun = (cwd, ...args) => checked(process.execPath, [cli, ...args, '--passphrase-env', 'GRAPHIT_PACKED_PASSPHRASE'], { cwd, env: secureEnv });
  secretRun(project, 'export', secure, '--encrypt');
  const encryptedImport = join(sandbox, 'encrypted-import'); mkdirSync(encryptedImport);
  secretRun(encryptedImport, 'import', secure);
  assert.deepEqual(JSON.parse(run(encryptedImport, 'handoff')), before);
  assert.equal(JSON.parse(run(encryptedImport, 'doctor', '--json')).retrieval_projection_valid, true);
  const secondSecure = join(sandbox, 'secure-second.graphit');
  secretRun(project, 'export', secondSecure, '--encrypt');
  const header = file => JSON.parse(readFileSync(file).toString().split('\n')[1]);
  assert.notEqual(header(secure).salt, header(secondSecure).salt);
  assert.notEqual(header(secure).iv, header(secondSecure).iv);
  for (const mode of ['wrong-password', 'ciphertext', 'tag', 'truncation']) {
    let bytes = readFileSync(secure);
    const end = bytes.indexOf(10, bytes.indexOf(10) + 1);
    if (mode === 'ciphertext') bytes[end + 2] ^= 1;
    if (mode === 'tag') bytes[bytes.length - 1] ^= 1;
    if (mode === 'truncation') bytes = bytes.subarray(0, bytes.length - 20);
    const damaged = join(sandbox, mode + '.graphit'); writeFileSync(damaged, bytes);
    const target = join(sandbox, mode); mkdirSync(target);
    const result = spawnSync(process.execPath, [cli, 'import', damaged, '--passphrase-env', 'GRAPHIT_PACKED_PASSPHRASE'], {
      cwd: target, encoding: 'utf8', env: { ...secureEnv, ...(mode === 'wrong-password' ? { GRAPHIT_PACKED_PASSPHRASE: 'wrong' } : {}) },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /authentication failed/);
    assert.equal(existsSync(join(target, '.graphit')), false);
    assert.doesNotMatch(result.stderr, /ExperimentalWarning/);
  }
  const b = await connect(encryptedImport, 'openai', 'codex');
  const handoff = await call(b.client, 'graphit_handoff');
  assert.deepEqual(handoff.goals, before.goals); assert.deepEqual(handoff.active_tasks, before.active_tasks);
  assert.equal(handoff.current_session.provider, 'openai');
  const packet = await call(b.client, 'graphit_context', { query: 'continue the current work', token_budget: 2000 });
  assert.equal(packet.budget.budget_insufficient, false); assert.ok(packet.budget.estimated_tokens <= 2000);
  assert.ok(required.every((id) => packet.evidence.some((unit) => unit.id === `memory:${id}`)));
  assert.ok(packet.provenance.includes(source.id) && packet.provenance.includes(test.id));
  await call(b.client, 'graphit_record_event', { event_type: 'conversation.assistant_message', payload: { content: 'Continue using the previous provider evidence.' } });
  await b.client.close(); clients.delete(b.client);
  for (const log of serverLogs) assert.doesNotMatch(log.stderr, /ExperimentalWarning/i);
  const doctor = JSON.parse(run(imported, 'doctor', '--json'));
  assert.equal(doctor.journal_mode, 'wal');
  assert.equal(doctor.retrieval_projection_valid, true);
  let stress = null;
  if (process.env.GRAPHIT_P6C_STRESS === '1') {
    stress = JSON.parse(checked(process.execPath, [resolve('scripts/stress-p6c.mjs'), '1000', resolve('benchmarks/p6c-stress-packed.json')],
      { cwd: process.cwd(), env: { ...env, GRAPHIT_PACKAGE_ROOT: installedRoot } }));
    assert.equal(stress.fixture.files, 1000); assert.ok(stress.fixture.symbols >= 20000 && stress.fixture.edges >= 30000);
  }
  const verification = { measured_at: new Date().toISOString(), node: process.version, platform: process.platform,
    archive_sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
    packed_install: 'passed', version: version.trim(), cli_commands: 'passed',
    isolated_prefix: true, runtime_workspace_dependency: false, tree_sitter: 'passed', migrations: 'passed',
    export_import: 'passed', encrypted_roundtrip: 'passed', encrypted_tamper_cases: 4, randomized_envelopes: true,
    doctor: 'passed', mcp_stdio: 'passed', tools: 13, resources: 3,
    experimental_warning: false, journal_mode: doctor.journal_mode, fts5_bm25: 'passed',
    native_prebuild: 'passed', missing_native_guidance: 'passed', derived_repair: 'passed',
    provider_a_exited: true, provider_b_continued: true, handoff_bytes: Buffer.byteLength(JSON.stringify(handoff)),
    context_bytes: Buffer.byteLength(JSON.stringify(packet)), estimated_tokens: packet.budget.estimated_tokens,
    requested_tokens: 2000, required_evidence_retained: '4/4', stress_fixture: stress?.fixture ?? null };
  if (process.env.GRAPHIT_VERIFY_REPORT) writeFileSync(resolve(process.env.GRAPHIT_VERIFY_REPORT), JSON.stringify(verification, null, 2) + '\n');
  console.log(JSON.stringify(verification, null, 2));
} finally {
  for (const client of clients) await client.close();
  // Only this generated temporary tree; never the installation or project supplied by a user.
  if (resolve(sandbox).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) rmSync(sandbox, { recursive: true, force: true });
}
