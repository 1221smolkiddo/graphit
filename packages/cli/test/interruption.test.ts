import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventStore, SqliteDatabase, readExportFile, validateExport } from '@graphit/storage';
import { canonical, cliUrl, killAtBarrier, ok, pause, project, run, temporary } from './recovery-helpers.js';

describe('P6B real process interruption and recovery', () => {
  it.each(['open', 'transaction'])('recovers WAL after a process is killed at %s', async stage => {
    const f = await project();
    await killAtBarrier(`
      import { EventStore } from '@graphit/storage';
      import { MemoryService } from '@graphit/memory';
      import { CodeGraphService } from '@graphit/codegraph';
      const store = new EventStore(process.argv[1]);
      new MemoryService(store); new CodeGraphService(store);
      store.checkpoint(process.argv[2], 'acknowledged');
      ${stage === 'transaction' ? `store.withProjectTransaction(process.argv[2], tx => { store.checkpoint(process.argv[2], 'uncommitted'); tx.putSourceBlob(new Uint8Array([99])); ${pause} });` : pause}
    `, f.root, [f.path, f.id]);
    expect(existsSync(f.path + '-wal')).toBe(true);
    const store = new EventStore(f.path);
    try {
      const events = store.readEvents(f.id);
      expect(events.slice(0, f.events.length)).toEqual(f.events);
      expect(events).toHaveLength(f.events.length + 1);
      expect(store.getState(f.id).checkpoints.at(-1)!.name).toBe('acknowledged');
    } finally { store.close(); }
    expect(JSON.parse(ok(f.root, 'repair', '--json')).canonical_unchanged).toBe(true);
    expect(JSON.parse(ok(f.root, 'doctor', '--json')).integrity_check).toBe('ok');
  });

  it('kills the real index CLI during blob insertion, preserves history and explicitly recomputes', async () => {
    const f = await project(); const before = canonical(f.path);
    writeFileSync(join(f.root, 'sample.ts'), 'export function recoverEvidence() { return 99; }');
    await killAtBarrier(`
      import { SqliteDatabase } from '@graphit/storage';
      const prepare = SqliteDatabase.prototype.prepare;
      SqliteDatabase.prototype.prepare = function(sql) {
        const stmt = prepare.call(this, sql);
        if (sql.startsWith('INSERT INTO source_blobs')) {
          const run = stmt.run; stmt.run = (...args) => { const result = run(...args); ${pause} return result; };
        }
        return stmt;
      };
      process.chdir(process.argv[1]); process.argv = [process.execPath, 'index', '.', '--json'];
      await import(${JSON.stringify(cliUrl)});
    `, f.root, [f.root]);
    expect(canonical(f.path).blobs).toEqual(before.blobs);
    const doctor = JSON.parse(ok(f.root, 'doctor', '--json'));
    expect(doctor.last_index_status).toBe('running');
    expect(doctor.latest_interrupted_operation.status).toBe('running');
    expect(run(f.root, 'index', '.').stderr).toContain('--rebuild');
    ok(f.root, 'repair');
    expect(JSON.parse(ok(f.root, 'index', '.', '--rebuild', '--json')).status).toBe('completed');
    const after = canonical(f.path);
    expect(after.events.slice(0, before.events.length)).toEqual(before.events);
    for (const blob of before.blobs) expect(after.blobs).toContainEqual(blob);
    expect(after.blobs.length).toBe(before.blobs.length + 1);
  });

  it('never publishes a partial export after a writer is killed, then retries without modifying the DB', async () => {
    const f = await project(); const before = canonical(f.path); const file = join(f.root, 'crashed.graphit');
    await killAtBarrier(`
      import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
      const create = fs.createWriteStream;
      fs.createWriteStream = (...args) => {
        const stream = create(...args); const write = stream._write;
        stream._write = function(chunk, encoding, callback) {
          write.call(this, chunk, encoding, error => { if (!error) { ${pause} } callback(error); });
        }; return stream;
      };
      syncBuiltinESMExports();
      process.chdir(process.argv[1]); process.argv = [process.execPath, 'export', process.argv[2]];
      await import(${JSON.stringify(cliUrl)});
    `, f.root, [f.root, file]);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(f.root).some(name => name.endsWith('.partial'))).toBe(true);
    expect(canonical(f.path)).toEqual(before);
    ok(f.root, 'export', file);
    expect(validateExport(await readExportFile(file)).events).toEqual(f.events);
    const saved = readFileSync(file);
    expect(run(f.root, 'export', file).status).toBe(1);
    expect(readFileSync(file)).toEqual(saved);
  });

  it.each(['blob', 'event', 'projection'])('keeps the import destination unpublished when killed during %s writes', async stage => {
    const f = await project(); const file = join(f.root, 'snapshot.graphit'); ok(f.root, 'export', file);
    const destination = temporary();
    const inject = stage === 'projection'
      ? `const rebuild = EventStore.prototype.rebuildProjections; EventStore.prototype.rebuildProjections = function() { rebuild.call(this); ${pause} };`
      : `const prepare = SqliteDatabase.prototype.prepare;
         SqliteDatabase.prototype.prepare = function(sql) {
           const stmt = prepare.call(this, sql);
           if (sql.startsWith('${stage === 'blob' ? 'INSERT INTO source_blobs' : 'INSERT INTO events'}')) {
             const run = stmt.run; stmt.run = (...args) => { const result = run(...args); ${pause} return result; };
           } return stmt;
         };`;
    await killAtBarrier(`
      import { EventStore, SqliteDatabase } from '@graphit/storage';
      ${inject}
      process.chdir(process.argv[1]); process.argv = [process.execPath, 'import', process.argv[2]];
      await import(${JSON.stringify(cliUrl)});
    `, destination, [destination, file]);
    expect(existsSync(join(destination, '.graphit'))).toBe(false);
    const staging = readdirSync(destination).find(name => name.startsWith('.graphit-import-'))!;
    const db = new SqliteDatabase(join(destination, staging, 'graphit.db'));
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()!.n).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS n FROM source_blobs').get()!.n).toBe(0);
      expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
    } finally { db.close(); }
    ok(destination, 'import', file);
    expect(canonical(join(destination, '.graphit', 'graphit.db'))).toEqual(canonical(f.path));
    ok(destination, 'doctor');
  });
});
