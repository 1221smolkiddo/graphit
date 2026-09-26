# Export and import

```sh
graphit export snapshot.graphit
# Change to a clean directory outside an existing Graphit project:
graphit import /path/to/snapshot.graphit
graphit doctor --json
graphit handoff
```

Format v1 is gzip-compressed NDJSON with `GRAPHIT_EXPORT` magic, exactly one leading manifest, migration checksums, ordered events (canonical JSON payload strings) and base64 source blobs. SHA-256 covers the entire manifest metadata and records; event envelopes and each blob are also verified independently. Project metadata, sessions and checkpoints are preserved through their canonical events. All source versions referenced by project observations are included, including historical/failed-run evidence. Unrelated project blobs and derived indexes are excluded.

Exports use a consistent SQLite snapshot and refuse existing output files. They write a unique same-directory `.partial` file, verify the compressed result's manifest/hashes, flush file contents, then publish with an atomic no-overwrite hard link. Local NTFS/APFS/ext4-style hard-link support is required; unsupported filesystems fail visibly rather than falling back to a partial copy. Caught failures clean up their temporary file; a killed process may leave it for inspection/retry. The requested final name is never exposed while compression is incomplete. Hashes are corruption checks, not authentication or encryption; parent-directory durability after power loss is filesystem-dependent.

Import rejects bad magic/JSON, unknown records, duplicate manifests, unsupported versions, changed migration checksums, invalid event hashes/payloads/sequences/provenance, corrupt/missing/duplicate/unrelated blobs and mismatched observation lengths. Uncompressed input is limited to 256 MiB. It does not extract paths or execute archived commands.

A temporary database is created beside the destination. Canonical inserts and memory/code/search rebuilds share one transaction. Only after success is the temporary directory renamed to `.graphit`; failures remove only the generated staging directory. Existing `.graphit` state is never replaced or merged. Abrupt termination can leave an uninstalled `.graphit-import-*` directory for manual inspection.

Import retains original project IDs, event IDs, timestamps, sessions, source bytes and historical absolute paths. `.graphit/project.json` is a machine-local project binding, allowing CLI/MCP/indexing at the new root without rewriting history. New index runs use the canonical project-root identity while scanning the locally attached checkout. Import does not materialize or overwrite working-tree source files; attach/copy a checkout before deliberately reindexing.

The portability test imports into a different empty location with no source checkout, verifies historical source and exact memory/graph state, exercises BM25/PPR/context and opens a real MCP connection. It deliberately damages original derived tables before export to verify rebuilding from canonical data.

Format v1 remains unchanged. `export_version` identifies the envelope; `migration_versions` and checksummed migration records identify its database schema (the maximum version is the schema version). Supported older schema prefixes in v1 import into the current schema and rebuild projections. No older envelope than v1 exists; unknown future envelope/schema versions fail closed.

Windows x64 / Node 22.17 clean-prefix installs are verified locally. macOS/Linux are inspected targets, not verified platforms here. Runtime paths use Node path APIs; npm selects Windows command shims versus POSIX bin links, and repository-relative evidence always uses `/`. Native `better-sqlite3@13.0.3` ships x64/arm64 prebuilds for Windows/macOS/Linux (including musl). If none matches, its loader tries local native-build output; Graphit reports the platform, architecture and reinstall/build guidance rather than hiding failure. A source build needs the driver's build-release prerequisites, Python and a C++ toolchain. The missing-prebuild failure path is tested; a native compilation and macOS/Linux execution are not claimed.
