# Graphit

Graphit is local project memory and code intelligence for coding agents. It preserves immutable events and source evidence, then derives a code graph, durable memory, provider-neutral handoff and token-budgeted context. Version **0.1.0**, through P6C.

P6C stress evidence: 1,000 deterministic files, 22,000 symbols and 80,000 edges.
A measured duplicate-edge fix reduced graph assembly from 56.09s to 1.14s;
initial / unchanged / one-file indexing changed from 362.06 / 138.36 / 123.65s
to 231.30 / 15.46 / 18.26s on Windows x64 / Node 22.17.
These are single local runs, not SLAs: replay remains costly and peak RSS was
about 1.47 GB. Full JSON measurements and reproduction scripts are in
[benchmarks](benchmarks) and [architecture](docs/ARCHITECTURE.md).

## Install

Stable release preparation adds a Node 22 Windows/Ubuntu/macOS CI matrix and a
manual, protected OIDC publishing workflow. Remote platform results are still
pending; publishing is blocked by the existing npm name/version. See
[release checklist](docs/RELEASE.md).

Graphit is local-first and sends no telemetry by default. The live SQLite project
database (including WAL/SHM) is **not encrypted at rest** in 0.1.0. Use OS disk
encryption and filesystem permissions to protect it. Optional encrypted exports
use AES-256-GCM plus scrypt; they do not encrypt the live database.

Requires Node.js **22.0.0 or newer** and a local filesystem suitable for SQLite WAL. The package engine, CLI/storage checks and doctor use the same policy. Git is optional for commit metadata.

This build is **not published**. The requested name `graphit` and version `0.1.0` are already registered on npm to another maintainer; `npm install -g graphit` currently installs that other package. Until an available package identity is settled, install the verified local tarball:

```sh
npm install -g graphit-cmp
graphit --version
graphit --help
```

No private workspace packages, provider accounts or API keys are needed. From this source checkout: `npm ci`, `npm run build`, then `node packages/cli/dist/index.js --help`.

## Quick start

Run these in your repository:

```sh
graphit init --name "My project"
graphit index .
graphit code stats
graphit retrieve "where is login handled?" --json
graphit context "explain this project" --tokens 1500
graphit handoff
graphit doctor --json
```

### Code graph

Tree-sitter indexes TypeScript, TSX, JavaScript, JSX and Python incrementally. Symbol identities, relationships and exact byte spans refer to immutable SHA-256 source blobs. `graphit code symbol <name>` finds symbols; `code callers`, `code callees` and `code source <id>` inspect preserved evidence rather than reading arbitrary live files.

### Project memory and handoff

Explicitly record evidence with MCP `graphit_record_event`, then promote a goal, task, decision, constraint, blocker, question, action, result or artifact with `graphit_add_memory`. Every memory retains source event IDs. CLI `graphit memory add --type task --content "Verify login" --source-event <id>` uses the same promotion API. Supersession preserves history.

`graphit handoff` returns current memory and provenance. A different provider can start later and continue using those same events; no provider-specific chat schema is canonical.

### Token-aware context

Exact matching, FTS5/BM25, reciprocal-rank fusion and bounded Personalized PageRank retrieve evidence. Deterministic MMR reduces duplication and packs a canonical packet into the requested estimated-token budget. Missing required evidence is explicit; CLI context exits **2** when the budget is insufficient. The estimator is UTF-8 bytes/4, not a model-specific tokenizer.

The refresh-work fixture measured **27,652 candidate tokens → 1,960 selected**, a **92.91% reduction**, preserving **6/6 required evidence items** at a 2,000-token budget. Small run-to-run differences arise from identities/paths and packing tie-breaks; these are fixture results, not universal performance guarantees.

### MCP

`graphit mcp --project <project-directory>` serves 13 tools and three resources over stdio. `graphit mcp config --json` prints a local client configuration; `graphit mcp doctor` checks readiness. Use the direct binary or Node entrypoint in MCP configuration, not an npm script that prints banners to stdout. See [MCP setup](docs/MCP.md).

### Privacy and data preservation

Graphit does **not** automatically scrape full private Codex/Claude chats. It captures data explicitly recorded through Graphit CLI/MCP, plus files you deliberately index. It does not call LLMs or cloud services. `.graphit/` contains private project evidence and should not be committed.

Source events and blobs are append-only; memory, code and search indexes are reconstructable. `graphit export snapshot.graphit` makes a checksummed plaintext archive; add `--encrypt` for AES-256-GCM encryption with a no-echo passphrase prompt. `graphit import snapshot.graphit` auto-detects either format, authenticates encrypted input, then rebuilds derived indexes in a clean directory. For automation, use `--passphrase-env VARIABLE_NAME`, never a secret value in argv. Live databases remain unencrypted. See [data preservation](docs/DATA_PRESERVATION.md) and [portability](docs/PORTABILITY.md).

## Documentation

- [Getting started](docs/GETTING_STARTED.md) and [CLI reference](docs/CLI.md)
- [Architecture](docs/ARCHITECTURE.md), [memory](docs/MEMORY.md), [retrieval](docs/RETRIEVAL.md)
- [MCP](docs/MCP.md), [portability](docs/PORTABILITY.md), [data preservation](docs/DATA_PRESERVATION.md)

## Verification and limitations

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm pack --dry-run
npm pack
npm run verify:packed -- ./graphit-cmp-1.0.0.tgz
npm run mcp:smoke
node examples/context-demo.mjs
```

The packed-install check runs outside the workspace and exercises real stdio clients, full provider restart, preserved evidence and export/import. Windows/Node 22.17 is the tested release environment; other supported platforms still need CI coverage. SQLite uses the stable native `better-sqlite3` driver, without Node's experimental SQLite runtime. The pinned driver ships platform-specific native binaries; a compatible binary is required, or a manual native build on unsupported platforms. Existing project databases retain their schema, migration ledger and canonical evidence.

Windows x64 / Node 22.17 is locally verified. macOS and Linux x64/arm64 are intended targets with native prebuilds, but have not been executed in this verification environment. Other Node versions allowed by the engine are not a tested matrix. The clean-prefix smoke script is portable and can be run manually on each target; no CI or publication is configured.

Before upgrading, export a backup or stop all writers and preserve the entire `.graphit` directory, including WAL/SHM files. Existing P0–P6A schemas use normal checksummed migrations without canonical conversion. Inconsistent ledgers, missing schema objects and physical corruption fail closed.

`graphit doctor --json` diagnoses without repair. For stale derived rows, stop other writers, back up, then run `graphit repair --json` and doctor again. Repair atomically rebuilds project/session/checkpoint, memory, code and retrieval projections for all projects in the local database; events/blobs must remain unchanged. Interrupted indexing requires `graphit index . --rebuild`. Canonical damage or missing schema tables requires recovery from a verified backup into a new directory, never deleting the original. See [recovery details](docs/DATA_PRESERVATION.md).

Synchronous replay and startup integrity checking favor correctness over very large histories. Dynamic calls and ambiguous imports may remain unresolved; only provable import/export alias chains are resolved. Hashes detect corruption, not malicious re-signing by someone with full filesystem access. Imports are limited to 256 MiB uncompressed (257 MiB compressed); no archive merge or live-database encryption. No VS Code extension, UI, website, cloud sync, embeddings, LLM summaries or private transcript scraping.
