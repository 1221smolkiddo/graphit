import { readFileSync } from 'node:fs';
import type { SqliteDatabase } from './sqlite.js';
import { sha256 } from '@graphit/core';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  editsEventTypeConstraint?: boolean;
  requiredEventType?: string;
}

export const migrations: readonly Migration[] = [
  { version: 1, name: 'initial', sql: readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8') },
  { version: 2, name: 'memory', sql: readFileSync(new URL('./migrations/002_memory.sql', import.meta.url), 'utf8'), editsEventTypeConstraint: true },
  { version: 3, name: 'code_intelligence', sql: readFileSync(new URL('./migrations/003_code_intelligence.sql', import.meta.url), 'utf8'), editsEventTypeConstraint: true, requiredEventType: 'code.index.failed' },
  { version: 4, name: 'retrieval', sql: readFileSync(new URL('./migrations/004_retrieval.sql', import.meta.url), 'utf8') },
];

/** The ledger is the only bootstrap table; domain DDL lives in numbered migrations. */
export function migrate(database: SqliteDatabase, definitions: readonly Migration[] = migrations): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT`);
    const applied = database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
    if (applied.length > definitions.length) throw new Error('Database schema is newer than this Graphit version');
    for (const [index, migration] of definitions.entries()) {
      if (migration.version !== index + 1) throw new Error('Migrations must be contiguous and ordered');
      const checksum = sha256(migration.sql);
      const existing = applied[index];
      if (existing) {
        if (existing.version !== migration.version || existing.name !== migration.name || existing.checksum !== checksum) {
          throw new Error(`Migration ${migration.version} integrity check failed`);
        }
        continue;
      }
      if (migration.editsEventTypeConstraint) {
        const ddl = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'events'").get()?.sql;
        if (typeof ddl !== 'string' || !ddl.includes("'project.created', 'session.started', 'checkpoint.created', 'session.resumed'")) {
          throw new Error('Unexpected source event schema; migration refused');
        }
      }
      if (migration.editsEventTypeConstraint) {
        database.applySchemaMigration(migration.sql, () => {
          const version = database.prepare('PRAGMA schema_version').get()?.schema_version;
          if (typeof version !== 'number') throw new Error('Invalid SQLite schema version');
          database.exec(`PRAGMA schema_version = ${version + 1}; PRAGMA writable_schema = RESET;`);
          const ddl = database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'events'").get()?.sql;
          if (typeof ddl !== 'string' || !ddl.includes(`'${migration.requiredEventType ?? 'memory.entity.linked'}'`)) throw new Error('Event schema extension failed');
          const checks = database.prepare('PRAGMA integrity_check').all();
          if (checks.length !== 1 || checks[0]?.integrity_check !== 'ok') throw new Error('Migration integrity check failed');
        });
      } else database.exec(migration.sql);
      database.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(migration.version, migration.name, checksum, new Date().toISOString());
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA writable_schema = RESET');
  }
}
