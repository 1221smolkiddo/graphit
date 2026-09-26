# Privacy and preservation

Canonical events and SHA-256 source blobs are append-only. SQLite triggers reject updates/deletes/replacement inserts. Sequence allocation and writes are transactional under WAL; checkpoints and derived state are validated by replay. No P5 migration changes previous schemas or data.

Graphit does **not** automatically scrape full private Codex/Claude chats. It captures only explicitly recorded CLI/MCP data and deliberately indexed source. It makes no model requests, has no cloud sync, and exposes no shell-execution tool. Stdio MCP clients you authorize can read selected-project evidence and append validated records.

Use a local filesystem with reliable SQLite locking; avoid synchronizing a live WAL database. Do not commit `.graphit/` or private export archives. Back up with `graphit export` and test restore in a clean directory. Copying only `graphit.db` while writers run can omit WAL data.

Archives and databases are **not encrypted**. They can include proprietary code, command output, chat records, accidentally recorded credentials and original absolute paths. Ignore rules help with indexing but are not a secret scanner. Review data before explicitly recording/indexing/exporting it. Do not assume deleting a working-tree file removes its preserved history.

The published-package allowlist contains only generated runtime JS, four SQL migrations, concise public docs, README and LICENSE. Release verification scans that exact tarball for local paths, credential patterns and unexpected files. No tests, fixtures, private transcripts, archives, `.graphit` databases or machine-specific configuration are shipped.

Full filesystem access can bypass triggers and recompute hashes; this is not a signed audit ledger. Preserve trusted offline backups. Doctor is read-only and reports corruption; it does not silently rewrite evidence or repair derived data.

## Upgrade and recovery

1. Stop CLI/MCP writers. Export a backup if healthy, or preserve the entire `.graphit` directory including `graphit.db-wal` and `graphit.db-shm`. Do not copy only the main database while it is live.
2. Run `graphit doctor --json`. Recognized old schemas upgrade on normal startup (`graphit status`); doctor itself never migrates. Future schemas, checksum mismatches, missing schema objects, empty existing files and physical corruption fail visibly without deleting/replacing the database.
3. For stale/damaged derived rows, run `graphit repair --json`, then doctor. Repair rebuilds all projects' projections in one transaction, validates preserved source and checks that every canonical row is unchanged. It cannot repair damaged canonical history, missing tables or physical page corruption.
4. For an unfinished index run, stop other indexers and run `graphit index . --rebuild`. It appends a failed-run record, recomputes the index and retains committed historical source. Repair alone never labels a running index completed.
5. For canonical or structural damage, retain the original for investigation and import a verified export into a new empty directory. Graphit never silently initializes over damaged data.

After a process is killed, SQLite WAL recovery retains committed transactions and discards uncommitted work. Tests kill actual child processes during writes, including the CLI index/import/export paths. These are process-crash guarantees on a local filesystem, not proof against hardware failure, unreliable network locking or live cloud-folder synchronization.

A killed export can leave a uniquely named `.partial` file; a killed import can leave `.graphit-import-*`. Neither is a published project/archive. After confirming no writer is active, preserve/inspect those exact artifacts and retry with the original inputs. Do not bulk-delete project directories or WAL files. Doctor can detect a running index from events, but cannot infer arbitrary external export destinations.
