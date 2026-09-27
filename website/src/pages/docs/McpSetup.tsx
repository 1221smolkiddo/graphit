import React from 'react';
import { DocsLayout } from '../../components/DocsLayout';
import { CommandBlock } from '../../components/CommandBlock';
import { AlertTriangle } from 'lucide-react';

export const McpSetup: React.FC = () => {
  return (
    <DocsLayout
      title="Model Context Protocol (MCP) Setup"
      description="Connect AI coding assistants directly to Graphit's local code intelligence and persistent project memory over stdio."
      currentSection="Integration"
    >
      <h2>Overview</h2>
      <p>
        Graphit implements a standard <strong>Model Context Protocol (MCP)</strong> server running over <code>stdio</code>. By connecting your AI coding agent (such as Claude Desktop, Cursor, or custom MCP clients), the agent can query symbol definitions, follow call graphs, inspect decisions, record checkpoints, and retrieve budgeted context on demand.
      </p>

      <CommandBlock command="graphit mcp" title="Launch stdio MCP server" />

      {/* Privacy Notice */}
      <div
        style={{
          margin: '1.5rem 0',
          padding: '1.25rem',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(239, 68, 68, 0.05)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          color: '#fca5a5',
          fontSize: '0.9rem',
          display: 'flex',
          gap: '0.85rem',
        }}
      >
        <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <strong style={{ color: '#f87171' }}>Privacy Boundary & Access Limits: </strong>
          Connecting Graphit over MCP does <strong>NOT</strong> grant Graphit access to the entire private conversation transcript of the host AI client. Graphit only receives data explicitly sent through its exposed tools and resources. Graphit makes no outbound network calls and runs completely locally.
        </div>
      </div>

      <h2>Client Configuration Examples</h2>
      <p>
        To generate a ready-to-copy client configuration tailored to your active repository, run:
      </p>
      <CommandBlock command="graphit mcp config --json" />

      <h3>Cursor Configuration</h3>
      <p>
        Add the following entry to your project's <code>.cursor/mcp.json</code> or your global Cursor MCP settings:
      </p>
      <pre
        style={{
          background: '#0d0d10',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem',
          overflowX: 'auto',
          fontSize: '0.85rem',
          color: '#e4e4e7',
          marginBottom: '1.5rem',
        }}
      >
{`{
  "mcpServers": {
    "graphit": {
      "command": "graphit",
      "args": ["mcp", "--project", "/absolute/path/to/your/project"]
    }
  }
}`}
      </pre>

      <h3>Claude Desktop Configuration</h3>
      <p>
        Add this block to <code>claude_desktop_config.json</code>:
      </p>
      <pre
        style={{
          background: '#0d0d10',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem',
          overflowX: 'auto',
          fontSize: '0.85rem',
          color: '#e4e4e7',
          marginBottom: '1.5rem',
        }}
      >
{`{
  "mcpServers": {
    "graphit": {
      "command": "graphit",
      "args": ["mcp", "--project", "/absolute/path/to/your/project"]
    }
  }
}`}
      </pre>

      <div
        style={{
          background: 'rgba(56, 189, 248, 0.05)',
          border: '1px solid rgba(56, 189, 248, 0.2)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem',
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
          margin: '1.5rem 0',
        }}
      >
        <strong style={{ color: 'var(--accent-cyan)' }}>Windows Tip:</strong> If your GUI host cannot resolve the global <code>graphit</code> binary path, specify the absolute path to your global Node installation and Graphit entrypoint: <code>["&lt;installed-package&gt;/dist/cli/index.js", "mcp", "--project", "&lt;path&gt;"]</code>. Run <code>npm root -g</code> to locate your global npm directory.
      </div>

      <h2>Available MCP Tools</h2>
      <p>
        Graphit exposes 13 strictly typed, validated tools for AI coding agents:
      </p>

      <div style={{ overflowX: 'auto', margin: '1.5rem 0' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.85rem',
          }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '0.75rem' }}>Tool Name</th>
              <th style={{ padding: '0.75rem' }}>Purpose & Inputs</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_status</td>
              <td style={{ padding: '0.75rem' }}>Replay current project, session, and latest checkpoint state.</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_handoff</td>
              <td style={{ padding: '0.75rem' }}>Retrieve durable memory, active tasks, decisions, and evidence provenance.</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_context</td>
              <td style={{ padding: '0.75rem' }}>Compile a token-budgeted packet (<code>query</code>, optional <code>token_budget</code>, <code>mode</code>).</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_retrieve</td>
              <td style={{ padding: '0.75rem' }}>Retrieve ranked candidate evidence nodes, graph paths, and diagnostic scores.</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_find_symbol</td>
              <td style={{ padding: '0.75rem' }}>Search for symbols by exact name, qualified name, or symbol ID.</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_get_source</td>
              <td style={{ padding: '0.75rem' }}>Retrieve immutable SHA-256 source code bytes for a given symbol version ID.</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_callers</td>
              <td style={{ padding: '0.75rem' }}>Inspect incoming <code>CALLS</code> edges directed at a symbol.</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_callees</td>
              <td style={{ padding: '0.75rem' }}>Inspect outgoing <code>CALLS</code> edges originating from a symbol.</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_impact</td>
              <td style={{ padding: '0.75rem' }}>Analyze the blast radius and affected dependencies around a symbol.</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_checkpoint</td>
              <td style={{ padding: '0.75rem' }}>Append a named checkpoint of work done in the current session.</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_record_event</td>
              <td style={{ padding: '0.75rem' }}>Append raw validated event records (e.g. test results, commands executed).</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_add_memory</td>
              <td style={{ padding: '0.75rem' }}>Promote verified items to durable project memory (goals, decisions, blockers).</td>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>graphit_link_memory</td>
              <td style={{ padding: '0.75rem' }}>Create explicit relationships between memory items and code symbols.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Exposed MCP Resources</h2>
      <p>
        Clients can read high-level project status and memory states directly via MCP resources without executing tool calls:
      </p>
      <ul>
        <li><code>graphit://project/status</code>: Read current project configuration and session status.</li>
        <li><code>graphit://project/handoff</code>: Read canonical handoff packet for session continuation.</li>
        <li><code>graphit://memory/current</code>: Read active durable memory items (goals, decisions, tasks).</li>
      </ul>
    </DocsLayout>
  );
};
