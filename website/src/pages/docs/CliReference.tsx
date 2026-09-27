import React from 'react';
import { DocsLayout } from '../../components/DocsLayout';
import { CommandBlock } from '../../components/CommandBlock';

export const CliReference: React.FC = () => {
  return (
    <DocsLayout
      title="CLI Reference"
      description="Complete command-line reference for Graphit. Covers project management, memory operations, code exploration, retrieval modes, and portability."
      currentSection="Reference"
    >
      <h2>General Flags & Exit Codes</h2>
      <p>
        Commands discover <code>.graphit/graphit.db</code> by traversing up from the current working directory. All commands support <code>--help</code> and <code>--version</code>.
      </p>
      <ul>
        <li><code>--json</code>: Output structured JSON instead of human-readable text.</li>
        <li><strong>Exit Code 0:</strong> Success.</li>
        <li><strong>Exit Code 1:</strong> Error (diagnostic messages sent to <code>stderr</code>).</li>
        <li><strong>Exit Code 2:</strong> Insufficient context budget (when mandatory evidence exceeds requested tokens).</li>
      </ul>

      {/* ------------------------------------------- */}
      <h2>Project Management</h2>

      <h3><code>graphit init</code></h3>
      <p>Initialize a local project and set up the local SQLite database.</p>
      <CommandBlock command='graphit init [--name <name>]' />

      <h3><code>graphit status</code></h3>
      <p>Replay and display current project, active session, and latest checkpoint state.</p>
      <CommandBlock command="graphit status [--json]" />

      <h3><code>graphit doctor</code></h3>
      <p>Perform read-only integrity checks on database schema, WAL state, and projection alignment.</p>
      <CommandBlock command="graphit doctor [--json]" />

      <h3><code>graphit repair</code></h3>
      <p>Transactionally rebuild all derived projections from canonical events and SHA-256 source blobs. Never modifies canonical history.</p>
      <CommandBlock command="graphit repair [--json]" />

      {/* ------------------------------------------- */}
      <h2>Project Memory</h2>

      <h3><code>graphit session start</code></h3>
      <p>Append a provider-neutral session record with optional client attribution.</p>
      <CommandBlock command='graphit session start [--provider <name>] [--agent <name>] [--model <name>]' />

      <h3><code>graphit checkpoint</code></h3>
      <p>Append a named checkpoint capturing current project progress.</p>
      <CommandBlock command='graphit checkpoint [--name <name>]' />

      <h3><code>graphit resume</code></h3>
      <p>Validate an existing checkpoint and start a new session. Never rewinds canonical history.</p>
      <CommandBlock command="graphit resume [--checkpoint <id>]" />

      <h3><code>graphit handoff</code></h3>
      <p>Generate a canonical durable memory packet with complete provenance for continuation by another agent.</p>
      <CommandBlock command="graphit handoff" />

      <h3><code>graphit memory add</code></h3>
      <p>Promote an explicit durable memory item (goal, decision, constraint, blocker, task).</p>
      <CommandBlock command='graphit memory add --type <type> --content "<text>" --source-event <id>' />

      <h3><code>graphit memory list</code></h3>
      <p>List active and superseded derived memory items.</p>
      <CommandBlock command="graphit memory list [--type <type>] [--status <status>]" />

      <h3><code>graphit memory supersede</code></h3>
      <p>Supersede a prior decision or memory item with a newer one, preserving historical provenance.</p>
      <CommandBlock command='graphit memory supersede <id> --content "<text>" --source-event <id>' />

      <h3><code>graphit memory resolve</code></h3>
      <p>Mark a task or blocker as resolved without removing it from history.</p>
      <CommandBlock command="graphit memory resolve <id> [--source-event <id>]" />

      <h3><code>graphit memory link</code></h3>
      <p>Explicitly associate a memory item with a code symbol ID.</p>
      <CommandBlock command="graphit memory link <memory-id> --symbol <symbol-id>" />

      {/* ------------------------------------------- */}
      <h2>Code Intelligence</h2>

      <h3><code>graphit index</code></h3>
      <p>Incrementally index source code using Tree-sitter WASM parsers.</p>
      <CommandBlock command="graphit index [path] [--rebuild]" />

      <h3><code>graphit code stats</code></h3>
      <p>Output file, symbol, relationship edge, and latest indexing run statistics.</p>
      <CommandBlock command="graphit code stats" />

      <h3><code>graphit code symbol</code></h3>
      <p>Inspect symbol metadata, signature, and qualified name.</p>
      <CommandBlock command="graphit code symbol <name-or-id>" />

      <h3><code>graphit code callers</code></h3>
      <p>List all incoming <code>CALLS</code> edges directed at the specified symbol.</p>
      <CommandBlock command="graphit code callers <name-or-id>" />

      <h3><code>graphit code callees</code></h3>
      <p>List all outgoing <code>CALLS</code> edges made by the specified symbol.</p>
      <CommandBlock command="graphit code callees <name-or-id>" />

      <h3><code>graphit code imports</code></h3>
      <p>List all indexed module imports for a given file.</p>
      <CommandBlock command="graphit code imports <file-path>" />

      <h3><code>graphit code source</code></h3>
      <p>Retrieve exact immutable source bytes for a specific symbol or version ID.</p>
      <CommandBlock command="graphit code source <symbol-or-version-id>" />

      {/* ------------------------------------------- */}
      <h2>Retrieval & Context</h2>

      <h3><code>graphit retrieve</code></h3>
      <p>Return ranked candidates, graph paths, and diagnostic scores without packing.</p>
      <CommandBlock command='graphit retrieve "<query>" [--limit <n>] [--mode <mode>]' />

      <h3><code>graphit context</code></h3>
      <p>Compile a token-budgeted context packet ready for LLM consumption.</p>
      <CommandBlock command='graphit context "<query>" [--tokens <n>] [--mode <mode>] [--file <path>] [--symbol <id>]' />

      <h3>Supported Modes</h3>
      <ul>
        <li><code>auto</code> (default): Balances code symbols, memory items, and relationship paths based on query intent.</li>
        <li><code>code</code>: Prioritizes symbols, class definitions, function bodies, and call edges.</li>
        <li><code>memory</code>: Prioritizes goals, decisions, constraints, tasks, and historical session checkpoints.</li>
        <li><code>impact</code>: Explores caller and dependency radii around query symbols to assess ripple effects.</li>
        <li><code>continue</code>: Gathers state required to continue ongoing tasks from previous agent sessions.</li>
      </ul>

      {/* ------------------------------------------- */}
      <h2>Portability & Archives</h2>

      <h3><code>graphit export</code></h3>
      <p>Create a standalone portable <code>.graphit</code> bundle containing canonical events and source blobs.</p>
      <CommandBlock command="graphit export project.graphit" />

      <h3>Encrypted Export (P6C)</h3>
      <p>Create an authenticated encrypted bundle using AES-256-GCM and scrypt:</p>
      <CommandBlock command="graphit export secure.graphit --encrypt" />

      <h3><code>graphit import</code></h3>
      <p>Validate and import a <code>.graphit</code> bundle into a clean directory, rebuilding derived state.</p>
      <CommandBlock command="graphit import project.graphit [--passphrase-env <name>]" />

      {/* ------------------------------------------- */}
      <h2>Model Context Protocol (MCP)</h2>

      <h3><code>graphit mcp</code></h3>
      <p>Start the Model Context Protocol stdio server.</p>
      <CommandBlock command="graphit mcp [--project <path-or-id>]" />

      <h3><code>graphit mcp doctor</code></h3>
      <p>Run a read-only readiness check verifying MCP tools and database state.</p>
      <CommandBlock command="graphit mcp doctor [--project <path-or-id>]" />

      <h3><code>graphit mcp config</code></h3>
      <p>Print client configuration snippets for Cursor and Claude Desktop.</p>
      <CommandBlock command="graphit mcp config [--json]" />
    </DocsLayout>
  );
};
