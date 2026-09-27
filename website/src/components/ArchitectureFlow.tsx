import React from 'react';
import { ArrowDown, Database, Cpu, Search, Sliders, Binary, Share2, Layers } from 'lucide-react';
import { siteConfig } from '../config/siteConfig';

interface FlowStepProps {
  number: string;
  category: string;
  categoryColor: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  items: string[];
}

const FlowStep: React.FC<FlowStepProps> = ({
  number,
  category,
  categoryColor,
  icon,
  title,
  description,
  items,
}) => (
  <div
    style={{
      background: 'rgba(18, 18, 21, 0.8)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: '1.25rem 1.5rem',
      position: 'relative',
      transition: 'border-color 0.2s ease',
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
        <div
          style={{
            color: categoryColor,
            background: 'rgba(255, 255, 255, 0.04)',
            padding: '0.35rem',
            borderRadius: '6px',
          }}
        >
          {icon}
        </div>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: categoryColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {category}
        </span>
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {number}
      </span>
    </div>

    <h4 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
      {title}
    </h4>
    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
      {description}
    </p>

    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
      {items.map((item, idx) => (
        <span
          key={idx}
          style={{
            fontSize: '0.75rem',
            fontFamily: 'var(--font-mono)',
            padding: '0.15rem 0.5rem',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
        >
          {item}
        </span>
      ))}
    </div>
  </div>
);

export const ArchitectureFlow: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative' }}>
      {/* 1. Canonical Layer */}
      <FlowStep
        number="01"
        category="Canonical Truth (Immutable)"
        categoryColor="#38bdf8"
        icon={<Database size={18} />}
        title="Immutable Events + Source Blobs"
        description="Append-only record of all raw observations, session events, and SHA-256 hashed source file snapshots. SQLite triggers reject any destructive modification."
        items={['Immutable Events', 'SHA-256 Source Blobs', 'Session Checkpoints', 'Strict Provenance']}
      />

      <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <ArrowDown size={20} />
      </div>

      {/* 2. Derived Layer */}
      <FlowStep
        number="02"
        category="Derived Projections (Rebuildable)"
        categoryColor="#818cf8"
        icon={<Cpu size={18} />}
        title="Memory Graph + Code Knowledge Graph"
        description="Tree-sitter WASM extracts symbols, classes, functions, calls, and imports. Memory projections track goals, decisions, constraints, and blockers across sessions."
        items={['Tree-sitter AST', 'Call & Import Graph', 'Temporal Decisions', 'Resolution Chains']}
      />

      <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <ArrowDown size={20} />
      </div>

      {/* 3. Retrieval Pipeline */}
      <FlowStep
        number="03"
        category="Retrieval Engine"
        categoryColor="#34d399"
        icon={<Search size={18} />}
        title="Exact Match + SQLite FTS5 BM25"
        description="High-speed syntactic lookups and full-text keyword retrieval locate candidate evidence nodes across both code symbols and memory records."
        items={['Exact Symbol Lookup', 'FTS5 Indexing', 'BM25 Scoring', 'Candidate Gathering']}
      />

      <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <ArrowDown size={20} />
      </div>

      {/* 4. Graph Ranking */}
      <FlowStep
        number="04"
        category="Evidence Ranking"
        categoryColor="#fbbf24"
        icon={<Sliders size={18} />}
        title="RRF + Personalized PageRank + MMR"
        description="Reciprocal Rank Fusion merges multi-modal scores. Bounded Personalized PageRank diffuses relevance along evidenced call/memory edges, and MMR eliminates redundancy."
        items={['Reciprocal Rank Fusion', 'Personalized PageRank', 'Deterministic MMR', 'Redundancy Control']}
      />

      <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <ArrowDown size={20} />
      </div>

      {/* 5. Context Compiler */}
      <FlowStep
        number="05"
        category="Context Synthesis"
        categoryColor="#f87171"
        icon={<Binary size={18} />}
        title="Token-Aware Context Compiler"
        description="Estimates token overhead using UTF-8 byte models and strictly packs evidence to fit the agent's token budget without dropping critical provenance."
        items={['ceil(UTF-8 bytes / 4)', 'Strict Token Budgeting', 'Provenance Tracking', 'Budget Insufficiency Flags']}
      />

      <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <ArrowDown size={20} />
      </div>

      {/* 6. Interoperability */}
      <FlowStep
        number="06"
        category="Interoperability"
        categoryColor="#38bdf8"
        icon={<Share2 size={18} />}
        title="MCP / Provider-Neutral Handoff / .graphit Export"
        description="Serve evidence over stdio to Claude, Codex, Cursor, or export self-contained authenticated encrypted archives for team transfer."
        items={['Model Context Protocol', 'Cross-Provider Handoff', 'Encrypted .graphit Archives', 'Zero Vendor Lock-in']}
      />

      {/* Highlight Box */}
      <div
        style={{
          marginTop: '1.5rem',
          padding: '1.25rem 1.5rem',
          background: 'rgba(56, 189, 248, 0.05)',
          border: '1px solid rgba(56, 189, 248, 0.2)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}
      >
        <div style={{ color: 'var(--accent-cyan)' }}>
          <Layers size={24} />
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
            {siteConfig.corePrinciple}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Graphit never replaces project truth with generated summaries. Canonical data remains preserved. Memory, indexes and context packets are derived and completely rebuildable.
          </div>
        </div>
      </div>
    </div>
  );
};
