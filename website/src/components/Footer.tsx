import React from 'react';
import { Link } from 'react-router-dom';
import { Github } from 'lucide-react';
import { siteConfig } from '../config/siteConfig';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        borderTop: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-secondary)',
        padding: '3.5rem 0 2rem 0',
        marginTop: '5rem',
      }}
    >
      <div className="container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '2.5rem',
            paddingBottom: '2.5rem',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          {/* Brand Col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.1rem' }}>
              <img
                src="/logo-transparent.png"
                alt="Graphit Logo"
                style={{
                  width: '26px',
                  height: '26px',
                  objectFit: 'contain',
                  display: 'block',
                  filter: 'drop-shadow(0 0 8px rgba(56, 189, 248, 0.4))',
                }}
              />
              <span>{siteConfig.name}</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', maxWidth: '300px' }}>
              {siteConfig.tagline}
            </p>
            <div style={{ marginTop: '0.5rem' }}>
              <a
                href={siteConfig.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <Github size={16} />
                <span>GitHub Repository</span>
              </a>
            </div>
          </div>

          {/* Documentation Col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Documentation
            </h4>
            <Link to="/docs" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Overview
            </Link>
            <Link to="/docs/getting-started" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Getting Started
            </Link>
            <Link to="/docs/cli" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              CLI Reference
            </Link>
            <Link to="/docs/mcp" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              MCP Setup
            </Link>
          </div>

          {/* Architecture Col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Architecture
            </h4>
            <Link to="/docs/architecture" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Architecture Layers
            </Link>
            <Link to="/docs/memory" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Project Memory
            </Link>
            <Link to="/docs/retrieval" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Retrieval & Compiler
            </Link>
            <Link to="/docs/portability" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              .graphit Portability
            </Link>
            <Link to="/docs/data-preservation" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Data Preservation
            </Link>
          </div>

          {/* Resources & Trust Col */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Trust & Verifiability
            </h4>
            <Link to="/benchmarks" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Benchmark Results
            </Link>
            <Link to="/privacy" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Privacy Policy
            </Link>
            <a
              href={`${siteConfig.githubUrl}/blob/main/LICENSE`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}
            >
              MIT License
            </a>
            <a
              href={siteConfig.githubIssuesUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}
            >
              Report an Issue
            </a>
          </div>
        </div>

        {/* Bottom Bar */}
        <div
          style={{
            paddingTop: '1.75rem',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
          }}
        >
          <div>
            &copy; {new Date().getFullYear()} {siteConfig.name}. Released under the{' '}
            <a
              href={`${siteConfig.githubUrl}/blob/main/LICENSE`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}
            >
              MIT License
            </a>
            .
          </div>
          <div>
            Local-first project intelligence for AI agents.
          </div>
        </div>
      </div>
    </footer>
  );
};
