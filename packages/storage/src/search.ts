import type { DatabaseSync } from 'node:sqlite';
import { contentHash } from '@graphit/core';

export interface SearchDocuments {
  memory: { id: string; content: string; entity_type: string; status: string }[];
  code: { id: string; name: string; qualified_name: string; path: string; signature: string }[];
}
export interface SearchHit { id: string; score: number }
const tables = { memory: 'retrieval_memory_fts', code: 'retrieval_code_fts' } as const;
export function ensureSearchProjection(db: DatabaseSync, projectId: string, documents: SearchDocuments, force = false): boolean {
  const sorted = { memory: [...documents.memory].sort((a,b) => a.id < b.id ? -1 : 1),
    code: [...documents.code].sort((a,b) => a.id < b.id ? -1 : 1) };
  const digest = contentHash(sorted);
  const read = (kind: keyof typeof tables) => db.prepare(`SELECT * FROM ${tables[kind]} WHERE project_id = ? ORDER BY id`).all(projectId)
    .map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'project_id')));
  const stored = { memory: read('memory'), code: read('code') };
  const state = db.prepare('SELECT document_hash FROM retrieval_projection_state WHERE project_id = ?').get(projectId);
  if (!force && state?.document_hash === digest && contentHash(stored) === digest) return false;
  for (const kind of ['memory', 'code'] as const) {
    db.prepare(`DELETE FROM ${tables[kind]} WHERE project_id = ?`).run(projectId);
    for (const row of sorted[kind]) {
      const columns = Object.keys(row);
      db.prepare(`INSERT INTO ${tables[kind]} (project_id,${columns.join(',')}) VALUES (?,${columns.map(() => '?').join(',')})`)
        .run(projectId, ...Object.values(row));
    }
  }
  db.prepare('INSERT INTO retrieval_projection_state VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET document_hash = excluded.document_hash').run(projectId, digest);
  return true;
}
export function searchProjection(db: DatabaseSync, projectId: string, kind: keyof typeof tables, terms: readonly string[], limit: number): SearchHit[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid search limit');
  if (!terms.length) return [];
  // Terms are quoted as literals; neither SQL nor FTS syntax is accepted from the query.
  const expression = terms.map((term) => '"' + term.replaceAll('"', '""') + '"').join(' OR ');
  const table = tables[kind];
  return db.prepare(`SELECT id, bm25(${table}) AS score FROM ${table} WHERE ${table} MATCH ? AND project_id = ? ORDER BY score, id LIMIT ?`)
    .all(expression, projectId, limit).map((row) => ({ id: String(row.id), score: Number(row.score) }));
}
