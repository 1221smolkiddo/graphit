# P4: provider-neutral MCP continuation

P4 exposes Graphit to any MCP-compatible agent over stdio transport. An agent can inspect project status, retrieve handoff state, compile token-budgeted context, search project evidence, inspect symbols/source/callers/callees, perform impact retrieval, record validated source events, explicitly promote durable memory, link memory to symbols and checkpoint work — all without provider-specific adapters, API keys, cloud services, embeddings or automatic LLM summaries.

## Package

`@graphit/mcp` (MCP SDK `@modelcontextprotocol/server` 2.1.0, `@modelcontextprotocol/client` 2.1.0 for tests).

New implementation files:

- `packages/mcp/src/api.ts` — transport-independent, project-bound tool/resource dispatch
- `packages/mcp/src/index.ts` — MCP server factory, project discovery, stdio transport
- `packages/mcp/test/helpers.ts` — real SDK client/server fixture helpers
- `packages/mcp/test/protocol.test.ts` — 18 real MCP client/server process tests
- `examples/mcp-smoke.mjs` — standalone two-process handoff smoke test

Modified files:

- `packages/storage/src/index.ts` — nested savepoints, writer-session attribution, read-only diagnostics
- `packages/cli/src/index.ts` — `graphit mcp` and `graphit mcp doctor` commands
- `tsconfig.check.json` — `@graphit/mcp` path mapping
- `package.json` — `@graphit/mcp` build step and `mcp:smoke` script

No P0/P1/P2/P3 event schema, source blob format, migration or existing test is changed.

## Stdio setup

