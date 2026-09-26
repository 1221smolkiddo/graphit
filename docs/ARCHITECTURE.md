# Architecture

## P6C boundaries

Optional encrypted transport wraps, rather than replaces, the original canonical
gzip archive. Storage authenticates AES-256-GCM before decoding; the CLI owns
no-echo passphrase prompting. No schema, migration, parser version, event/source
format or retrieval algorithm changes are introduced.

Measured graph assembly contained an O(E²) duplicate-edge scan. An ID set now
deduplicates edges while preserving identical IDs, source spans and final sort
order. Replay, transaction validation, FTS5/BM25, RRF, PPR and MMR are unchanged.

Resolution follows only explicit module-level import/export aliases to a unique
target, including chains through an unambiguous local index module and namespace
access to a forwarded name. Cycles, depth beyond 64, conflicting exports/imports,
rebindings, shadowed names, namespace-object forwarding and dynamic receivers fail
closed. The pinned extractor is unchanged: direct `export ... from`, wildcard
re-exports and tsconfig/package-path aliases remain unresolved. Rebuild derived
projections with `graphit repair` to apply resolution to an existing database.

`auditUnresolved` classifies derived diagnostics into external package, dynamic
call, ambiguous local symbol, namespace/member ambiguity, unsupported syntax,
re-export resolution, aliasing, parser limitation and missing local module.
These are syntactic diagnostic counts, not a runtime completeness claim; unsafe
scope relationships are included in dynamic-call counts. Python absolute imports
cannot reliably be called external without additional package semantics.
The 9-file precision fixture improves unresolved counts 17 → 13 (resolved
relationships 17 → 21, CALLS 2 → 5), with zero false-positive calls. Graphit's own
34-file source snapshot remains 6,454 → 6,454: density is not the optimization
objective. See `benchmarks/p6c-*resolver*.json` and `p6c-repository-*.json`.

The new forwarding case also consults hash-verified preserved source: type-only
imports/exports cannot become runtime call edges. Unsupported export spellings
and missing source access fail closed rather than guessing from incomplete IR.

### Stress measurements

Reproduce after building with `node scripts/stress-p6c.mjs 1000 benchmarks/p6c-stress-after.json`.
The deterministic generator produces 1,000 files, 22,000 symbols and 80,000 edges;
UUIDs, timestamps and root paths intentionally remain normal runtime values.
Single Windows x64 / Node 22.17 before/after measurements:

| Operation | Baseline | ID-set optimization |
| --- | ---: | ---: |
| Initial index | 362.06 s | 231.30 s |
| Graph assembly alone | 56.09 s | 1.14 s |
| Unchanged index (0 parsed) | 138.36 s | 15.46 s |
| One-file index (1 parsed) | 123.65 s | 18.26 s |

Optimized SQL-only BM25: 0.59 ms; PPR: 80–156 ms; context packing: 387–474 ms;
total query: 3.70–4.12 s (includes full replay/projection validation).
Closed DB: 172,199,936 bytes; source blobs: 1,045,681 bytes; serialized graph
projection payloads: 81,773,765 bytes (not allocated SQLite pages); plaintext
archive: 313,020 bytes. Peak process RSS: 1,474,207,744 bytes. The packed-run report
also records encrypted archive size and fresh-install timings.

Baseline was measured before optimization. Local development activity, filesystem
cache, GC and random identities affect timings/packing; these are measurements,
not isolated multi-run performance guarantees. Full-history replay per event,
projection revalidation/republication and process memory remain scaling limits.
No larger scale or Linux/macOS timing is claimed. Raw evidence is in
`benchmarks/p6c-stress-baseline.json`, `p6c-stress-after.json` and
`p6c-stress-packed.json`. P3 quality remains 6/6 required evidence, approximately
92.91% estimated-token reduction; its new report does not replace the P3 baseline.

History and source are immutable. Memory and graph state are derived. Context is disposable. Provider-specific state is never canonical.

The TypeScript npm workspaces remain: core → storage → memory/codegraph → indexer → retrieval → context → MCP → CLI. Core validates events, canonical JSON, timestamps and deterministic SHA-256 IDs. Storage owns WAL SQLite, transactional writes, append-only triggers and four checksummed migrations. Memory owns temporal promotion/supersession. Codegraph owns IR/replay; indexer owns pinned Tree-sitter extraction and incremental observations.

Retrieval retains FTS5/BM25, RRF and bounded Personalized PageRank. Context uses deterministic MMR and full-packet estimated-token accounting. MCP is a project-bound adapter with 13 tools and no arbitrary execution. Optional provider/agent/model/external-session/client labels are plain session metadata. Concurrent writers append correctly attributed session segments within the same SQLite transaction.

P5 adds no tables and does not modify migrations 001–004. Archives contain canonical events and referenced source blobs, not derived caches. Import rebuilds memory/code/FTS atomically before installing a local database. `.graphit/project.json` attaches an imported canonical identity to its new local root; it is not canonical history.

One public npm package contains generated `dist/<workspace>/*.js`, migrations, public docs and license. The prepack assembler rewrites internal workspace imports to relative paths. Runtime algorithms are unchanged; no module bundler or workspace symlink is needed. Zod 3 and MCP's Zod 4 remain separately resolved. Tree-sitter WASM and the MCP SDK are regular runtime dependencies. Source maps, tests, fixtures, databases and private package manifests are excluded.

SQLite connections use `better-sqlite3` through a small synchronous adapter. Writers retain WAL, FULL synchronous mode, foreign keys, a 5-second busy timeout and explicit BEGIN IMMEDIATE / savepoint transactions. The driver change does not alter migration SQL, schema or canonical formats. Historical migrations 2 and 3 require writable-schema access: defensive mode is relaxed only for their SQL and validation inside the migration transaction, then restored in a finally block.

Doctor opens SQLite with `readonly: true`, verifies the ledger and evidence, and compares projections to replay; it does not migrate, checkpoint, repair or append. Missing indexes are warnings; corrupted/stale present indexes are errors.

P6B adds no migrations or canonical format changes. Before applying DDL, startup checks SQLite integrity, the contiguous checksummed ledger, and table/index/trigger presence against the historical migration SQL. A missing ledger or partially applied schema is an error, not permission to reinitialize.

`repair` holds a single writer transaction across canonical validation, all projection rebuilds and FTS refresh. Canonical snapshots must match before commit; any failure rolls back all derived changes. It reparses preserved source with the recorded parser versions, never substituting live files. Physically damaged schema/FTS pages or missing tables are not automatically recreated.

Doctor also reports platform/architecture, supported Node range, native driver loading, SQLite version, integrity, schema/migration status, canonical health and an unfinished index run if present. Node >=22 is enforced at CLI/storage entry points; diagnostic commands can explain unsupported versions. Repository-relative paths stay slash-separated; symlinks are skipped and literal-backslash filenames are rejected instead of being aliased.
