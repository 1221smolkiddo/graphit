import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '@graphit/storage';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { EventStore } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry } from '@graphit/indexer';
import { RetrievalService } from '@graphit/retrieval';
import { ContextCompiler } from '@graphit/context';

const cli = fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url));
const directories: string[] = [];
const stores = new Set<EventStore>();

function run(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 30000 });
}

afterEach(() => {
  for (const store of stores) store.close(); stores.clear();
  for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('portable export and import', () => {
  it('roundtrips a project with memory, code index and retrieval — preserving events, blobs and evidence', async () => {
    // ===== Machine A: create project, index, memory, retrieval =====
    const rootA = mkdtempSync(join(tmpdir(), 'graphit-p5-export-')); directories.push(rootA);
    cpSync(fileURLToPath(new URL('../../../fixtures/repos/auth-retrieval', import.meta.url)), rootA, { recursive: true });

    const initA = run(rootA, 'init', '--name', 'Export Test', '--json');
    expect(initA.status, initA.stderr).toBe(0);
    const stateA = JSON.parse(initA.stdout);
    const projectIdA = stateA.project.id;

    const indexA = run(rootA, 'index', '.', '--json');
    expect(indexA.status, indexA.stderr).toBe(0);

    // Record events and promote memory
    const storeA = new EventStore(join(rootA, '.graphit', 'graphit.db')); stores.add(storeA);
    const memA = new MemoryService(storeA);
    const graphA = new CodeGraphService(storeA, await createParserRegistry());
    const historicalSymbol = graphA.findSymbolsByName(projectIdA, 'refreshSession')[0]!;
    const historicalSource = graphA.getSource(projectIdA, historicalSymbol.symbol_version_id);
    const sourcePath = join(rootA, historicalSymbol.path);
    writeFileSync(sourcePath, readFileSync(sourcePath, 'utf8').replace('refreshSession', 'refreshSessionV2'));
    expect(run(rootA, 'index', '.').status).toBe(0);
    const event = storeA.withProjectTransaction(projectIdA, (tx) =>
      tx.append({ event_type: 'conversation.user_message', payload: { content: 'Export test conversation' } }));
    const goal = memA.promoteMemory(projectIdA, { entityType: 'goal', content: 'Test export/import roundtrip', sourceEventIds: [event.id] });
    const decision = memA.promoteMemory(projectIdA, { entityType: 'decision', content: 'Keep SQLite as canonical store', sourceEventIds: [event.id] });
    const task = memA.promoteMemory(projectIdA, { entityType: 'task', content: 'Verify portability of refreshSession', sourceEventIds: [event.id] });
    const old = memA.promoteMemory(projectIdA, { entityType: 'decision', content: 'Discarded prior decision', sourceEventIds: [event.id] });
    memA.supersedeMemory(projectIdA, old.id, { replacementId: decision.id, sourceEventIds: [event.id] });

    // Verify retrieval works on A
    const retrievalA = new RetrievalService(storeA, memA, graphA);
    const resultA = retrievalA.retrieve({ text: 'refreshSession', projectId: projectIdA });
    expect(resultA.candidates.length).toBeGreaterThan(0);

    // Compile context on A
    const contextA = new ContextCompiler(retrievalA).compile({ text: 'continue the work', projectId: projectIdA, tokenBudget: 4000, mode: 'continue' });
    expect(contextA.budget.budget_insufficient).toBe(false);
    expect(contextA.evidence.length).toBeGreaterThan(0);

    // Get handoff on A
    const handoffA = memA.generateHandoff(projectIdA);
    expect(handoffA.goals.length).toBeGreaterThan(0);

    // Read A events and code stats for later comparison
    const eventsA = storeA.readEvents(projectIdA);
    const statsA = graphA.stats(projectIdA);
    const symbolsA = graphA.findSymbolsByName(projectIdA, 'refreshSessionV2');
    expect(symbolsA.length).toBeGreaterThan(0);
    const sourceA = graphA.getSource(projectIdA, symbolsA[0]!.logical_symbol_id);
    const memoryA = memA.getMemoryState(projectIdA);
    const graphSnapshot = graphA.getGraph(projectIdA);
    const dbA = new SqliteDatabase(join(rootA, '.graphit', 'graphit.db'));
    const blobsA = dbA.prepare('SELECT content_hash, content FROM source_blobs ORDER BY content_hash').all();
    // Export must not trust these deliberately damaged derived tables.
    dbA.exec('DELETE FROM memory_entities; DELETE FROM code_symbols; DELETE FROM retrieval_code_fts;'); dbA.close();

    storeA.close(); stores.delete(storeA);

    // ===== Export =====
    const exportPath = join(rootA, 'export.graphit');
    const exportResult = run(rootA, 'export', exportPath);
    expect(exportResult.status, exportResult.stderr).toBe(0);

    // ===== Machine B: import into clean directory =====
    const rootB = mkdtempSync(join(tmpdir(), 'graphit-p5-import-')); directories.push(rootB);
    // No working-tree files: rebuild must use preserved evidence, not Machine A's filesystem.

    const importResult = spawnSync(process.execPath, [cli, 'import', exportPath], {
      encoding: 'utf8', timeout: 30000, cwd: rootB,
    });
    expect(importResult.status, importResult.stderr).toBe(0);

    // ===== Verify imported state =====
    const storeB = new EventStore(join(rootB, '.graphit', 'graphit.db')); stores.add(storeB);
    const memB = new MemoryService(storeB);
    const graphB = new CodeGraphService(storeB, await createParserRegistry());

    // Event IDs preserved
    const eventsB = storeB.readEvents(projectIdA);
    expect(eventsB.map((e) => e.id)).toEqual(eventsA.map((e) => e.id));
    expect(eventsB.length).toBe(eventsA.length);
    expect(eventsB).toEqual(eventsA);
    expect(memB.getMemoryState(projectIdA)).toEqual(memoryA);
    expect(graphB.getGraph(projectIdA)).toEqual(graphSnapshot);
    const dbB = new SqliteDatabase(join(rootB, '.graphit', 'graphit.db'), { readonly: true });
    expect(dbB.prepare('SELECT content_hash, content FROM source_blobs ORDER BY content_hash').all()).toEqual(blobsA); dbB.close();

    // Memory state identical
    const handoffB = memB.generateHandoff(projectIdA);
    expect(handoffB.goals.length).toBe(handoffA.goals.length);
    expect(handoffB.decisions.length).toBe(handoffA.decisions.length);
    expect(handoffB.goals.map((g) => g.id)).toEqual(handoffA.goals.map((g) => g.id));
    expect(handoffB.active_tasks.map((item) => item.id)).toContain(task.id);
    expect(handoffB.decisions.map((item) => item.id)).toContain(decision.id);
    expect(handoffB).toEqual(handoffA);

    // Historical source preserved
    const symbolsB = graphB.findSymbolsByName(projectIdA, 'refreshSessionV2');
    expect(symbolsB.length).toBe(symbolsA.length);
    const sourceB = graphB.getSource(projectIdA, symbolsB[0]!.logical_symbol_id);
    expect(sourceB.content).toBe(sourceA.content);
    expect(sourceB.content_hash).toBe(sourceA.content_hash);
    expect(graphB.getSource(projectIdA, historicalSymbol.symbol_version_id)).toEqual(historicalSource);

    // Code graph semantically identical
    const statsB = graphB.stats(projectIdA);
    expect(statsB.files).toBe(statsA.files);
    expect(statsB.symbols).toBe(statsA.symbols);
    expect(statsB.edges).toBe(statsA.edges);

    // BM25 retrieval works
    const retrievalB = new RetrievalService(storeB, memB, graphB);
    const resultB = retrievalB.retrieve({ text: 'refreshSession', projectId: projectIdA });
    expect(resultB.candidates.length).toBeGreaterThan(0);
    expect(resultB.diagnostics.channels.some((channel) => channel.channel.includes('bm25') && channel.entries.length > 0)).toBe(true);

    // PPR retrieval works
    const resultPPR = retrievalB.retrieve({ text: 'authentication', projectId: projectIdA, mode: 'impact', seedSymbolIds: [symbolsB[0]!.logical_symbol_id] });
    expect(resultPPR.candidates.length).toBeGreaterThan(0);
    expect(resultPPR.diagnostics.ppr_iterations).toBeGreaterThan(0);
    expect(resultPPR.candidates.some((candidate) => candidate.ppr_score > 0)).toBe(true);

    // Context compilation returns required evidence
    const contextB = new ContextCompiler(retrievalB).compile({ text: 'continue the work', projectId: projectIdA, tokenBudget: 4000, mode: 'continue' });
    expect(contextB.budget.budget_insufficient).toBe(false);
    expect(contextB.evidence.length).toBeGreaterThan(0);
    // Memory evidence preserved
    expect(contextB.evidence.some((u) => u.id === `memory:${goal.id}`)).toBe(true);
    expect(contextB.evidence.some((u) => u.id === `memory:${task.id}`)).toBe(true);
    expect(contextB.evidence.some((u) => u.id === `memory:${decision.id}`)).toBe(true);
    expect(contextB).toEqual(contextA);

    // MCP doctor works on imported project
    const doctorResult = spawnSync(process.execPath, [cli, 'mcp', 'doctor', '--project', rootB], {
      encoding: 'utf8', timeout: 10000, cwd: rootB,
    });
    expect(doctorResult.status, doctorResult.stderr).toBe(0);
    const doctorData = JSON.parse(doctorResult.stdout);
    expect(doctorData.database_reachable).toBe(true);
    expect(doctorData.project_initialized).toBe(true);
    const client = new Client({ name: 'import-verifier', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', '--project', rootB], stderr: 'pipe' }));
      expect((await client.listTools()).tools).toHaveLength(13);
      expect((await client.callTool({ name: 'graphit_handoff', arguments: {} })).isError).not.toBe(true);
    } finally { await client.close(); }
    expect(run(rootB, 'status').status).toBe(0);
    expect(run(rootB, 'handoff').status).toBe(0);
    // Attach a checkout later and continue indexing without rewriting historical roots/IDs.
    cpSync(fileURLToPath(new URL('../../../fixtures/repos/auth-retrieval', import.meta.url)), rootB, { recursive: true });
    expect(run(rootB, 'index', '.').status).toBe(0);
    expect(storeB.readEvents(projectIdA).slice(0, eventsA.length)).toEqual(eventsA);
  }, 60000);

  it('rejects corrupt export files', async () => {
    const rootA = mkdtempSync(join(tmpdir(), 'graphit-p5-corrupt-')); directories.push(rootA);
    const init = spawnSync(process.execPath, [cli, 'init', '--name', 'Corrupt Test'], {
      encoding: 'utf8', timeout: 10000, cwd: rootA,
    });
    expect(init.status, init.stderr).toBe(0);

    const exportPath = join(rootA, 'test.graphit');
    const exp = spawnSync(process.execPath, [cli, 'export', exportPath], {
      encoding: 'utf8', timeout: 10000, cwd: rootA,
    });
    expect(exp.status, exp.stderr).toBe(0);

    // Corrupt the file
    const { writeFileSync } = await import('node:fs');
    writeFileSync(exportPath, 'not a valid graphit export');

    const rootB = mkdtempSync(join(tmpdir(), 'graphit-p5-corrupt-import-')); directories.push(rootB);
    const imp = spawnSync(process.execPath, [cli, 'import', exportPath], {
      encoding: 'utf8', timeout: 10000, cwd: rootB,
    });
    expect(imp.status).not.toBe(0);
    expect(existsSync(join(rootB, '.graphit'))).toBe(false);
  }, 30000);
});
