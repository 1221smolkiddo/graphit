import React from 'react';
import { DocsLayout } from '../../components/DocsLayout';
import { CommandBlock } from '../../components/CommandBlock';
import { siteConfig } from '../../config/siteConfig';

export const GettingStarted: React.FC = () => {
  return (
    <DocsLayout
      title="Getting Started with Graphit"
      description="Learn how to install Graphit, initialize a repository, index code symbols, and generate token-budgeted context for AI agents in under 5 minutes."
      currentSection="Tutorial"
    >
      <h2>Prerequisites</h2>
      <p>
        Graphit requires <strong>Node.js {siteConfig.platforms.node}</strong>. Native SQLite bindings (via <code>better-sqlite3@12.11.1</code> ABI 127) are bundled as prebuilt binaries for Windows, macOS, and Linux. No C++ compiler or Python build tools are necessary for standard environments.
      </p>

      <h2>Step 1: Installation</h2>
      <p>
        Install the Graphit CLI globally via npm, or execute it on-demand with <code>npx</code>:
      </p>
      <CommandBlock command={siteConfig.installCommand} title="Global installation" />

      <p>Verify that the binary is available in your shell:</p>
      <CommandBlock command="graphit --version" />

      <h2>Step 2: Initialize a Repository</h2>
      <p>
        Navigate to the root directory of your codebase and initialize Graphit. This creates an isolated <code>.graphit/</code> directory containing a local SQLite database configured with Write-Ahead Logging (WAL) and integrity triggers:
      </p>
      <CommandBlock command='graphit init --name "My Project"' title="Initialize project" />

      <p>
        Graphit creates a unique machine-local project binding in <code>.graphit/project.json</code>. You can verify system health at any time:
      </p>
      <CommandBlock command="graphit status" />

      <h2>Step 3: Index Code Symbols & Relationships</h2>
      <p>
        Run the incremental indexer on your repository. Graphit uses Tree-sitter WASM parsers to extract symbols, classes, functions, calls, and imports without sending code over the network:
      </p>
      <CommandBlock command="graphit index ." title="Index current directory" />

      <p>
        On subsequent runs, Graphit uses a validated unchanged-index fast path. If files are unchanged, Graphit verifies SHA-256 source blobs and skips redundant parsing in milliseconds.
      </p>
      <p>Inspect the extracted code knowledge graph:</p>
      <CommandBlock command="graphit code stats" />

      <h2>Step 4: Compile Budgeted Context</h2>
      <p>
        When you or an AI agent need information, use <code>graphit context</code> with a query and a target token budget. Graphit runs candidate retrieval (exact + BM25), ranks candidates with Personalized PageRank along the call graph, filters redundancy via MMR, and packs the evidence:
      </p>
      <CommandBlock
        command='graphit context "explain how authentication works" --tokens 2000'
        title="Retrieve compact context packet"
      />

      <p>
        The output is a canonical JSON packet containing exact code spans, symbols, call paths, and memory nodes, along with token utilization metrics.
      </p>

      <h2>Step 5: Connect to an AI Coding Client</h2>
      <p>
        Graphit includes a native Model Context Protocol (MCP) server that operates over <code>stdio</code>. AI coding clients such as Claude Desktop or Cursor can connect directly:
      </p>
      <CommandBlock command="graphit mcp" title="Launch stdio MCP server" />

      <p>
        To output ready-to-paste client configuration for Cursor or Claude Desktop, run:
      </p>
      <CommandBlock command="graphit mcp config --json" />
    </DocsLayout>
  );
};
