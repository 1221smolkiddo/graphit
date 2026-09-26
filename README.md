# Graphit P3

A local, event-sourced foundation with durable project memory, provider-neutral handoff, deterministic code intelligence, and evidence-preserving context compilation. P0–P2 guarantees remain intact. See the [P1 guide](docs/P1.md), [P2 guide](docs/P2.md), and [P3 guide](docs/P3.md) for contracts, provenance, retrieval algorithms, quality gates and measured limitations.

Requires Node.js **22.13+** (Node 22.17 was used for development) and npm workspaces. Node's built-in `node:sqlite` avoids a native addon installation; this Node version emits an experimental SQLite warning on stderr.

```sh
npm ci
npm run build
npm exec -- graphit --help
```

The workspace provides the `graphit` executable. From this checkout use `npm exec -- graphit ...` or `npm run graphit -- ...`. To make the bare command available in another repository, optionally run `npm link --workspace @graphit/cli` after building.

```sh
graphit init --name "My project"
graphit status
graphit checkpoint --name "P0 ready"
graphit resume
graphit resume --checkpoint <checkpoint-id>
graphit index .
graphit code stats --json
graphit code symbol <name-or-id> --json
graphit code source <symbol-or-version-id>
graphit retrieve "handoff" --limit 10 --json
graphit context "fix refresh token race" --tokens 2000 --json
graphit memory link <memory-id> --symbol <symbol-id>
```

Every command accepts `--json` for structured stdout; errors and Node warnings go to stderr. Commands return exit code 1 on failure; context returns 2 when its budget cannot preserve mandatory evidence. `init` creates `.graphit/graphit.db` and atomically appends project/session events. Commands discover projects upward; duplicate/nested initialization is rejected. On Windows, use `.\node_modules\.bin\graphit.cmd` or `node packages/cli/dist/index.js` if the npm PowerShell shim consumes flags.

`checkpoint` appends a named record of the exact state **before** its own event, including the event sequence and state hash. A checkpoint's ID is its event ID. `resume` selects the latest checkpoint unless an ID is supplied, validates and reconstructs that checkpoint's state, and appends `session.resumed` with a fresh session ID. It preserves all later history. JSON output includes both `checkpoint_state` and current `state`. `status` verifies and replays history without appending an event.

## Architecture

- `@graphit/core`: shared event/project/session/checkpoint types, strict runtime validation, canonical JSON, SHA-256 identities, integrity checks and pure state reconstruction.
- `@graphit/storage`: SQLite migrations, append-only event persistence, transactional operations and disposable projections.
- `@graphit/memory`: explicit memory promotion, provenance validation, temporal replay, relationships and handoff JSON.
- `@graphit/codegraph`: parser-independent IR and graph contracts, deterministic identities, conservative edge resolution, projections, replay and queries.
- `@graphit/indexer`: safe scanning, byte hashing, pinned Tree-sitter adapters and incremental indexing.
- `@graphit/retrieval`: exact/FTS candidate channels, RRF, bounded Personalized PageRank, impact/continue modes and explicit memory/code links.
- `@graphit/context`: provenance-bearing evidence, deterministic token estimates, MMR-guided packing and provider-neutral JSON.
- `@graphit/cli`: P0–P3 commands; no parsing or retrieval algorithms.

Build order is core → storage → memory → codegraph → indexer → retrieval → context → CLI. The parser-independent IR lives with codegraph contracts to avoid a dependency cycle; indexer produces it. Tests exercise built workspace exports and the executable.

## Persistence and invariants

| Table | Purpose / columns |
| --- | --- |
| `schema_migrations` | Migration `version`, `name`, SHA-256 `checksum`, `applied_at` |
| `events` | Immutable `id`, `project_id`, `session_id`, `sequence`, `event_type`, canonical JSON `payload`, `created_at`, `content_hash` |
| `projects` | Derived `id`, `name`, `root_path`, `created_at`, `active_session_id`, `last_sequence` |
| `sessions` | Derived identity/time plus optional provider, agent, model, external-session and client metadata |
| `checkpoints` | Derived `id`, `project_id`, `session_id`, `name`, `through_sequence`, `state_hash`, `created_at` |
| `memory_entities` | Derived typed content, lifecycle status, validity interval, provenance and metadata |
| `memory_relations` | Derived typed relationships, validity interval, provenance and metadata |
| `source_blobs` | Immutable SHA-256 `content_hash`, `byte_length`, exact `content BLOB`, `created_at` |
| `code_files`, `code_symbols`, `code_edges`, `code_imports` | Disposable current code graph and cached extraction, scoped by project |
| `code_index_runs`, `code_projection_state` | Disposable index-run history, projection cursor and graph digest |
| `retrieval_memory_fts`, `retrieval_code_fts`, `retrieval_projection_state` | Disposable FTS5 search indexes and document digest, added by migration 004 |

