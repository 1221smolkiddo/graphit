import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { sha256 } from '@graphit/core';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  { version: 1, name: 'initial', sql: readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8') },
];

/** The ledger is the only bootstrap table; domain DDL lives in numbered migrations. */
export function migrate(database: DatabaseSync, definitions: readonly Migration[] = migrations): void {
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
      database.exec(migration.sql);
      database.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(migration.version, migration.name, checksum, new Date().toISOString());
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
