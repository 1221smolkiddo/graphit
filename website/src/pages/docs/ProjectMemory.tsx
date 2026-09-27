import React from 'react';
import { DocsLayout } from '../../components/DocsLayout';
import { CommandBlock } from '../../components/CommandBlock';

export const ProjectMemory: React.FC = () => {
  return (
    <DocsLayout
      title="Project Memory System"
      description="How Graphit persists architectural decisions, constraints, goals, and tasks across agent sessions without losing historical context."
      currentSection="Core Concepts"
    >
      <h2>The Problem with LLM Memory</h2>
      <p>
        Most AI agent memory systems operate either by compressing earlier chat turns into lossy summaries or by storing flat key-value facts in an unversioned vector database. When requirements change or architecture evolves, earlier facts are either overwritten or left to contradict newer decisions.
      </p>

      <h2>Temporal, Verifiable Memory</h2>
      <p>
        Graphit treats project memory as an append-only sequence of evidenced facts. Memory records are never deleted; instead, they evolve through <strong>superseding</strong> and <strong>resolution</strong>.
      </p>

      <h3>Example: Evolving Architecture Decisions</h3>
      <div
        style={{
          background: '#0d0d10',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '1.25rem',
          margin: '1.5rem 0',
        }}
      >
        <div style={{ marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Session 1 (Day 1):</span>
          <div style={{ color: 'var(--accent-cyan)', fontWeight: 600, marginTop: '0.2rem' }}>
            Decision A: "Use Neo4j for code graph storage."
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.35rem 0 0 0' }}>
            Agent creates memory item <code>mem:01a4...</code> citing source event <code>evt:12...</code>.
          </p>
        </div>

        <div style={{ borderTop: '1px dashed var(--border-subtle)', paddingTop: '1rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Session 4 (Day 15):</span>
          <div style={{ color: '#34d399', fontWeight: 600, marginTop: '0.2rem' }}>
            Decision B: "Use embedded SQLite to eliminate cloud database dependencies."
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.35rem 0 0 0' }}>
            Rather than deleting Decision A, Graphit records Decision B and explicitly marks Decision A as <strong>superseded</strong> by Decision B.
          </p>
        </div>
      </div>

      <p>
        When an AI agent queries <em>"why are we using SQLite?"</em> or <em>"what was our previous graph database?"</em>, Graphit retrieves both Decision B (active) and Decision A (superseded), allowing the agent to understand <strong>why</strong> the change was made without getting confused about the current directive.
      </p>

      <h2>Supported Entity Types</h2>
      <ul>
        <li><strong><code>goal</code>:</strong> Overarching project or feature goals.</li>
        <li><strong><code>task</code>:</strong> Specific actionable tasks assigned to agents or engineers.</li>
        <li><strong><code>decision</code>:</strong> Architectural, design, or algorithmic choices.</li>
        <li><strong><code>constraint</code>:</strong> Non-negotiable project guardrails (e.g. bundle size limits, prohibited libraries).</li>
        <li><strong><code>blocker</code>:</strong> Unresolved issues obstructing progress.</li>
        <li><strong><code>question</code>:</strong> Open architectural inquiries awaiting clarification.</li>
        <li><strong><code>action</code>:</strong> Executed work steps with recorded provenance.</li>
        <li><strong><code>result</code>:</strong> Verified benchmark measurements or test outputs.</li>
        <li><strong><code>artifact</code>:</strong> Tangible assets produced during sessions (schemas, docs, exports).</li>
      </ul>

      <h2>Memory CLI Commands</h2>
      <CommandBlock
        command='graphit memory add --type decision --content "Use SQLite FTS5 for search" --source-event evt:01a...'
        title="Promote explicit memory"
      />
      <CommandBlock
        command='graphit memory supersede mem:prev --content "Switched to SQLite FTS5" --source-event evt:02b...'
        title="Supersede prior decision"
      />
      <CommandBlock
        command="graphit memory resolve mem:task01 --source-event evt:03c..."
        title="Resolve completed task"
      />
      <CommandBlock
        command="graphit memory link mem:dec01 --symbol sym:authHandler"
        title="Link memory node to code symbol"
      />
    </DocsLayout>
  );
};
