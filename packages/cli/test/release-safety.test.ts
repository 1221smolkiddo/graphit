import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, contentHash, createEvent } from '@graphit/core';
import { EventStore, readExportFile } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry } from '@graphit/indexer';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const directories: string[] = [];
function temp(): string { const dir = mkdtempSync(join(tmpdir(), 'graphit-p5-safety-')); directories.push(dir); return dir; }
function run(cwd: string, ...args: string[]) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 30000 }); }
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
interface RecordLine { type: string; data: Record<string, unknown> }
function modify(file: string, change: (records: RecordLine[]) => void, resign = true): void {
  const lines = gunzipSync(readFileSync(file)).toString('utf8').trim().split('\n');
  const magic = lines.shift()!;
  const records = lines.map((line) => JSON.parse(line) as RecordLine);
  change(records);
  if (resign) {
    const header = { ...records[0]!.data }; delete header.content_hash;
    records[0]!.data.content_hash = contentHash({ manifest: header, records: records.slice(1) });
  }
  writeFileSync(file, gzipSync(magic + '\n' + records.map(canonicalJson).join('\n') + '\n'));
}
async function archive() {
  const root = temp();
  writeFileSync(join(root, 'sample.ts'), 'export function value(){ return 42; }');
  expect(run(root, 'init', '--name', 'Integrity fixture').status).toBe(0);
  expect(run(root, 'index', '.').status).toBe(0);
  const store = new EventStore(join(root, '.graphit', 'graphit.db'));
  const memory = new MemoryService(store); new CodeGraphService(store);
  const id = store.findProject(root)!.project!.id;
  const event = store.withProjectTransaction(id, (tx) => tx.append({ event_type: 'conversation.user_message', payload: { content: 'Keep evidence intact' } }));
  memory.promoteMemory(id, { entityType: 'goal', content: 'Keep evidence intact', sourceEventIds: [event.id] });
  store.close();
  const file = join(root, 'snapshot.graphit');
  expect(run(root, 'export', file).status).toBe(0);
  return { root, id, file };
}