P0 tables and immutability/sequence triggers live in the unchanged `001_initial.sql`; P1 is added by `002_memory.sql`, and P2 by `003_code_intelligence.sql`. Only the migration ledger is bootstrapped by the migration runner. Applied migrations are checksum-verified, ordered, transactional and forward-only. An unknown newer schema or changed migration fails closed. Add a new numbered migration and register it rather than modifying an applied migration.

All store connections require WAL and enable foreign keys, recursive triggers, `synchronous=FULL`, and a 5-second busy timeout. Every write runs inside `BEGIN IMMEDIATE` / `COMMIT`; failure rolls back events **and** projections. Sequences are allocated while holding the write lock, start at 1 per project, and are contiguous. A unique `(project_id, sequence)` constraint and insert trigger enforce ordering. Database triggers reject event updates, deletes and replacement inserts. The app never repairs or removes source events.

`created_at` uses canonical UTC ISO timestamps with milliseconds. Project and session IDs are UUIDs. `content_hash` is SHA-256 of canonical JSON for the unsigned envelope (`project_id`, `session_id`, `sequence`, `event_type`, `payload`, `created_at`). Object keys are sorted recursively and array order is preserved. Event `id` is SHA-256 of `graphit:event:v1:` followed by the content hash. Identical envelopes produce identical IDs; a new timestamp or sequence produces a distinct event. This is deterministic identity, not automatic retry deduplication.

Payload schemas reject unknown fields/types and non-JSON values. Replay verifies hashes, IDs, timestamps, contiguous sequences, project/session relationships and checkpoint state hashes before returning state. Supported payloads:

| Event | Payload |
| --- | --- |
| `project.created` | `{ name, root_path }` |
| `session.started` | Optional provider-neutral session metadata (`{}` still valid) |
| `checkpoint.created` | `{ name, through_sequence, state_hash }` |
| `session.resumed` | `{ checkpoint_id }`, optionally session metadata |

Source events have no foreign keys into disposable projection tables. Canonical state is the ordered event stream plus P2's immutable source blobs. `EventStore.getState()` and `listProjects()` replay events; they do not trust cached rows. `EventStore.rebuildProjections()` atomically rebuilds every project/session/checkpoint row using only those events, plus registered extension projections. Code projection rebuilds reparse preserved bytes, never current working-tree files. Checkpoints store no authoritative opaque snapshots: their exact historical state is reproducible by replaying through `through_sequence`.

```ts
import { EventStore } from '@graphit/storage';
import { MemoryService } from '@graphit/memory';
import { CodeGraphService } from '@graphit/codegraph';
import { createParserRegistry } from '@graphit/indexer';

const store = new EventStore('/absolute/path/to/.graphit/graphit.db');
new MemoryService(store); // Register the P1 memory schemas and projector.
new CodeGraphService(store, await createParserRegistry()); // Register P2 replay and pinned adapters.
try {
  store.rebuildProjections();
} finally {
  store.close();
}
```

## Verification

```sh
npm test
npm run typecheck
npm run lint
```

Vitest covers canonical identity, invalid inputs, integrity failures, replay, migrations, WAL, immutable rows, per-project sequence allocation, multi-process contention, atomic initialization, rollback after projection failure, checkpoint selection, resume, projection deletion/rebuild, and executable CLI flows. `npm test` builds first; typecheck includes source, tests and Vitest configuration.

## Limits and next step

- Full synchronous replay and projection rewriting favor correctness over large-history performance; checkpoints are logical bookmarks, not replay accelerators.
- One local filesystem project per CLI database; the storage API can manage multiple projects. Project paths are stored as absolute paths; moving a project needs an explicit future relocation feature.
- Checkpoints do not capture files, Git commits or application process state. Resume preserves its P0 behavior; `graphit handoff --json` provides durable memory and evidence for a new agent.
- There is no session-close lifecycle, remote sync, general event retry deduplication, database encryption, or backup/restore command. Explicit memory promotion is retry-idempotent. Hash checks detect mismatches but are not signatures against a party with unrestricted database access.
- `node:sqlite` is experimental in the tested Node version. Five-second lock contention is surfaced as an error; no unbounded retry loop is used. Use a local filesystem suitable for SQLite WAL.
- P2 supports TypeScript, TSX, JavaScript, JSX and Python through pinned Tree-sitter WASM. Complex scopes, dynamic receivers and ambiguous imports remain unresolved; see the P2 guide.
- P3 adds lexical/graph ranking and estimated-token budgeting, not semantic understanding or guaranteed provider token counts. Inadequate budgets and missing continuation state are explicit.
- No embeddings, LLM calls, MCP, VS Code integration, automatic conversation extraction or cloud services are included.

Try `node examples/context-demo.mjs` for the isolated P3 quality/budget demonstration and `node examples/context-self-benchmark.mjs` after indexing this checkout for performance metrics. Exact next step: review the P3 quality gates and approve a separate P4 integration/acceptance specification. No P4, MCP or VS Code work has started.
