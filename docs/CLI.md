# CLI reference

`graphit --version`, `graphit --help`. Commands discover `.graphit/graphit.db` from the current directory upward. Structured output: `--json`. Errors and Node warnings go to stderr. Exit codes: 0 success, 1 error, 2 insufficient context budget.

| Command | Purpose |
| --- | --- |
| `init [--name <name>]` | Initialize a local project |
| `status` | Replay current project/session/checkpoint state |
| `session start [--provider <name>] [--agent <name>] [--model <name>]` | Append a provider-neutral session; also accepts `--client`, `--external-session-id` |
| `checkpoint [--name <name>]` | Append a checkpoint of the preceding state |
| `resume [--checkpoint <id>]` | Validate checkpoint and start a new session; never rewind history |
| `handoff` | Canonical durable memory and provenance, always JSON |
| `index [path] [--rebuild]` | Incremental code indexing; explicit rebuild/recovery |
| `code stats` | File, symbol, edge and latest-run statistics |
| `code symbol/callers/callees <name-or-id>` | Symbol and call relationships |
| `code imports <file>` | Indexed imports |
| `code source <symbol-or-version-id>` | Immutable source bytes for that evidence |
| `retrieve "query" [--limit <n>] [--mode <mode>]` | Ranked candidates, paths and diagnostics |
| `context "query" [--tokens <n>] [--mode <mode>] [--file <path>] [--symbol <id>]` | Canonical budgeted packet; repeat file/symbol options |
| `memory add --type <type> --content <text> --source-event <id>` | Explicit durable promotion; repeat source-event |
| `memory list [--type <type>] [--status <status>]` | Derived memory |
| `memory supersede <id> --content <text> --source-event <id>` | Replace with provenance; alternatively `--with <replacement-id>` |
| `memory resolve <id> [--source-event <id>]` | Append resolution, retain history |
| `memory link <memory-id> --symbol <symbol-id>` | Explicit memory/code association |
| `doctor [--json]` | Read-only integrity and projection checks |
| `repair [--json]` | Transactionally rebuild all local database projections; never change canonical events/blobs |
| `export <output> [--encrypt] [--passphrase-env NAME]` | Create an exclusive plaintext or authenticated encrypted archive; no overwrite |
| `import <file> [--passphrase-env NAME]` | Auto-detect encryption, authenticate and validate before importing into a clean directory |
| `mcp [--project <path-or-id>]` | Stdio MCP; optional session metadata flags |
| `mcp doctor [--project <path-or-id>]` | Read-only readiness, JSON |
| `mcp config [--json]` | Print configuration; does not edit a client config |

Modes: `auto`, `code`, `memory`, `impact`, `continue`. MCP command/event records never execute commands. Global installation provides the single `graphit` binary; internal workspaces are not public packages.
