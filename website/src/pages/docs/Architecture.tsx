import React from 'react';
import { DocsLayout } from '../../components/DocsLayout';
import { ArchitectureFlow } from '../../components/ArchitectureFlow';
import { siteConfig } from '../../config/siteConfig';

export const Architecture: React.FC = () => {
  return (
    <DocsLayout
      title="Architecture & Design Principles"
      description="A deep technical breakdown of the six architectural layers powering Graphit's local-first code intelligence."
      currentSection="Architecture"
    >
      <blockquote
        style={{
          borderLeft: '3px solid var(--accent-cyan)',
          paddingLeft: '1.25rem',
          margin: '1.5rem 0',
          fontStyle: 'italic',
          color: 'var(--text-primary)',
          fontSize: '1.15rem',
        }}
      >
        "{siteConfig.corePrinciple}"
      </blockquote>

      <p>
        Graphit enforces a strict separation between <strong>canonical ground truth</strong> and <strong>derived disposable state</strong>. Canonical data is cryptographically identified and append-only. If a derived index becomes corrupted or an algorithm updates, derived state can simply be dropped and recomputed with <code>graphit repair</code>.
      </p>

      <h2>The Six Architectural Layers</h2>

      {/* Layer 1 */}
      <h3>1. Canonical Truth Layer (Append-Only)</h3>
      <p>The foundation of Graphit consists of two immutable primitives:</p>
      <ul>
        <li>
          <strong>Immutable Events:</strong> An append-only sequence of observation events, session transitions, checkpoints, and manual promotions. SQLite triggers reject any <code>UPDATE</code>, <code>DELETE</code>, or replacing <code>INSERT</code> operations.
        </li>
        <li>
          <strong>Immutable Source Blobs:</strong> Raw source code files stored in content-addressed blobs keyed by SHA-256 hashes. Even if a file is deleted or refactored in git, previous states remain verifiable.
        </li>
      </ul>

      {/* Layer 2 */}
      <h3>2. Derived Memory Layer</h3>
      <p>
        Durable project memory is synthesized into queryable projection tables. It models the semantic evolution of the project:
      </p>
      <ul>
        <li><strong>Goals & Tasks:</strong> High-level objectives and granular work units.</li>
        <li><strong>Decisions:</strong> Architectural choices (e.g. "Use SQLite for storage"). When superseded by newer decisions, the historical record remains preserved.</li>
        <li><strong>Constraints:</strong> Guardrails and rules (e.g. "Do not modify backend packages").</li>
        <li><strong>Blockers:</strong> Impediments preventing task completion, resolved explicitly via event links.</li>
        <li><strong>Questions, Actions, Results, & Artifacts:</strong> Audit trail of human and agent activities.</li>
      </ul>

      {/* Layer 3 */}
      <h3>3. Code Intelligence Layer</h3>
      <p>
        Extracts structural code relationships directly using WebAssembly Tree-sitter parsers:
      </p>
      <ul>
        <li><strong>Nodes:</strong> Files, Modules, Classes, Functions, Methods, Variables, and Interfaces.</li>
        <li><strong>Edges:</strong> <code>IMPORTS</code>, <code>EXPORTS</code>, <code>CALLS</code>, <code>REFERENCES</code>, and <code>INHERITS</code>.</li>
        <li><strong>Resolution:</strong> Explicit module-level import/export aliasing, including re-exports and namespace dereferencing up to 64 hops. Dynamic calls and ambiguous references fail closed rather than hallucinating edges.</li>
      </ul>

      {/* Layer 4 */}
      <h3>4. Retrieval Layer</h3>
      <p>
        A hybrid retrieval pipeline combining lexical, keyword, and graph diffusion algorithms:
      </p>
      <ul>
        <li><strong>Exact Symbol Matching:</strong> Instant lookup on qualified and short identifiers.</li>
        <li><strong>SQLite FTS5 BM25:</strong> High-performance full-text search across documentation, docstrings, and code comments.</li>
        <li><strong>Reciprocal Rank Fusion (RRF):</strong> Combines lexical and keyword ranks without arbitrary parameter tuning.</li>
        <li><strong>Personalized PageRank (PPR):</strong> Bounded random-walk diffusion radiating from candidate nodes along evidenced call and memory edges.</li>
        <li><strong>Maximal Marginal Relevance (MMR):</strong> Deterministic deduplication ensuring diverse evidence spans.</li>
      </ul>

      {/* Layer 5 */}
      <h3>5. Token-Aware Context Compiler</h3>
      <p>
        Assembles ranked evidence into a compact context packet conforming strictly to the requested token budget:
      </p>
      <ul>
        <li><strong>Token Estimator:</strong> Uses the provider-neutral formula <code>ceil(UTF-8 bytes / 4)</code>.</li>
        <li><strong>Budget Packing:</strong> Knapsack-style utility/cost packing including envelope formatting.</li>
        <li><strong>Budget Insufficiency Signaling:</strong> If mandatory evidence cannot fit in the requested budget, Graphit flags <code>budget_insufficient: true</code> rather than silently truncating required dependencies.</li>
      </ul>

      {/* Layer 6 */}
      <h3>6. Interoperability & Transport</h3>
      <p>
        Allows Graphit to integrate into any developer environment:
      </p>
      <ul>
        <li><strong>CLI:</strong> Human and script automation for local development.</li>
        <li><strong>MCP:</strong> Model Context Protocol stdio server for Claude, Cursor, and Codex.</li>
        <li><strong>Provider-Neutral Handoff:</strong> Complete session state handover without vendor-specific memory lock-in.</li>
        <li><strong>.graphit Portable Bundles:</strong> Plain and authenticated encrypted exports using AES-256-GCM.</li>
      </ul>

      <h2>Visual Pipeline</h2>
      <div style={{ marginTop: '2rem' }}>
        <ArchitectureFlow />
      </div>
    </DocsLayout>
  );
};
