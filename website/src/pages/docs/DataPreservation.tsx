import React from 'react';
import { DocsLayout } from '../../components/DocsLayout';
import { CommandBlock } from '../../components/CommandBlock';
import { ShieldCheck, RefreshCw, Database } from 'lucide-react';

export const DataPreservation: React.FC = () => {
  return (
    <DocsLayout
      title="Data Preservation & Integrity"
      description="How Graphit ensures that canonical repository history and source code snapshots remain immutable, recoverable, and tamper-resistant."
      currentSection="Preservation"
    >
      <h2>Never Replace Truth with Summaries</h2>
      <p>
        A foundational failure mode of AI coding systems is replacing actual source code with generated summaries. Over several agent interactions, summaries hallucinate details, drop subtle edge cases, and omit type contracts.
      </p>
      <p>
        <strong>Graphit's core commitment:</strong> Canonical source code is never replaced by LLM summaries. When an agent requests context, Graphit provides the exact source code lines extracted from verified, content-addressed blobs.
      </p>

      <h2>Immutable Content-Addressed Blobs</h2>
      <p>
        Whenever source files are indexed, Graphit stores their exact bytes in content-addressed storage indexed by SHA-256:
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1.25rem',
          margin: '1.5rem 0',
        }}
      >
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-cyan)', fontWeight: 600, marginBottom: '0.5rem' }}>
            <Database size={18} />
            <span>SHA-256 Content Hash</span>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Every file revision is addressed by the cryptographic hash of its exact bytes. Collisions and unauthorized mutations are computationally infeasible.
          </p>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-emerald)', fontWeight: 600, marginBottom: '0.5rem' }}>
            <ShieldCheck size={18} />
            <span>SQLite Trigger Enforced</span>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Database triggers explicitly reject <code>UPDATE</code>, <code>DELETE</code>, or replacing <code>INSERT</code> operations on events and source blobs.
          </p>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-indigo)', fontWeight: 600, marginBottom: '0.5rem' }}>
            <RefreshCw size={18} />
            <span>Transactional Repair</span>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            If derived indexes or search tables are damaged, <code>graphit repair</code> rebuilds all projections from the canonical blobs in one atomic transaction.
          </p>
        </div>
      </div>

      <h2>Temporal Decisions: Preserved, Never Deleted</h2>
      <p>
        When architecture shifts during project development, earlier decisions are marked as superseded rather than purged:
      </p>
      <div
        style={{
          background: '#0d0d10',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '1.25rem',
          margin: '1.5rem 0',
        }}
      >
        <p style={{ margin: 0, fontSize: '0.9rem' }}>
          <strong>Historical Progression:</strong>
        </p>
        <ul style={{ margin: '0.75rem 0 0 1.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <li>
            <span style={{ color: 'var(--text-muted)' }}>Initial:</span> <code>Decision A: Use Neo4j</code> — Recorded as canonical event <code>evt_01</code>.
          </li>
          <li>
            <span style={{ color: 'var(--text-muted)' }}>Evolution:</span> <code>Decision B: Use SQLite</code> — Recorded as canonical event <code>evt_02</code>.
          </li>
          <li>
            <span style={{ color: 'var(--accent-cyan)' }}>Graphit State:</span> Decision A is marked as <strong>superseded by Decision B</strong>. Both decisions remain permanently queryable with full provenance.
          </li>
        </ul>
      </div>

      <h2>Disaster Recovery Workflow</h2>
      <p>
        Graphit includes built-in diagnostics to detect and repair derived-state inconsistencies without risking canonical data:
      </p>
      <CommandBlock command="graphit doctor --json" title="Check database integrity" />
      <CommandBlock command="graphit repair --json" title="Rebuild derived projections safely" />
    </DocsLayout>
  );
};
