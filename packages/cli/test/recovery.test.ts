import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { EventStore, SqliteDatabase } from '@graphit/storage';
import { nodeSupported } from '@graphit/core';
import { canonical, ok, project, run, temporary } from './recovery-helpers.js';
import { inspectProject } from '../src/doctor.js';

describe('P6B corruption and derived repair', () => {
  it.each(['invalid', 'truncated', 'empty'])('refuses %s databases without replacing user bytes', async kind => {
    const f = await project();
    const bytes = kind === 'invalid' ? Buffer.from('not a SQLite database') :
      kind === 'empty' ? Buffer.alloc(0) : readFileSync(f.path).subarray(0, 100);
    writeFileSync(f.path, bytes);
    const report = await inspectProject(f.root);
    expect(report.errors.length).toBeGreaterThan(0);
    const result = run(f.root, 'status');
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/preserve|refusing/i);
    expect(readFileSync(f.path)).toEqual(bytes);
  });

  it.each(['missing table', 'missing events', 'missing source blobs', 'bad ledger', 'missing ledger', 'partial ledger', 'future schema', 'integrity'])('fails closed on %s', async kind => {
    const f = await project(); const db = new SqliteDatabase(f.path);
    try {
      if (kind === 'missing table') db.exec('DROP TABLE memory_entities;');
      if (kind === 'missing events') db.exec('DROP TRIGGER events_no_delete; DROP TABLE events;');
      if (kind === 'missing source blobs') db.exec('DROP TRIGGER source_blobs_no_delete; DROP TABLE source_blobs;');
      if (kind === 'bad ledger') db.exec("UPDATE schema_migrations SET checksum = 'bad' WHERE version = 2;");
      if (kind === 'missing ledger') db.exec('DROP TABLE schema_migrations;');
      if (kind === 'partial ledger') db.exec('DELETE FROM schema_migrations WHERE version = 4;');
      if (kind === 'future schema') db.exec("INSERT INTO schema_migrations VALUES (99, 'future', 'unknown', '2026-01-01T00:00:00.000Z');");
      if (kind === 'integrity') {
        db.exec('CREATE TABLE corrupt_seed (n TEXT); CREATE INDEX corrupt_index ON corrupt_seed(n); BEGIN IMMEDIATE;');
        db.applySchemaMigration("PRAGMA writable_schema = ON; UPDATE sqlite_schema SET rootpage = (SELECT rootpage FROM sqlite_schema WHERE name = 'corrupt_index') WHERE name = 'events_session';", () => {
          const version = Number(db.prepare('PRAGMA schema_version').get()!.schema_version);
          db.exec(`PRAGMA schema_version = ${version + 1}; PRAGMA writable_schema = RESET;`);
        });
        db.exec('COMMIT;');
      }
    } finally { db.close(); }
    const before = readFileSync(f.path);
    expect(() => new EventStore(f.path)).toThrow(/integrity|schema|ledger|newer|table/i);
    expect(readFileSync(f.path)).toEqual(before);
    const report = await inspectProject(f.root);
    expect(report.errors.length).toBeGreaterThan(0);
    if (kind === 'integrity') expect(report.integrity_check).toBe('failed');
    expect(readFileSync(f.path)).toEqual(before);
  });

  it('repairs damaged memory, code and FTS rows atomically without rewriting events or blobs', async () => {
    const f = await project(); const before = canonical(f.path);
    const db = new SqliteDatabase(f.path);
    try { db.exec("DELETE FROM memory_entities; UPDATE code_symbols SET data = '{}'; DELETE FROM retrieval_code_fts;"); }
    finally { db.close(); }
    const broken = await inspectProject(f.root);
    expect(broken.memory_projection_valid).toBe(false);
    expect(broken.code_projection_valid).toBe(false);
    expect(broken.retrieval_projection_valid).toBe(false);
    expect(JSON.parse(ok(f.root, 'repair', '--json'))).toEqual({ projects_repaired: 1, canonical_unchanged: true });
    const healed = await inspectProject(f.root);
    expect(healed.errors).toEqual([]);
    expect(healed.memory_projection_valid && healed.code_projection_valid && healed.retrieval_projection_valid).toBe(true);
    expect(canonical(f.path)).toEqual(before);
    ok(f.root, 'repair');
    expect(canonical(f.path)).toEqual(before);
  });

  it('refuses repair for corrupt canonical blobs and does not erase stale evidence', async () => {
    const f = await project(); const db = new SqliteDatabase(f.path);
    try { db.exec('DROP TRIGGER source_blobs_no_update; UPDATE source_blobs SET content = zeroblob(byte_length);'); }
    finally { db.close(); }
    const before = canonical(f.path);
    expect(run(f.root, 'repair', '--json').status).toBe(1);
    expect(canonical(f.path)).toEqual(before);
  });

  it('reports native binary load failures with platform and manual-build guidance', () => {
    const script = `
      const dlopen = process.dlopen;
      process.dlopen = (module, path, ...args) => {
        if (String(path).endsWith('better_sqlite3.node')) throw new Error('Cannot load native SQLite binding');
        return dlopen(module, path, ...args);
      };
      const { SqliteDatabase } = await import('@graphit/storage');
      try { new SqliteDatabase(':memory:'); process.exitCode = 2; }
      catch (error) { console.log(error.message); }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Cannot load better-sqlite3');
    expect(result.stdout).toContain(process.platform + '/' + process.arch);
    expect(result.stdout).toContain('C++ toolchain and Python');
  });

  it('enforces Node >=22 and returns clear doctor diagnostics without creating a project', async () => {
    for (const version of ['18.20.0', '20.19.0', '21.7.0', 'invalid']) expect(nodeSupported(version)).toBe(false);
    for (const version of ['22.0.0', '22.17.0', '24.0.0', '26.1.0']) expect(nodeSupported(version)).toBe(true);
    const original = Object.getOwnPropertyDescriptor(process.versions, 'node')!;
    try {
      Object.defineProperty(process.versions, 'node', { value: '20.19.0', configurable: true });
      const report = await inspectProject(undefined);
      expect(report.node_supported).toBe(false);
      expect(report.errors.join()).toContain('Unsupported Node');
    } finally { Object.defineProperty(process.versions, 'node', original); }
    const report = await inspectProject(undefined);
    expect(report).toMatchObject({ platform: process.platform, architecture: process.arch, better_sqlite3_load: true, node_supported: true });
    expect(report.sqlite_version).toMatch(/^\d+\.\d+/);
  });

  it('does not leave a destination after invalid import input and permits a clean retry', async () => {
    const f = await project(); const destination = temporary(); const file = join(f.root, 'retry.graphit');
    writeFileSync(file, 'broken gzip');
    expect(run(destination, 'import', file).status).toBe(1);
    const good = join(f.root, 'good.graphit'); ok(f.root, 'export', good);
    ok(destination, 'import', good);
    expect(canonical(join(destination, '.graphit', 'graphit.db'))).toEqual(canonical(f.path));
  });
});