```jsonc
// Claude Desktop / any MCP host — claude_desktop_config.json
{
  "mcpServers": {
    "graphit": {
      "command": "node",
      "args": ["path/to/packages/cli/dist/index.js", "mcp",
               "--provider", "anthropic", "--agent", "claude-desktop"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

```jsonc
// Codex / any OpenAI-compatible host
{
  "mcpServers": {
    "graphit": {
      "command": "node",
      "args": ["path/to/packages/cli/dist/index.js", "mcp",
               "--provider", "openai", "--agent", "codex"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

The server discovers `.graphit/graphit.db` by walking upward from the working directory. `--project <path-or-id>` overrides the project selection.

Optional session metadata flags: `--provider`, `--agent`, `--model`, `--client`, `--external-session-id`. All are preserved in session events but never affect tool behavior.

## Graphit MCP tools

All 13 tools use strict input schemas (`additionalProperties: false`). Unknown fields are rejected.

### Read-only tools

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `graphit_status` | Project state, sessions, checkpoints from events | — |
| `graphit_handoff` | Provider-neutral durable memory and provenance for continuation | — |
| `graphit_context` | P3 token-budgeted context packet | `query`, optional `token_budget`, `mode`, `current_files`, `seed_symbols` |
| `graphit_retrieve` | Ranked memory/code evidence and graph paths | same as context plus optional `limit` |
| `graphit_find_symbol` | Exact name, qualified name or ID symbol lookup | `query` |
| `graphit_get_source` | Preserved immutable source for a symbol version | `symbol_id` |
| `graphit_callers` | Evidenced incoming CALLS edges | `symbol_id` |
| `graphit_callees` | Evidenced outgoing CALLS edges | `symbol_id` |
| `graphit_impact` | Bounded impact retrieval seeded by a symbol | `symbol_id`, optional `query`, `limit` |

### Write tools

| Tool | Purpose | Key inputs |
| --- | --- | --- |
| `graphit_checkpoint` | Append immutable checkpoint | optional `name` |
| `graphit_record_event` | Append validated source event (data only — nothing is executed) | `event_type`, `payload` |
| `graphit_add_memory` | Explicitly promote durable P1 memory | `entity_type`, `content`, `source_event_ids` |
| `graphit_link_memory` | Explicitly link two P1 memories with provenance | `from_memory_id`, `to_memory_id`, `relation_type`, `source_event_ids` |

Write tools execute inside `withWriterSession`, which atomically attributes each unit of work to the correct session. `graphit_add_memory` and `graphit_link_memory` are idempotent.

`graphit_record_event` accepts `conversation.user_message`, `conversation.assistant_message`, `tool.call`, `tool.result`, `command.executed`, `command.result`, `file.changed` and `test.result`. Recorded commands are data only; nothing is executed. No automatic memory promotion occurs.

### Resources

Three project-scoped JSON resources:

| URI | Content |
| --- | --- |
| `graphit://project/status` | `getState(projectId)` |
| `graphit://project/handoff` | `generateHandoff(projectId)` |
| `graphit://memory/current` | Current (non-superseded) memory entities |

## Cross-provider continuation

Session A (provider=anthropic, agent=claude-code):

1. Records events via `graphit_record_event`
2. Promotes goals, decisions, tasks, results via `graphit_add_memory`
3. Calls `graphit_checkpoint`
4. Server/process exits

Session B (provider=openai, agent=codex), starting later:

1. Calls `graphit_handoff` — receives all durable memory from Session A
2. Calls `graphit_context` with `query: "continue the current work"` — receives token-budgeted context with provider-neutral evidence
3. Provider A's format is irrelevant; Agent B receives provider-neutral state
4. All required evidence is retained; context respects the token budget

State survives full process restarts. The database is the canonical store; no in-memory state is required across sessions.

## Security boundaries

- MCP is project-scoped: the project ID is fixed at server startup
- Cross-project evidence IDs are rejected by `promoteMemory`, `linkMemory` and service validation
- Path traversal is rejected: `normalizePath` blocks `..`, absolute paths outside the project
- Source retrieval uses preserved Graphit evidence (immutable `source_blobs`), not live filesystem reads
- Arbitrary filesystem reads are impossible: `file://` resource URIs are rejected
- Arbitrary shell execution is NOT exposed: recorded `command.executed` events are data only
- Malformed inputs fail closed: strict Zod schemas with `additionalProperties: false`, no partial writes on validation failure
- Unknown project IDs cause immediate non-zero exit before any stdio exchange

## Diagnostics

```bash
graphit mcp doctor [--project <path-or-id>]
```

Reports:

| Field | Description |
| --- | --- |
| `database_reachable` | SQLite database opens successfully |
| `project_initialized` | Selected project exists |
| `journal_mode` | SQLite journal mode (expected: `wal`) |
| `code_index_present` | Whether a code index has been completed |
| `retrieval_index_present` | Whether a retrieval search projection exists |
| `mcp_server_version` | Graphit MCP server version |
| `mcp_sdk_version` | MCP SDK version (`2.1.0`) |
| `handoff_schema_version` | Handoff packet format version |
| `context_schema_version` | Context packet format version |
| `schema_versions` | All applied migration versions |
| `project_id` | Selected project ID |

Doctor is read-only: no events are written and no projections are repaired.

## Architecture: MCP handoff vs. provider transcript ingestion

MCP does **not** automatically provide the entire private chat transcript. The MCP protocol exchanges structured tool calls and results; it does not stream raw conversation history from the host.

P4 supports structured event recording and handoff through MCP tools:

- Agents explicitly record significant events via `graphit_record_event`
- Agents explicitly promote durable memory via `graphit_add_memory`
- Handoff and context compilation operate on this explicit evidence

Full transcript ingestion — reading the complete conversation log from Claude Desktop, Codex CLI, or VS Code extensions — requires provider-specific adapters that access each provider's local storage format. These adapters are **not part of P4** and will be implemented in a later phase where supported.

This separation is intentional:

1. MCP works identically across all providers without special integration
2. Provider-specific adapters can later enrich the evidence store without changing the MCP layer
3. The agent remains in control of what gets promoted to durable memory

## Limitations

- No embeddings or vector search; retrieval uses FTS5/BM25, PPR and exact matching
- No automatic memory extraction from recorded events
- No transcript scraping or import adapters
- No VS Code UI
- No graph visualization
- No npm publication, cloud sync, or production deployment
- Token estimation uses the P3 byte-based approximation, not a tokenizer
- The `mcp:smoke` script requires a built CLI (`npm run build` first)
- FTS5 corpus statistics are per-database, not per-project (see P3 documentation)
