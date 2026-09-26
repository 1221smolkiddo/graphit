import { join } from 'node:path';
import { SqliteDatabase } from '@graphit/storage';
import { describe,expect,it } from 'vitest';
import { migrate,migrations } from '@graphit/storage';
import { temporary,track } from './helpers.js';
describe('P3 migration',()=>{
  it('adds FTS5 tables without changing previous schemas or migration ledger entries',()=>{
    const db=track(new SqliteDatabase(join(temporary(),'migration.db')));
    migrate(db,migrations.slice(0,3));
    const schema=db.prepare("SELECT name,sql,rootpage FROM sqlite_schema ORDER BY name").all();
    const ledger=db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    migrate(db);
    const after=db.prepare("SELECT name,sql,rootpage FROM sqlite_schema ORDER BY name").all();
    expect(after.filter((row)=>!String(row.name).includes('retrieval_'))).toEqual(schema);
    expect(db.prepare('SELECT * FROM schema_migrations WHERE version<4 ORDER BY version').all()).toEqual(ledger);
    expect(after.filter((row)=>String(row.name).endsWith('_fts')).map((row)=>row.name)).toEqual(['retrieval_code_fts','retrieval_memory_fts']);
    expect(db.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
  });
  it('rolls back FTS shadow tables and ledger on failure',()=>{
    const db=track(new SqliteDatabase(join(temporary(),'rollback.db')));migrate(db,migrations.slice(0,3));
    expect(()=>migrate(db,[...migrations.slice(0,3),{...migrations[3]!,sql:migrations[3]!.sql+'\nINSERT INTO absent VALUES (1);'}])).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'retrieval_%'").all()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()!.n).toBe(3);
    migrate(db);
  });
});
