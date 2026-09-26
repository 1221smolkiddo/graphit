# Privacy and preservation

Canonical events and SHA-256 source blobs are append-only. SQLite triggers reject updates/deletes/replacement inserts. Sequence allocation and writes are transactional under WAL; checkpoints and derived state are validated by replay. No P5 migration changes previous schemas or data.

Graphit does **not** automatically scrape full private Codex/Claude chats. It captures only explicitly recorded CLI/MCP data and deliberately indexed source. It makes no model requests, has no cloud sync, and exposes no shell-execution tool. Stdio MCP clients you authorize can read selected-project evidence and append validated records.

Use a local filesystem with reliable SQLite locking; avoid synchronizing a live WAL database. Do not commit `.graphit/` or private export archives. Back up with `graphit export` and test restore in a clean directory. Copying only `graphit.db` while writers run can omit WAL data.

Archives and databases are **not encrypted**. They can include proprietary code, command output, chat records, accidentally recorded credentials and original absolute paths. Ignore rules help with indexing but are not a secret scanner. Review data before explicitly recording/indexing/exporting it. Do not assume deleting a working-tree file removes its preserved history.

The published-package allowlist contains only generated runtime JS, four SQL migrations, concise public docs, README and LICENSE. Release verification scans that exact tarball for local paths, credential patterns and unexpected files. No tests, fixtures, private transcripts, archives, `.graphit` databases or machine-specific configuration are shipped.

Full filesystem access can bypass triggers and recompute hashes; this is not a signed audit ledger. Preserve trusted offline backups. Doctor is read-only and reports corruption; it does not silently rewrite evidence or repair derived data.