describe('P5 fail-closed archives and read-only doctor', () => {
  it.each(['manifest_hash', 'manifest_metadata', 'version', 'migration', 'event_hash', 'event_payload', 'blob_hash', 'blob_bytes',
    'missing_blob', 'duplicate_manifest', 'unknown_record', 'memory_provenance'])('rejects %s damage without leaving an installed database', async (kind) => {
    const f = await archive();
    modify(f.file, (records) => {
      const manifest = records[0]!.data;
      const event = records.find((record) => record.type === 'event')!.data;
      const blob = records.find((record) => record.type === 'blob')!.data;
      switch (kind) {
        case 'manifest_hash': manifest.content_hash = '0'.repeat(64); break;
        case 'manifest_metadata': manifest.project_name = 'forged'; break;
        case 'version': manifest.export_version = 99; break;
        case 'migration': records.find((record) => record.type === 'migration')!.data.checksum = '0'.repeat(64); break;
        case 'event_hash': event.content_hash = '0'.repeat(64); break;
        case 'event_payload': event.payload = '{"invalid":true}'; break;
        case 'blob_hash': blob.content_hash = '0'.repeat(64); break;
        case 'blob_bytes': blob.content_base64 = Buffer.from('corrupt').toString('base64'); break;
        case 'missing_blob': records.splice(records.findIndex((record) => record.type === 'blob'), 1); manifest.source_blob_count = 0; break;
        case 'duplicate_manifest': records.push(records[0]!); break;
        case 'unknown_record': records.push({ type: 'derived_index', data: {} }); break;
        case 'memory_provenance': {
          const row = records.find((record) => record.type === 'event' && record.data.event_type === 'memory.entity.created')!;
          const unsigned = { ...row.data }; delete unsigned.id; delete unsigned.content_hash;
          const payload = JSON.parse(String(unsigned.payload)) as Record<string, unknown>;
          payload.source_event_ids = ['f'.repeat(64)];
          const forged = createEvent({ ...unsigned, payload });
          row.data = { ...forged, payload: canonicalJson(forged.payload) };
          break;
        }
      }
    }, kind !== 'manifest_hash');
    const destination = temp();
    const result = run(destination, 'import', f.file);
    expect(result.status, result.stdout).not.toBe(0);
    expect(existsSync(join(destination, '.graphit'))).toBe(false);
    expect(readdirSync(destination)).toEqual([]);
  }, 30000);

  it('rolls back canonical inserts if downstream rebuilding fails', async () => {
    const f = await archive();
    const store = new EventStore(join(temp(), 'empty.db'));
    new MemoryService(store); new CodeGraphService(store, await createParserRegistry());
    try {
      const data = await readExportFile(f.file);
      expect(() => store.importArchive(data, () => { throw new Error('injected FTS failure'); })).toThrow('injected FTS failure');
      expect(store.listProjects()).toEqual([]);
      expect(store.readEvents(f.id)).toEqual([]);
      // Retry succeeds; no leftover immutable IDs/blobs from the failed transaction.
      expect(store.importArchive(data, () => undefined).events_imported).toBeGreaterThan(0);
    } finally { store.close(); }
  });

  it('refuses to overwrite export files or an existing destination', async () => {
    const f = await archive(); const before = readFileSync(f.file);
    expect(run(f.root, 'export', f.file).status).not.toBe(0);
    expect(readFileSync(f.file)).toEqual(before);
    expect(run(f.root, 'import', f.file).status).not.toBe(0);
    const db = join(f.root, '.graphit', 'graphit.db'); const bytes = readFileSync(db);
    expect(run(f.root, 'export', db).status).not.toBe(0);
    expect(readFileSync(db)).toEqual(bytes);
  });

  it('excludes another project’s source blobs from an export', async () => {
    const f = await archive();
    const store = new EventStore(join(f.root, '.graphit', 'graphit.db'));
    const foreign = store.initializeProject(join(f.root, 'foreign'), 'foreign').project!.id;
    store.withProjectTransaction(foreign, (tx) => tx.putSourceBlob(Buffer.from('PRIVATE FOREIGN BYTES')));
    const output = join(f.root, 'scoped.graphit');
    try { await store.exportArchive(f.id, output, '0.1.0'); } finally { store.close(); }
    expect(await readExportFile(output)).not.toContain(Buffer.from('PRIVATE FOREIGN BYTES').toString('base64'));
  });

  it('doctor handles an uninitialized directory without creating files', () => {
    const root = temp(); const result = run(root, 'doctor', '--json');
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ graphit_version: '0.1.0', project_initialized: false, database_reachable: false, mcp_available: true });
    expect(readdirSync(root)).toEqual([]);
    expect(run(root, '--version').stdout.trim()).toBe('graphit 0.1.0');
  });

  it('doctor checks canonical blobs and all projections without writes, then detects corruption without repair', async () => {
    const f = await archive();
    expect(run(f.root, 'retrieve', 'value').status).toBe(0);
    const path = join(f.root, '.graphit', 'graphit.db');
    const before = readFileSync(path);
    const healthy = run(f.root, 'doctor', '--json');
    expect(healthy.status, healthy.stdout + healthy.stderr).toBe(0);
    expect(JSON.parse(healthy.stdout)).toMatchObject({ schema_valid: true, memory_projection_valid: true, code_projection_valid: true,
      source_blob_integrity: 'ok', retrieval_projection_valid: true, last_index_status: 'completed' });
    expect(readFileSync(path)).toEqual(before);
    const db = new DatabaseSync(path); db.exec('DELETE FROM memory_entities; DELETE FROM retrieval_code_fts'); db.close();
    const damaged = readFileSync(path);
    const result = run(f.root, 'doctor', '--json');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ memory_projection_valid: false, retrieval_projection_valid: false });
    expect(readFileSync(path)).toEqual(damaged);
    const corrupt = new DatabaseSync(path); corrupt.exec('DROP TRIGGER source_blobs_no_update; UPDATE source_blobs SET content = zeroblob(byte_length)'); corrupt.close();
    expect(JSON.parse(run(f.root, 'doctor', '--json').stdout).errors.join(' ')).toContain('Source blob integrity');
  });

  it('doctor reports a mismatched migration ledger without applying migrations', async () => {
    const f = await archive(); const path = join(f.root, '.graphit', 'graphit.db');
    const db = new DatabaseSync(path); db.exec("UPDATE schema_migrations SET checksum = 'bad' WHERE version = 4"); db.close();
    const before = readFileSync(path);
    const result = run(f.root, 'doctor', '--json');
    expect(result.status).toBe(1); expect(JSON.parse(result.stdout).schema_valid).toBe(false);
    expect(readFileSync(path)).toEqual(before);
  });
});
