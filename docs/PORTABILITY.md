# Export and import

```sh
graphit export snapshot.graphit
# Change to a clean directory outside an existing Graphit project:
graphit import /path/to/snapshot.graphit
graphit doctor --json
graphit handoff
```

Format v1 is gzip-compressed NDJSON with `GRAPHIT_EXPORT` magic, exactly one leading manifest, migration checksums, ordered events (canonical JSON payload strings) and base64 source blobs. SHA-256 covers the entire manifest metadata and records; event envelopes and each blob are also verified independently. Project metadata, sessions and checkpoints are preserved through their canonical events. All source versions referenced by project observations are included, including historical/failed-run evidence. Unrelated project blobs and derived indexes are excluded.

Exports use a consistent SQLite snapshot and refuse existing output files. A failed output write can leave an incomplete archive; validation will reject it. Hashes are corruption checks, not authentication or encryption.

Import rejects bad magic/JSON, unknown records, duplicate manifests, unsupported versions, changed migration checksums, invalid event hashes/payloads/sequences/provenance, corrupt/missing/duplicate/unrelated blobs and mismatched observation lengths. Uncompressed input is limited to 256 MiB. It does not extract paths or execute archived commands.

A temporary database is created beside the destination. Canonical inserts and memory/code/search rebuilds share one transaction. Only after success is the temporary directory renamed to `.graphit`; failures remove only the generated staging directory. Existing `.graphit` state is never replaced or merged. Abrupt termination can leave an uninstalled `.graphit-import-*` directory for manual inspection.

Import retains original project IDs, event IDs, timestamps, sessions, source bytes and historical absolute paths. `.graphit/project.json` is a machine-local project binding, allowing CLI/MCP/indexing at the new root without rewriting history. New index runs use the canonical project-root identity while scanning the locally attached checkout. Import does not materialize or overwrite working-tree source files; attach/copy a checkout before deliberately reindexing.

The portability test imports into a different empty location with no source checkout, verifies historical source and exact memory/graph state, exercises BM25/PPR/context and opens a real MCP connection. It deliberately damages original derived tables before export to verify rebuilding from canonical data.
