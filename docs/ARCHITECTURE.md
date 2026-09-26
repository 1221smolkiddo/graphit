# Architecture

History and source are immutable. Memory and graph state are derived. Context is disposable. Provider-specific state is never canonical.

The TypeScript npm workspaces remain: core → storage → memory/codegraph → indexer → retrieval → context → MCP → CLI. Core validates events, canonical JSON, timestamps and deterministic SHA-256 IDs. Storage owns WAL SQLite, transactional writes, append-only triggers and four checksummed migrations. Memory owns temporal promotion/supersession. Codegraph owns IR/replay; indexer owns pinned Tree-sitter extraction and incremental observations.

Retrieval retains FTS5/BM25, RRF and bounded Personalized PageRank. Context uses deterministic MMR and full-packet estimated-token accounting. MCP is a project-bound adapter with 13 tools and no arbitrary execution. Optional provider/agent/model/external-session/client labels are plain session metadata. Concurrent writers append correctly attributed session segments within the same SQLite transaction.

P5 adds no tables and does not modify migrations 001–004. Archives contain canonical events and referenced source blobs, not derived caches. Import rebuilds memory/code/FTS atomically before installing a local database. `.graphit/project.json` attaches an imported canonical identity to its new local root; it is not canonical history.

One public npm package contains generated `dist/<workspace>/*.js`, migrations, public docs and license. The prepack assembler rewrites internal workspace imports to relative paths. Runtime algorithms are unchanged; no module bundler or workspace symlink is needed. Zod 3 and MCP's Zod 4 remain separately resolved. Tree-sitter WASM and the MCP SDK are regular runtime dependencies. Source maps, tests, fixtures, databases and private package manifests are excluded.

Doctor opens SQLite with `readOnly: true`, verifies the ledger and evidence, and compares projections to replay; it does not migrate, checkpoint, repair or append. Missing indexes are warnings; corrupted/stale present indexes are errors.
