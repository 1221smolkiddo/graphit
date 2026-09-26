// A real SDK client / two child-server-process handoff. No providers or API keys are contacted.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { canonicalJson } from '@graphit/core';
import { EventStore } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';

const root = mkdtempSync(join(tmpdir(), 'graphit-p4-smoke-'));
const path = join(root, '.graphit', 'graphit.db');
const cli = fileURLToPath(new URL('../packages/cli/dist/index.js', import.meta.url));
const clients = new Set();
async function connect(provider, agent) {
  const client = new Client({ name: agent, version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [cli, 'mcp', '--project', root, '--provider', provider, '--agent', agent], stderr: 'pipe' });
  clients.add(client);
  await client.connect(transport);
  return { client, transport };
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content.find((item) => item.type === 'text').text);
}
function events(id) {
  const store = new EventStore(path);
  try { return store.readEvents(id); } finally { store.close(); }
}
try {
  mkdirSync(join(root, '.graphit'));
  const store = new EventStore(path);
  new MemoryService(store);
  let id;
  try { id = store.initializeProject(root, 'P4 handoff smoke').project.id; } finally { store.close(); }
  const a = await connect('anthropic', 'claude-code');
  assert.equal((await a.client.listTools()).tools.length, 13);
  const source = await call(a.client, 'graphit_record_event', { event_type: 'conversation.user_message', payload: { content: 'Finish durable MCP continuation; keep SQLite; test restart.' } });
  const required = [];
  for (const [entity_type, content] of [['goal', 'Finish durable MCP continuation'], ['decision', 'Keep SQLite canonical'], ['task', 'Verify server restart']]) {
    required.push((await call(a.client, 'graphit_add_memory', { entity_type, content, source_event_ids: [source.id] })).id);
  }
  const result = await call(a.client, 'graphit_record_event', { event_type: 'test.result', payload: { status: 'passed', summary: 'Restart test passed' } });
  required.push((await call(a.client, 'graphit_add_memory', { entity_type: 'result', content: 'Restart test passed', source_event_ids: [result.id] })).id);
  await call(a.client, 'graphit_checkpoint', { name: 'handoff' });
  const snapshot = events(id);
  const pid = a.transport.pid;
  await a.client.close(); clients.delete(a.client);
  assert.throws(() => process.kill(pid, 0));
  const b = await connect('openai', 'codex');
  const handoff = await call(b.client, 'graphit_handoff');
  const context = await call(b.client, 'graphit_context', { query: 'continue the current work', token_budget: 2000 });
  assert.equal(handoff.current_session.provider, 'openai');
  assert.equal(context.budget.budget_insufficient, false);
  assert.ok(context.budget.estimated_tokens <= 2000);
  assert.ok(required.every((id) => context.evidence.some((unit) => unit.id === `memory:${id}`)));
  assert.ok(context.provenance.includes(source.id) && context.provenance.includes(result.id));
  const continued = await call(b.client, 'graphit_record_event', { event_type: 'conversation.assistant_message', payload: { content: 'Continuing the existing task using the handoff evidence.' } });
  await call(b.client, 'graphit_add_memory', { entity_type: 'action', content: 'Continue restart verification', source_event_ids: [source.id, continued.id] });
  assert.deepEqual(events(id).slice(0, snapshot.length), snapshot);
  console.log(JSON.stringify({ protocol: 'MCP stdio', sdk: '2.1.0', tools: 13, provider_a_exited: true, provider_b_continued: true,
    immutable_prefix_events: snapshot.length, handoff_bytes: Buffer.byteLength(canonicalJson(handoff)),
    context_bytes: Buffer.byteLength(canonicalJson(context)), estimated_tokens: context.budget.estimated_tokens,
    requested_tokens: 2000, required_evidence_preserved: `${required.length}/${required.length}`, passed: true }, null, 2));
} finally {
  for (const client of clients) await client.close();
  rmSync(root, { recursive: true, force: true });
}
