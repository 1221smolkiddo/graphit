import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Github,
  Brain,
  Network,
  Minimize2,
  Share2,
  ShieldCheck,
  Terminal,
  Bot,
  AlertTriangle,
  CheckCircle2,
  HardDrive
} from 'lucide-react';
import ShapeWaves from '../components/ShapeWaves/ShapeWaves';
import { CommandBlock } from '../components/CommandBlock';
import { FeatureCard } from '../components/FeatureCard';
import { ArchitectureFlow } from '../components/ArchitectureFlow';
import { BenchmarkCard } from '../components/BenchmarkCard';
import { siteConfig } from '../config/siteConfig';

export const Home: React.FC = () => {
  useEffect(() => {
    document.title = `${siteConfig.name} — ${siteConfig.headline}`;
  }, []);

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {/* ==================================================
          SECTION 1 — HERO
          ================================================== */}
      <section
        style={{
          position: 'relative',
          paddingTop: '6rem',
          paddingBottom: '6rem',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '85vh',
        }}
      >
        {/* React Bits Shape Waves Background */}
        <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}>
          <ShapeWaves
            text="Graphit"
            fontFamily='Geist, "Geist Sans", system-ui, sans-serif'
            fontWeight={500}
            textSize={0.6}
            shapes="mixed"
            cellSize={10}
            dotSize={0.75}
            color="#929292"
            hoverColor="#ffffff"
            backgroundColor="#000000"
            speed={1}
            scale={1}
            contrast={1}
            brightness={0.4}
            flow={0}
            direction={0}
            fade={0.25}
            interactive={true}
            splashRadius={40}
            splashStrength={0.4}
            glow={0.35}
            intro={true}
            introDuration={1.6}
            paused={false}
          />
        </div>

        {/* Hero Vignette Overlay for Crisp Readability */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at 50% 35%, rgba(9, 9, 11, 0.4) 0%, rgba(9, 9, 11, 0.88) 75%, rgba(9, 9, 11, 1) 100%)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />

        {/* Hero Content */}
        <div
          className="container"
          style={{
            position: 'relative',
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            maxWidth: '850px',
          }}
        >
          {/* Logo Emblem */}
          <div
            style={{
              marginBottom: '1.25rem',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src="/logo-transparent.png"
              alt="Graphit Logo"
              style={{
                width: '80px',
                height: '80px',
                objectFit: 'contain',
                filter: 'drop-shadow(0 0 25px rgba(56, 189, 248, 0.45)) drop-shadow(0 4px 14px rgba(0, 0, 0, 0.95))',
              }}
            />
          </div>

          {/* Badge (No emojis) */}
          <div
            className="badge"
            style={{
              marginBottom: '1.5rem',
              background: 'rgba(9, 9, 11, 0.9)',
              border: '1px solid rgba(56, 189, 248, 0.5)',
              color: '#38bdf8',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.9)',
              padding: '0.35rem 0.95rem',
              fontSize: '0.8rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            <span>Local-First Code &amp; Project Memory</span>
          </div>

          {/* Title & Headline (100% visible, high-contrast) */}
          <h1
            style={{
              fontSize: 'clamp(2.75rem, 6vw, 4.5rem)',
              fontWeight: 850,
              letterSpacing: '-0.035em',
              lineHeight: 1.1,
              marginBottom: '1.25rem',
            }}
          >
            <span
              style={{
                color: '#ffffff',
                textShadow: '0 4px 25px rgba(0, 0, 0, 0.98), 0 0 50px rgba(0, 0, 0, 0.95)',
                display: 'inline-block',
              }}
            >
              {siteConfig.name}
            </span>
            <br />
            <span
              style={{
                fontSize: 'clamp(1.5rem, 3.5vw, 2.35rem)',
                fontWeight: 700,
                color: '#ffffff',
                textShadow: '0 3px 20px rgba(0, 0, 0, 0.98), 0 0 40px rgba(0, 0, 0, 0.95)',
                letterSpacing: '-0.025em',
                lineHeight: 1.25,
                display: 'inline-block',
                marginTop: '0.5rem',
              }}
            >
              Persistent project intelligence for{' '}
              <span
                style={{
                  color: '#38bdf8',
                  textShadow: '0 0 25px rgba(56, 189, 248, 0.8), 0 2px 14px rgba(0, 0, 0, 0.95)',
                  fontWeight: 800,
                }}
              >
                AI coding agents
              </span>
              .
            </span>
          </h1>

          {/* Supporting Copy (High-contrast, protective frosted backing card) */}
          <div
            style={{
              background: 'rgba(9, 9, 11, 0.82)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '16px',
              padding: '1.25rem 2rem',
              maxWidth: '750px',
              marginBottom: '2.5rem',
              boxShadow: '0 12px 35px rgba(0, 0, 0, 0.9)',
            }}
          >
            <p
              style={{
                fontSize: 'clamp(1.05rem, 1.8vw, 1.2rem)',
                lineHeight: 1.75,
                color: '#ffffff',
                fontWeight: 450,
                margin: 0,
                textShadow: '0 1px 4px rgba(0, 0, 0, 0.9)',
              }}
            >
              {siteConfig.supportingCopy}
            </p>
          </div>

          {/* CTAs */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1rem',
              justifyContent: 'center',
              marginBottom: '3rem',
            }}
          >
            <Link to="/docs/getting-started" className="btn btn-primary" style={{ padding: '0.8rem 1.75rem', fontSize: '1rem' }}>
              <span>Get Started</span>
              <ArrowRight size={16} />
            </Link>
            <a
              href={siteConfig.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{ padding: '0.8rem 1.75rem', fontSize: '1rem' }}
            >
              <Github size={18} />
              <span>View on GitHub</span>
            </a>
          </div>

          {/* Terminal Command Box */}
          <div
            style={{
              width: '100%',
              maxWidth: '680px',
              background: 'rgba(13, 13, 16, 0.95)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), var(--shadow-glow)',
              overflow: 'hidden',
              textAlign: 'left',
            }}
          >
            {/* Terminal Window Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.65rem 1rem',
                borderBottom: '1px solid var(--border-subtle)',
                background: 'rgba(24, 24, 27, 0.6)',
              }}
            >
              <div style={{ display: 'flex', gap: '6px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b' }} />
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
              </div>
              <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                bash — quick start
              </span>
              <div style={{ width: '30px' }} />
            </div>

            {/* Install & Initial Commands */}
            <div style={{ padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                # Install globally (or use npx)
              </div>
              <CommandBlock command={siteConfig.installCommand} showPrompt={true} />

              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: '0.25rem' }}>
                # Initialize, index repository, and compile budgeted context
              </div>
              <CommandBlock command="graphit init" showPrompt={true} />
              <CommandBlock command="graphit index ." showPrompt={true} />
              <CommandBlock command='graphit context "explain this project" --tokens 2000' showPrompt={true} />
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================
          SECTION 2 — CORE VALUE
          ================================================== */}
      <section style={{ padding: '5rem 0', borderTop: '1px solid var(--border-subtle)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', maxWidth: '650px', margin: '0 auto 3.5rem auto' }}>
            <span className="badge badge-muted" style={{ marginBottom: '0.75rem' }}>
              Why Graphit
            </span>
            <h2 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
              Compress access to the truth, not the truth itself.
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.6 }}>
              Most AI agent workflows dump bloated raw context or lose fidelity through aggressive lossy summarization. Graphit balances canonical truth with laser-focused retrieval.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.5rem',
            }}
          >
            <FeatureCard
              icon={<Brain size={20} />}
              title="Project Memory"
              description="Keeps goals, tasks, decisions, constraints, blockers and results across sessions without losing historical context."
              badge="Durable"
            />
            <FeatureCard
              icon={<Network size={20} />}
              title="Code Intelligence"
              description="Builds a structural graph from repository symbols, imports, calls and relationships powered by Tree-sitter WASM."
              badge="Deterministic"
            />
            <FeatureCard
              icon={<Minimize2 size={20} />}
              title="Smaller Context"
              description="Retrieves only useful evidence instead of repeatedly loading an entire repository into expensive model windows."
              badge="92.9% reduction"
            />
            <FeatureCard
              icon={<Share2 size={20} />}
              title="Cross-Provider Handoff"
              description="Move ongoing project context between MCP-compatible agents (Claude, Codex, Cursor, Gemini) without vendor lock-in."
              badge="Stdio MCP"
            />
            <FeatureCard
              icon={<ShieldCheck size={20} />}
              title="Evidence Preservation"
              description="Every important graph fact can be traced back to immutable SHA-256 source blobs or canonical event evidence."
              badge="Cryptographic"
            />
          </div>
        </div>
      </section>

      {/* ==================================================
          SECTION 3 — HOW IT WORKS
          ================================================== */}
      <section style={{ padding: '5rem 0', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', maxWidth: '650px', margin: '0 auto 3.5rem auto' }}>
            <span className="badge" style={{ marginBottom: '0.75rem' }}>
              Architecture
            </span>
            <h2 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
              How Graphit Works
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.6 }}>
              A clean separation between immutable canonical records and derived, disposable retrieval projections.
            </p>
          </div>

          <div style={{ maxWidth: '850px', margin: '0 auto' }}>
            <ArchitectureFlow />
          </div>
        </div>
      </section>

      {/* ==================================================
          SECTION 4 — BENCHMARK
          ================================================== */}
      <section style={{ padding: '5rem 0', borderTop: '1px solid var(--border-subtle)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', maxWidth: '650px', margin: '0 auto 3rem auto' }}>
            <span className="badge badge-muted" style={{ marginBottom: '0.75rem' }}>
              Measured Performance
            </span>
            <h2 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
              Real Measured Context Reduction
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.6 }}>
              Graphit extracts candidate evidence and algorithmically packs it within strict token limits while maintaining full recall of mandatory nodes.
            </p>
          </div>

          <div style={{ maxWidth: '850px', margin: '0 auto' }}>
            <BenchmarkCard showDetailedTable={true} />

            <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
              <Link
                to="/benchmarks"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.9rem',
                  color: 'var(--accent-cyan)',
                  fontWeight: 500,
                }}
              >
                <span>View full indexing stress & resolver benchmarks</span>
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================
          SECTION 5 — AGENT HANDOFF
          ================================================== */}
      <section style={{ padding: '5rem 0', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', maxWidth: '650px', margin: '0 auto 3.5rem auto' }}>
            <span className="badge" style={{ marginBottom: '0.75rem' }}>
              Interoperability
            </span>
            <h2 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
              Seamless Agent Handoff
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.6 }}>
              Switch AI models or restart developer sessions without losing the mental model of your codebase.
            </p>
          </div>

          {/* Visual Agent Flow */}
          <div
            style={{
              maxWidth: '850px',
              margin: '0 auto 3rem auto',
              background: '#0d0d10',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '2rem',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '1.5rem',
                alignItems: 'center',
                position: 'relative',
              }}
            >
              {/* Agent A */}
              <div
                style={{
                  padding: '1.25rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#c084fc', marginBottom: '0.5rem' }}>
                  <Bot size={18} />
                  <span style={{ fontWeight: 600 }}>Claude / Agent A</span>
                </div>
                <ul style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '1.2rem', lineHeight: 1.5 }}>
                  <li>Records current goal</li>
                  <li>Tracks active task</li>
                  <li>Documents decisions</li>
                  <li>Notes results & blockers</li>
                </ul>
                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Agent A exits process cleanly
                </div>
              </div>

              {/* Central Graphit Hub */}
              <div
                style={{
                  padding: '1.5rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  textAlign: 'center',
                }}
              >
                <div style={{ color: 'var(--accent-cyan)', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.4rem' }}>
                  Graphit Layer
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                  Persistent SQLite Project State (WAL)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <code style={{ fontSize: '0.75rem', color: '#38bdf8' }}>graphit_handoff</code>
                  <code style={{ fontSize: '0.75rem', color: '#818cf8' }}>graphit_context</code>
                </div>
              </div>

              {/* Agent B */}
              <div
                style={{
                  padding: '1.25rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#34d399', marginBottom: '0.5rem' }}>
                  <Bot size={18} />
                  <span style={{ fontWeight: 600 }}>Codex / Agent B</span>
                </div>
                <ul style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '1.2rem', lineHeight: 1.5 }}>
                  <li>Retrieves active handoff</li>
                  <li>Pulls budgeted context</li>
                  <li>Understands prior state</li>
                  <li>Executes next task</li>
                </ul>
                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#34d399', fontWeight: 500 }}>
                  Immediate continuation
                </div>
              </div>
            </div>

            {/* Clear Privacy & Access Disclosure */}
            <div
              style={{
                marginTop: '1.75rem',
                padding: '1rem 1.25rem',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                fontSize: '0.85rem',
                color: '#fca5a5',
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <span style={{ fontWeight: 600, color: '#f87171' }}>Privacy boundary: </span>
                Graphit does <strong>NOT</strong> automatically read or scrape private conversations from AI providers. It stores only information explicitly recorded through Graphit's CLI or MCP interfaces. Provider-specific transcript importers may be supported separately in the future.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================
          SECTION 6 — CLI QUICK START
          ================================================== */}
      <section style={{ padding: '5rem 0', borderTop: '1px solid var(--border-subtle)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', maxWidth: '650px', margin: '0 auto 3.5rem auto' }}>
            <span className="badge badge-muted" style={{ marginBottom: '0.75rem' }}>
              Developer Workflow
            </span>
            <h2 style={{ fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>
              CLI Quick Start
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.6 }}>
              A developer-friendly CLI providing instant code stats, structured retrieval, and portable backups.
            </p>
          </div>

          <div style={{ maxWidth: '780px', margin: '0 auto' }}>
            <CommandBlock
              title="1. Install Graphit globally"
              command={siteConfig.installCommand}
            />
            <CommandBlock
              title="2. Initialize in your repository"
              command='graphit init --name "My Project"'
            />
            <CommandBlock
              title="3. Index symbols and relationships"
              command="graphit index ."
            />
            <CommandBlock
              title="4. Inspect extracted code statistics"
              command="graphit code stats"
            />
            <CommandBlock
              title="5. Compile budgeted context for your prompt"
              command='graphit context "explain how authentication works" --tokens 2000'
            />
            <CommandBlock
              title="6. Print durable handoff summary"
              command="graphit handoff"
            />
            <CommandBlock
              title="7. Launch stdio MCP server for agent IDEs"
              command="graphit mcp"
            />
            <CommandBlock
              title="8. Export portable repository snapshot"
              command="graphit export project.graphit"
            />
          </div>
        </div>
      </section>

      {/* ==================================================
          SECTION 7 — PLATFORM & CI STATUS
          ================================================== */}
      <section style={{ padding: '3.5rem 0', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
        <div className="container">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '2rem',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <CheckCircle2 size={16} color="#34d399" />
                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>CI Tested Platforms</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {siteConfig.platforms.ci.join(', ')} with automated matrix verification.
              </p>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Terminal size={16} color="#38bdf8" />
                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Node Runtime</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {siteConfig.platforms.node} with ABI 127 native SQLite prebuilds.
              </p>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <HardDrive size={16} color="#818cf8" />
                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Parsed Languages</span>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {siteConfig.platforms.languages.join(', ')} via Tree-sitter WASM extractors.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
