# MCP: provider-neutral continuation

Graphit 1.0.1 uses `@modelcontextprotocol/server` **2.1.0** and stdio, with a transport-independent project-bound API. No HTTP service or provider SDK is required. Start with `graphit mcp --project <project-directory>`; stdout is protocol only, errors are stderr.

## Client setup

`graphit mcp config --json` prints configuration for the current project. Use the same provider-neutral entry in Cursor's `.cursor/mcp.json` or Claude Desktop's `claude_desktop_config.json`; these hosts support `mcpServers` with command/args. See [Cursor configuration](https://prod.cursor.com/help/customization/mcp) and the [MCP local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

```json
{
  "mcpServers": {
    "graphit": {
      "command": "graphit",
      "args": ["mcp", "--project", "/path/to/your/project"]
    }
  }
}
```

For hosts that cannot find the global binary (including Windows GUI environments), use an absolute Node executable with args `["<installed-package>/dist/cli/index.js", "mcp", "--project", "<project-directory>"]`. `npm root -g` locates installed packages. Do not launch through `npm run`, whose banners can corrupt stdio. Other hosts may use TOML or another config syntax: use their native stdio command/args fields with the same Graphit arguments.

Optional flags `--provider`, `--agent`, `--model`, `--external-session-id`, `--client` map to plain session metadata. Arbitrary strings work. None changes memory or context format. Project UUIDs resolve only within the database discovered from the working directory; paths explicitly select a database.

## Stable tools

| Tool | Inputs / purpose |
| --- | --- |
| `graphit_status` | `{}`; replayed project/session/checkpoint state |
| `graphit_handoff` | `{}`; durable memory and provenance |
| `graphit_context` | `query`; optional `token_budget`, `mode`, `current_files`, `seed_symbols` |
| `graphit_retrieve` | Same query fields plus optional `limit`; ranked evidence and paths |
| `graphit_find_symbol` | `query`; exact name, qualified name or current ID |
| `graphit_get_source` | `symbol_id`; current or historical version, preserved bytes only |
| `graphit_callers` | `symbol_id`; incoming CALLS edges |
| `graphit_callees` | `symbol_id`; outgoing CALLS edges |
| `graphit_impact` | `symbol_id`; optional `query`, `limit`; bounded impact retrieval |
| `graphit_checkpoint` | Optional `name`; append checkpoint |
| `graphit_record_event` | `event_type`, `payload`; append validated data, never execute it |
| `graphit_add_memory` | `entity_type`, `content`, nonempty `source_event_ids` |
| `graphit_link_memory` | `from_memory_id`, `to_memory_id`, `relation_type`, `source_event_ids` |

All inputs are strict; unknown fields, cross-project IDs, malformed payloads and path traversal are rejected. Raw source event types: conversation.user_message, conversation.assistant_message, tool.call, tool.result, command.executed, command.result, file.changed, test.result. Raw events do not automatically become durable memory.

Resources: `graphit://project/status`, `graphit://project/handoff`, `graphit://memory/current`. No arbitrary filesystem resources. MCP has no indexing, import, arbitrary execution, remote transport or provider-transcript scraping tools.

## Continuation and failure behavior

Agent A explicitly records events, promotes memory and checkpoints. After A's process fully exits, agent B calls handoff and context with `query: "continue the current work"`. B can record further actions citing A's event IDs. Canonical evidence is unchanged; no full original chat replay is required. Session switches are transactional and attributed correctly under concurrent clients.

Context is exactly the canonical P3 packet. Check `budget.budget_insufficient`; insufficient budgets return an explicit packet rather than pretending required evidence survived. Domain failures return `isError`; protocol validation may reject the call. Source reads never fall back to current working-tree files when blobs are missing/corrupt.

`graphit mcp doctor [--project <path-or-id>]` performs the same read-only evidence/projection checks as `graphit doctor`, including runtime/MCP versions and migration status. No repair occurs.

Tests use the actual SDK client and child processes with Anthropic/OpenAI metadata, not paid provider APIs or proprietary host applications. `npm run mcp:smoke` tests the checkout; `npm run verify:packed -- ./graphit-cmp-1.0.1.tgz` tests an isolated installation, export/import and real MCP restart. Token estimates are approximate; stdio hosts add their own framing overhead.
