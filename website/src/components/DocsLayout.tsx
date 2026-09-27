import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Menu, X, ArrowUpRight } from 'lucide-react';
import { DocsSidebar } from './DocsSidebar';
import { siteConfig } from '../config/siteConfig';

interface DocsLayoutProps {
  children: React.ReactNode;
  title: string;
  description?: string;
  currentSection?: string;
}

export const DocsLayout: React.FC<DocsLayoutProps> = ({
  children,
  title,
  description,
  currentSection = 'Documentation',
}) => {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const location = useLocation();

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Dynamic document title
  useEffect(() => {
    document.title = `${title} — ${siteConfig.name} Docs`;
  }, [title]);

  return (
    <div className="container" style={{ paddingTop: '2rem', paddingBottom: '5rem' }}>
      {/* Mobile Drawer Toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1rem',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '1.5rem',
        }}
        className="docs-mobile-bar"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <span>Docs</span>
          <ChevronRight size={14} />
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{title}</span>
        </div>
        <button
          onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.8rem',
            color: 'var(--accent-cyan)',
            padding: '0.2rem 0.5rem',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(56, 189, 248, 0.08)',
          }}
        >
          {mobileDrawerOpen ? <X size={16} /> : <Menu size={16} />}
          <span>{mobileDrawerOpen ? 'Close Menu' : 'Menu'}</span>
        </button>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileDrawerOpen && (
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
            marginBottom: '2rem',
          }}
          className="docs-mobile-drawer"
        >
          <DocsSidebar onItemClick={() => setMobileDrawerOpen(false)} />
        </div>
      )}

      {/* Main Grid: Sidebar + Content */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '3rem',
        }}
        className="docs-grid"
      >
        {/* Desktop Sticky Sidebar */}
        <div className="docs-desktop-sidebar">
          <div
            style={{
              position: 'sticky',
              top: '84px',
              maxHeight: 'calc(100vh - 100px)',
              overflowY: 'auto',
              paddingRight: '0.5rem',
            }}
          >
            <DocsSidebar />
          </div>
        </div>

        {/* Content Pane */}
        <article style={{ minWidth: 0 }}>
          {/* Breadcrumb */}
          <nav
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              marginBottom: '1rem',
            }}
            aria-label="Breadcrumb"
          >
            <Link to="/" style={{ color: 'var(--text-muted)' }}>Home</Link>
            <ChevronRight size={14} />
            <Link to="/docs" style={{ color: 'var(--text-muted)' }}>Docs</Link>
            <ChevronRight size={14} />
            <span style={{ color: 'var(--accent-cyan)' }}>{title}</span>
          </nav>

          {/* Page Header */}
          <header style={{ marginBottom: '2.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1.5rem' }}>
            <span className="badge" style={{ marginBottom: '0.75rem' }}>
              {currentSection}
            </span>
            <h1
              style={{
                fontSize: '2.25rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                letterSpacing: '-0.025em',
                lineHeight: 1.2,
                marginBottom: '0.75rem',
              }}
            >
              {title}
            </h1>
            {description && (
              <p
                style={{
                  fontSize: '1.1rem',
                  lineHeight: 1.6,
                  color: 'var(--text-secondary)',
                }}
              >
                {description}
              </p>
            )}
          </header>

          {/* Body Content */}
          <div className="docs-content" style={{ lineHeight: 1.7, fontSize: '0.975rem', color: 'var(--text-secondary)' }}>
            {children}
          </div>

          {/* Page Footer Helper */}
          <div
            style={{
              marginTop: '4rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
            }}
          >
            <div>
              Caught an issue in the documentation?
            </div>
            <a
              href={siteConfig.githubIssuesUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                color: 'var(--accent-cyan)',
              }}
            >
              <span>Submit feedback on GitHub</span>
              <ArrowUpRight size={14} />
            </a>
          </div>
        </article>
      </div>

      <style>{`
        .docs-desktop-sidebar {
          display: none;
        }
        .docs-mobile-bar {
          display: flex;
        }
        @media (min-width: 900px) {
          .docs-grid {
            grid-template-columns: 260px 1fr !important;
          }
          .docs-desktop-sidebar {
            display: block !important;
          }
          .docs-mobile-bar {
            display: none !important;
          }
          .docs-mobile-drawer {
            display: none !important;
          }
        }
        .docs-content h2 {
          color: var(--text-primary);
          font-size: 1.5rem;
          font-weight: 700;
          margin: 2.25rem 0 1rem 0;
          letter-spacing: -0.015em;
          border-bottom: 1px solid rgba(39, 39, 42, 0.5);
          padding-bottom: 0.5rem;
        }
        .docs-content h3 {
          color: var(--text-primary);
          font-size: 1.2rem;
          font-weight: 600;
          margin: 1.75rem 0 0.75rem 0;
        }
        .docs-content p {
          margin-bottom: 1.25rem;
        }
        .docs-content ul, .docs-content ol {
          margin-bottom: 1.25rem;
          padding-left: 1.5rem;
        }
        .docs-content li {
          margin-bottom: 0.4rem;
        }
        .docs-content strong {
          color: var(--text-primary);
        }
        .docs-content code:not(pre code) {
          font-family: var(--font-mono);
          font-size: 0.875em;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #e4e4e7;
          padding: 0.15rem 0.4rem;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};
