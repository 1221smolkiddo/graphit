import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { canonicalJson, contentHash, sha256, hashSchema, timestampSchema, reconstructState, verifyEvent, type GraphEvent } from '@graphit/core';
import { migrations } from './migrations.js';
import { readSourceBlob } from './blobs.js';

const MAGIC = 'GRAPHIT_EXPORT';
const MAX_EXPORT_BYTES = 256 * 1024 * 1024;
const manifestSchema = z.object({ export_version: z.literal(1), graphit_version: z.string().min(1), exported_at: timestampSchema,
  project_id: z.string().uuid(), project_name: z.string().min(1), event_count: z.number().int().positive(),
  source_blob_count: z.number().int().nonnegative(), migration_versions: z.array(z.number().int().positive()), content_hash: hashSchema }).strict();
const migrationSchema = z.object({ version: z.number().int().positive(), name: z.string(), checksum: hashSchema }).strict();
const blobSchema = z.object({ content_hash: hashSchema, byte_length: z.number().int().nonnegative(),
  created_at: timestampSchema, content_base64: z.string() }).strict();
const eventSchema = z.object({ id: hashSchema, project_id: z.string().uuid(), session_id: z.string().uuid(), sequence: z.number().int().positive(),
  event_type: z.string(), payload: z.string(), created_at: timestampSchema, content_hash: hashSchema }).strict();
const recordSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manifest'), data: manifestSchema }).strict(),
  z.object({ type: z.literal('migration'), data: migrationSchema }).strict(),
  z.object({ type: z.literal('event'), data: eventSchema }).strict(),
  z.object({ type: z.literal('blob'), data: blobSchema }).strict(),
]);
export type ExportManifest = z.infer<typeof manifestSchema>;
export interface ImportResult { manifest: ExportManifest; events_imported: number; blobs_imported: number; project_id: string }
type ArchiveRecord = z.infer<typeof recordSchema>;

function digest(manifest: Omit<ExportManifest, 'content_hash'>, records: ArchiveRecord[]): string {
  return contentHash({ manifest, records });
}
function decodeEvents(rows: z.infer<typeof eventSchema>[]): GraphEvent[] {
  return rows.map((row) => {
    const event = verifyEvent({ ...row, payload: JSON.parse(row.payload) as unknown });
    if (row.payload !== canonicalJson(event.payload)) throw new Error('Non-canonical event payload');
    return event;
  });
}
function referencedHashes(events: GraphEvent[]): Set<string> {
  return new Set(events.flatMap((event) => event.event_type === 'code.file.observed' ? [String(event.payload.content_hash)] : []));
}

/** Strict bounded format validation, including the complete manifest, event envelopes and all blob bytes. */
export function validateExport(data: string) {
  if (Buffer.byteLength(data) > MAX_EXPORT_BYTES) throw new Error('Export exceeds 256 MiB uncompressed limit');
  const lines = data.trimEnd().split('\n');
  if (lines.shift() !== MAGIC) throw new Error('Invalid Graphit export magic');
  const records = lines.map((line) => recordSchema.parse(JSON.parse(line) as unknown));
  const first = records.shift();
  if (first?.type !== 'manifest' || records.some((record) => record.type === 'manifest')) throw new Error('Expected exactly one leading manifest');
  const { content_hash, ...header } = first.data;
  if (digest(header, records) !== content_hash) throw new Error('Export integrity check failed: content hash mismatch');
  const exportedMigrations = records.filter((record) => record.type === 'migration').map((record) => record.data);
  if (!exportedMigrations.length || exportedMigrations.length > migrations.length ||
    canonicalJson(header.migration_versions) !== canonicalJson(exportedMigrations.map((item) => item.version))) throw new Error('Invalid migration manifest');
  for (const [index, item] of exportedMigrations.entries()) {
    const expected = migrations[index]!;
    if (item.version !== expected.version || item.name !== expected.name || item.checksum !== sha256(expected.sql)) throw new Error('Unsupported migration/checksum');
  }
  const rows = records.filter((record) => record.type === 'event').map((record) => record.data);
  const blobs = records.filter((record) => record.type === 'blob').map((record) => record.data);
  if (rows.length !== header.event_count || blobs.length !== header.source_blob_count) throw new Error('Export record count mismatch');
  const events = decodeEvents(rows);
  const state = reconstructState(events);
  if (!state.project || state.project.id !== header.project_id || state.project.name !== header.project_name) throw new Error('Export project metadata mismatch');
  const required = referencedHashes(events);
  const found = new Set<string>();
  for (const blob of blobs) {
    const bytes = Buffer.from(blob.content_base64, 'base64');
    if (bytes.toString('base64') !== blob.content_base64 || bytes.length !== blob.byte_length || sha256(bytes) !== blob.content_hash) throw new Error('Source blob integrity check failed');
    if (found.has(blob.content_hash) || !required.has(blob.content_hash)) throw new Error('Duplicate or unrelated source blob');
    found.add(blob.content_hash);
  }
  if (required.size !== found.size) throw new Error('Missing preserved source evidence');
  const sizes = new Map(blobs.map((blob) => [blob.content_hash, blob.byte_length]));
  for (const event of events) if (event.event_type === 'code.file.observed' && sizes.get(String(event.payload.content_hash)) !== event.payload.byte_length) throw new Error('Observation byte length does not match preserved source');
  return { manifest: first.data, rows, blobs, events };
}

