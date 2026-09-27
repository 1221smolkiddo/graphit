# Getting started

Use Node.js 22.0.0 or newer on a local disk. CI verification covers Node 22.x on Windows, Ubuntu/Linux, and macOS. Install the package globally via npm:

```sh
npm install -g graphit-cmp
graphit --version
graphit doctor
```

In a repository:

```sh
graphit init --name "My project"
graphit index .
graphit context "explain this project" --tokens 1500
graphit handoff
graphit mcp config --json
```

Initialization creates `.graphit/graphit.db`. Add `.graphit/` and exported private archives to your ignore rules. Indexing is explicit; rerun it after editing code. Retrieval never secretly reindexes a working tree. Supported languages: TypeScript/TSX, JavaScript/JSX and Python.

An empty handoff means no durable memory has been promoted yet. Record evidence and explicitly promote memory through the MCP tools; see [memory](MEMORY.md). A context exit code of 2 means the requested budget was insufficient, not a successful complete packet.

From a source checkout, use `npm ci && npm run build` and `node packages/cli/dist/index.js`. The public tarball needs no source checkout. Run `graphit doctor --json` to diagnose state without changing it.
