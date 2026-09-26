// Local, non-gating measurement; no persistent project data is used.
import console from 'node:console';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, createEvent, sha256 } from '@graphit/core';
import { EventStore, SqliteDatabase } from '@graphit/storage';
import '@graphit/memory';
import '@graphit/codegraph';
const root = mkdtempSync(join(tmpdir(), 'graphit-open-measure-'));
try {
  const path = join(root, 'graphit.db');
  const store = new EventStore(path);
  const state = store.initializeProject(root, 'Startup measurement');
  store.close();
  const db = new SqliteDatabase(path);
  try {
    db.exec('BEGIN IMMEDIATE');
    const insert = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (let sequence = 3; sequence <= 10002; sequence++) {
      const event = createEvent({ project_id: state.project.id, session_id: state.active_session_id,
        sequence, event_type: 'conversation.user_message', created_at: '2026-01-01T00:00:00.000Z',
        payload: { content: 'Startup evidence '.repeat(12) } });
      insert.run(event.id, event.project_id, event.session_id, event.sequence, event.event_type, canonicalJson(event.payload), event.created_at, event.content_hash);
    }
    for (let i = 0; i < 16; i++) {
      const bytes = new Uint8Array(65536).fill(i);
      db.prepare('INSERT INTO source_blobs VALUES (?, ?, ?, ?)').run(sha256(bytes), bytes.length, bytes, '2026-01-01T00:00:00.000Z');
    }
    db.exec('COMMIT');
  } finally { db.close(); }
  const measure = create => Array.from({ length: 7 }, () => { const start = performance.now(); create().close(); return performance.now() - start; }).sort((a,b) => a-b)[3];
  console.log(JSON.stringify({ platform: process.platform, node: process.version, events: 10002, source_blobs: 16,
    database_bytes: statSync(path).size, raw_connection_median_ms: measure(() => new SqliteDatabase(path)),
    integrity_and_migration_open_median_ms: measure(() => new EventStore(path)),
    samples: 7, includes_replay: false }, null, 2));
} finally { rmSync(root, { recursive: true, force: true }); }
