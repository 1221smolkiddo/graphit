import Database from 'better-sqlite3';

type Row = Record<string, unknown>;

// Keep SQL, locking and transaction ownership in the storage layer. Only the
// native driver boundary lives here.
export class SqliteDatabase {
  readonly #database: Database.Database;

  constructor(path: string, options: { readonly?: boolean } = {}) {
    this.#database = new Database(path, { ...options, timeout: 5000 });
  }

  exec(sql: string): void { this.#database.exec(sql); }
  close(): void { this.#database.close(); }

  // Historical migrations extend the immutable event CHECK via writable_schema.
  // better-sqlite3's defensive mode blocks that operation. Relax it only inside
  // the migration transaction, including schema refresh and integrity checking.
  applySchemaMigration(sql: string, validate: () => void): void {
    if (!this.#database.inTransaction) throw new Error('Schema migration requires a transaction');
    this.#database.unsafeMode(true);
    try {
      this.#database.exec(sql);
      validate();
    } finally {
      try { this.#database.exec('PRAGMA writable_schema = RESET'); }
      finally { this.#database.unsafeMode(false); }
    }
  }

  prepare(sql: string) {
    const statement = this.#database.prepare<unknown[], Row>(sql).safeIntegers(true);
    // The previous driver failed closed on integers outside JS's safe range.
    // Never silently round canonical sequences, lengths or migration versions.
    const decode = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      if (typeof value !== 'bigint') return [key, value];
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new RangeError('SQLite integer exceeds the safe JavaScript range');
      return [key, number];
    }));
    return {
      get: (...params: unknown[]): Row | undefined => {
        const row = statement.get(...params);
        return row === undefined ? undefined : decode(row);
      },
      all: (...params: unknown[]): Row[] => statement.all(...params).map(decode),
      run: (...params: unknown[]): Database.RunResult => statement.run(...params),
    };
  }
}