/** Consistent project-only snapshot. Sessions/project/checkpoints are already canonical events.
 * Never exports unrelated projects' blobs or any derived index. Refuses to overwrite existing files. */
export async function exportProject(database: DatabaseSync, projectId: string, outputPath: string, graphitVersion: string): Promise<ExportManifest> {
  database.exec('SAVEPOINT graphit_export');
  let body: string;
  let manifest: ExportManifest;
  try {
    const rows = database.prepare('SELECT * FROM events WHERE project_id = ? ORDER BY sequence').all(projectId).map((row) => eventSchema.parse(row));
    const events = decodeEvents(rows);
    const state = reconstructState(events);
    if (!state.project) throw new Error('Project does not exist');
    const records: ArchiveRecord[] = database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all()
      .map((row) => ({ type: 'migration', data: migrationSchema.parse(row) }));
    records.push(...rows.map((data): ArchiveRecord => ({ type: 'event', data })));
    const hashes = [...referencedHashes(events)].sort();
    for (const hash of hashes) {
      const blob = readSourceBlob(database, hash);
      const created_at = database.prepare('SELECT created_at FROM source_blobs WHERE content_hash = ?').get(hash)!.created_at;
      records.push({ type: 'blob', data: blobSchema.parse({ content_hash: hash, byte_length: blob.byte_length,
        created_at, content_base64: Buffer.from(blob.content).toString('base64') }) });
    }
    const header = { export_version: 1 as const, graphit_version: graphitVersion, exported_at: new Date().toISOString(),
      project_id: projectId, project_name: state.project.name, event_count: rows.length, source_blob_count: hashes.length,
      migration_versions: records.filter((record) => record.type === 'migration').map((record) => record.data.version) };
    manifest = { ...header, content_hash: digest(header, records) };
    body = MAGIC + '\n' + [{ type: 'manifest', data: manifest }, ...records].map(canonicalJson).join('\n') + '\n';
    validateExport(body);
  } finally { database.exec('RELEASE graphit_export'); }
  await pipeline(Readable.from([body]), createGzip({ level: 9 }), createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }));
  return manifest;
}

/** All canonical inserts share a savepoint. Extension replay and projection rebuild are required
 * in the caller's surrounding transaction before it commits (EventStore.importArchive does this). */
export function importProject(database: DatabaseSync, data: string): ImportResult {
  const archive = validateExport(data);
  database.exec('SAVEPOINT graphit_import');
  try {
    if (database.prepare('SELECT 1 FROM events LIMIT 1').get() || database.prepare('SELECT 1 FROM source_blobs LIMIT 1').get()) throw new Error('Import requires an empty database');
    for (const blob of archive.blobs) database.prepare('INSERT INTO source_blobs (content_hash, byte_length, content, created_at) VALUES (?, ?, ?, ?)')
      .run(blob.content_hash, blob.byte_length, Buffer.from(blob.content_base64, 'base64'), blob.created_at);
    for (const event of archive.rows) database.prepare('INSERT INTO events (id, project_id, session_id, sequence, event_type, payload, created_at, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(event.id, event.project_id, event.session_id, event.sequence, event.event_type, event.payload, event.created_at, event.content_hash);
    database.exec('RELEASE graphit_import');
    return { manifest: archive.manifest, project_id: archive.manifest.project_id, events_imported: archive.rows.length, blobs_imported: archive.blobs.length };
  } catch (error) { database.exec('ROLLBACK TO graphit_import; RELEASE graphit_import'); throw error; }
}

export async function readExportFile(filePath: string): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  await pipeline(createReadStream(filePath), createGunzip(), new Writable({ write(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    if (size > MAX_EXPORT_BYTES) { callback(new Error('Export exceeds 256 MiB uncompressed limit')); return; }
    chunks.push(chunk); callback();
  } }));
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
