import React from 'react';
import { Link } from 'react-router-dom';
import { DocsLayout } from '../../components/DocsLayout';
import { Terminal, Share2, Cpu, Database, HardDrive, Shield, Activity, ArrowRight } from 'lucide-react';
import { siteConfig } from '../../config/siteConfig';

export const DocsOverview: React.FC = () => {
  const docCards = [
    {
      title: 'Getting Started',
      href: '/docs/getting-started',
      icon: <Terminal size={20} color="#38bdf8" />,
      description: 'Step-by-step walkthrough to install Graphit, initialize a repository, index code symbols, and generate your first context packet.',
    },
    {
      title: 'CLI Reference',
      href: '/docs/cli',
      icon: <Terminal size={20} color="#818cf8" />,
      description: 'Comprehensive manual of all command groups: PROJECT, MEMORY, CODE, RETRIEVAL, PORTABILITY, and MCP.',
    },
    {
      title: 'MCP Setup',
      href: '/docs/mcp',
      icon: <Share2 size={20} color="#34d399" />,
      description: 'Configure Graphit as a Model Context Protocol stdio server for Claude Desktop, Cursor, and any MCP-compatible client.',
    },
    {
      title: 'Architecture',
      href: '/docs/architecture',
      icon: <Cpu size={20} color="#fbbf24" />,
      description: 'The six architectural layers of Graphit: canonical truth, derived memory, code graph, retrieval, context compiler, and interoperability.',
    },
    {
      title: 'Project Memory',
      href: '/docs/memory',
      icon: <Database size={20} color="#f87171" />,
      description: 'Durable tracking of goals, tasks, decisions, constraints, and blockers with temporal superseding rather than lossy deletion.',
    },
    {
      title: 'Retrieval & Compiler',
      href: '/docs/retrieval',
      icon: <Activity size={20} color="#38bdf8" />,
      description: 'Hybrid search pipeline combining exact matches, SQLite FTS5 BM25, Reciprocal Rank Fusion, Personalized PageRank, and MMR.',
    },
    {
      title: '.graphit Portability',
      href: '/docs/portability',
      icon: <HardDrive size={20} color="#a78bfa" />,
      description: 'Export and import portable repository bundles with authenticated AES-256-GCM encryption and integrity verification.',
    },
    {
      title: 'Data Preservation',
      href: '/docs/data-preservation',
      icon: <Shield size={20} color="#34d399" />,
      description: 'Local-first security model, append-only SQLite triggers, immutable SHA-256 source blobs, and crash recovery.',
    },
  ];

  return (
    <DocsLayout
      title="Documentation Overview"
      description="Welcome to the Graphit documentation. Graphit provides persistent project intelligence and verifiable memory for AI coding agents."
      currentSection="Overview"
    >
      <h2>Core Thesis</h2>
      <blockquote
        style={{
          borderLeft: '3px solid var(--accent-cyan)',
          paddingLeft: '1.25rem',
          margin: '1.5rem 0',
          fontStyle: 'italic',
          color: 'var(--text-primary)',
          fontSize: '1.1rem',
        }}
      >
        "Don't compress the truth. Compress access to the truth."
      </blockquote>

      <p>
        AI coding agents often struggle with context boundaries. The prevailing solutions either feed massive raw dumps into long context windows (which degrades reasoning and increases costs) or rely on lossy generative summaries (which hallucinate, drift, and destroy precision).
      </p>

      <p>
        <strong>Graphit takes a different approach:</strong>
      </p>
      <ul>
        <li><strong>Canonical truth is preserved:</strong> Source files are stored in immutable SHA-256 content-addressed blobs, and session activity is preserved as append-only events.</li>
        <li><strong>Graph state is derived:</strong> Tree-sitter WASM code extraction and project memory are projections that can be deleted and deterministically rebuilt with <code>graphit repair</code>.</li>
        <li><strong>Context packets are disposable:</strong> Budgeted context is compiled dynamically on-demand for specific agent prompts using multi-stage ranking (BM25 + PPR + MMR).</li>
      </ul>

      <h2>Explore Documentation</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.25rem',
          marginTop: '1.5rem',
        }}
      >
        {docCards.map((card, idx) => (
          <Link
            key={idx}
            to={card.href}
            className="card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              textDecoration: 'none',
              padding: '1.25rem',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.65rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '0.35rem', borderRadius: '6px' }}>
                  {card.icon}
                </div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  {card.title}
                </h3>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                {card.description}
              </p>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.8rem',
                color: 'var(--accent-cyan)',
                fontWeight: 500,
                marginTop: '1rem',
              }}
            >
              <span>Read guide</span>
              <ArrowRight size={13} />
            </div>
          </Link>
        ))}
      </div>

      <h2>Quick Facts</h2>
      <ul>
        <li><strong>Package name:</strong> <code>{siteConfig.packageName}</code></li>
        <li><strong>Latest version:</strong> <code>v{siteConfig.version}</code></li>
        <li><strong>License:</strong> {siteConfig.license} (Open Source)</li>
        <li><strong>Supported platforms:</strong> {siteConfig.platforms.ci.join(', ')}</li>
        <li><strong>Runtime requirement:</strong> Node.js {siteConfig.platforms.node}</li>
        <li><strong>Code parsing support:</strong> {siteConfig.platforms.languages.join(', ')}</li>
      </ul>
    </DocsLayout>
  );
};
