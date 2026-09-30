# Graphit

![Graphit logo](https://raw.githubusercontent.com/1221smolkiddo/graphit/main/website/public/logo-transparent.png)

Persistent project memory and source-backed code intelligence for AI coding agents.

## What is Graphit?

Graphit is a local CLI and MCP server that helps coding agents resume work with project facts and source evidence. It indexes a repository, stores explicitly recorded project events, and derives memory, code, and search views from that history. The npm package is `graphit-cmp`; the executable is `graphit`.

## Why Graphit?

Agents lose context between sessions or providers. Graphit keeps goals, tasks, decisions, and results tied to their source events. Its context compiler selects relevant evidence within a requested token budget, so the next agent can continue without replaying an entire conversation or trusting an unverified summary. Graphit does not automatically capture private provider conversations.

## Key features

- **Persistent project memory:** Promote goals, tasks, decisions, constraints, blockers, questions, actions, results, and artifacts with event provenance. Supersession retains history.
- **Code intelligence:** Incrementally index TypeScript, TSX, JavaScript, JSX, and Python. Find symbols, imports, callers, callees, and exact spans backed by preserved source blobs.
- **Evidence-preserving retrieval:** Combine memory and code candidates with FTS5/BM25, reciprocal-rank fusion, bounded graph traversal, and redundancy control. Results retain paths and source references.
- **Token-aware context:** Compile a deterministic evidence packet against an estimated token budget; report when required evidence cannot fit.
- **Provider-neutral handoff:** Resume from the same project events and memory through another agent or provider.
- **MCP integration:** Serve project context, memory, and source evidence over stdio, with tools for explicit recording and promotion.
- **Portable encrypted exports:** Export checksummed project archives, optionally encrypted with AES-256-GCM; imports validate evidence and rebuild derived indexes.

## Installation

Install with Node.js 22 or newer on a local filesystem suitable for SQLite WAL:

```sh
npm install -g graphit-cmp
graphit --version
```

CI verifies Node 22 on Windows, Ubuntu/Linux, and macOS. Other Node versions permitted by the package engine have not received the same platform verification.

## Quick Start

Run these commands in a repository:

```sh
graphit init --name "My project"
graphit index .
graphit code stats
graphit retrieve "where is login handled?" --json
graphit context "explain this project" --tokens 1500
graphit handoff
graphit doctor --json
```

Indexing runs when you request it; run `graphit index .` again after edits. A handoff is empty until you explicitly add durable memory. See [Getting started](https://github.com/1221smolkiddo/graphit/blob/main/docs/GETTING_STARTED.md) and the [CLI reference](https://github.com/1221smolkiddo/graphit/blob/main/docs/CLI.md).

## MCP integration and configuration

Run `graphit mcp config --json` in an initialized project to print a client configuration. For a stdio MCP host that accepts `mcpServers`:

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

The server exposes 13 tools and three resources. `graphit_record_event` records validated evidence; `graphit_add_memory` promotes it; `graphit_handoff` returns current memory with provenance. Hosts that cannot find the global command can use the installed package's absolute Node entrypoint. See [MCP setup](https://github.com/1221smolkiddo/graphit/blob/main/docs/MCP.md). The MCP host's model-provider data handling is separate from Graphit.

## How Graphit works

Graphit appends validated events and source blobs to a local SQLite database in `.graphit/`. Project sequences and writes are transactional; SQLite uses WAL. Memory, code, and search indexes are derived views that can be rebuilt from preserved evidence. Code indexing records source bytes and symbol relationships; retrieval ranks candidates; the context compiler packs a canonical packet for the requested budget. Handoff reads durable memory and its provenance.

The token estimator uses `ceil(UTF-8 bytes / 4)`, not a provider tokenizer or a guarantee about billed tokens. See [Architecture](https://github.com/1221smolkiddo/graphit/blob/main/docs/ARCHITECTURE.md), [Memory](https://github.com/1221smolkiddo/graphit/blob/main/docs/MEMORY.md), and [Retrieval](https://github.com/1221smolkiddo/graphit/blob/main/docs/RETRIEVAL.md).

## Benchmarks

In the [recorded retrieval fixture](https://github.com/1221smolkiddo/graphit/blob/main/benchmarks/p3-benchmark-results.json), the median 2,000-token-budget run selected **1,960 estimated tokens** from **27,660 candidate tokens** (a **92.91% reduction**) and retained **6/6 required evidence items**. The fixture uses synthetic distractors; this measures context selection, not model-answer quality or universal savings.

In a separate [1,000-file synthetic indexing run](https://github.com/1221smolkiddo/graphit/blob/main/benchmarks/release-performance.json) on Windows x64 / Node 22.17, unchanged indexing went from **19.32s to 8.84s** (54.2% faster). Initial and one-file indexing were slower in that instrumented comparison. These are single local runs, not cross-platform latency guarantees.

## Privacy and security

Graphit does not send product telemetry by default or automatically scrape private agent chats. It records data explicitly supplied through Graphit and source files you choose to index. `.graphit/` can contain proprietary source, absolute paths, and recorded commands or conversations; keep it out of version control and protect it with filesystem permissions.

The live SQLite database, including WAL/SHM files, is **not encrypted at rest**. `graphit export snapshot.graphit --encrypt` creates an authenticated encrypted archive; the default export is plaintext. Import into a clean directory with `graphit import snapshot.graphit`. Hashes detect corruption but do not protect against an attacker who can replace and re-sign local data. See [Data preservation](https://github.com/1221smolkiddo/graphit/blob/main/docs/DATA_PRESERVATION.md) and [Portability](https://github.com/1221smolkiddo/graphit/blob/main/docs/PORTABILITY.md).

## Documentation

- [Getting started](https://github.com/1221smolkiddo/graphit/blob/main/docs/GETTING_STARTED.md), [CLI reference](https://github.com/1221smolkiddo/graphit/blob/main/docs/CLI.md), and [MCP setup](https://github.com/1221smolkiddo/graphit/blob/main/docs/MCP.md)
- [Architecture](https://github.com/1221smolkiddo/graphit/blob/main/docs/ARCHITECTURE.md), [Project memory](https://github.com/1221smolkiddo/graphit/blob/main/docs/MEMORY.md), and [Retrieval](https://github.com/1221smolkiddo/graphit/blob/main/docs/RETRIEVAL.md)
- [Portability](https://github.com/1221smolkiddo/graphit/blob/main/docs/PORTABILITY.md), [Data preservation](https://github.com/1221smolkiddo/graphit/blob/main/docs/DATA_PRESERVATION.md), and [Benchmarks](https://github.com/1221smolkiddo/graphit/tree/main/benchmarks)

## Contributing

Open an [issue](https://github.com/1221smolkiddo/graphit/issues) to discuss bugs or changes. From a source checkout, run `npm ci`, then `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` before proposing a change. The [release checklist](https://github.com/1221smolkiddo/graphit/blob/main/docs/RELEASE.md) describes package verification.

## License

MIT. See [LICENSE](https://github.com/1221smolkiddo/graphit/blob/main/LICENSE).
