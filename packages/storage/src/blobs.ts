import type { DatabaseSync } from 'node:sqlite';
import { hashSchema, sha256, timestampSchema } from '@graphit/core';

export interface SourceBlob { content_hash: string; byte_length: number; content: Uint8Array; created_at: string }
export function readSourceBlob(database: DatabaseSync, hash: string): SourceBlob {
  hashSchema.parse(hash);
  const row = database.prepare('SELECT * FROM source_blobs WHERE content_hash = ?').get(hash);
  if (!row) throw new Error(`Source blob does not exist: ${hash}`);
  if (!(row.content instanceof Uint8Array) || row.byte_length !== row.content.byteLength || sha256(row.content) !== hash) {
    throw new Error(`Source blob integrity check failed: ${hash}`);
  }
  return { content_hash: hash, byte_length: row.content.byteLength, content: Uint8Array.from(row.content), created_at: timestampSchema.parse(row.created_at) };
}
export function insertSourceBlob(database: DatabaseSync, bytes: Uint8Array, createdAt: string): SourceBlob {
  timestampSchema.parse(createdAt);
  const hash = sha256(bytes);
  if (database.prepare('SELECT 1 FROM source_blobs WHERE content_hash = ?').get(hash)) return readSourceBlob(database, hash);
  database.prepare('INSERT INTO source_blobs (content_hash, byte_length, content, created_at) VALUES (?, ?, ?, ?)')
    .run(hash, bytes.byteLength, bytes, createdAt);
  return readSourceBlob(database, hash);
}
