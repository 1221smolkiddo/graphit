import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Github, Menu, X, ArrowRight } from 'lucide-react';
import { siteConfig } from '../config/siteConfig';

export const Navbar: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        width: '100%',
        backgroundColor: 'rgba(9, 9, 11, 0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '64px',
        }}
      >
        {/* Brand */}
        <Link
          to="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            fontWeight: 700,
            fontSize: '1.15rem',
            letterSpacing: '-0.02em',
            color: '#ffffff',
          }}
        >
          <img
            src="/logo-transparent.png"
            alt="Graphit Logo"
            style={{
              width: '32px',
              height: '32px',
              objectFit: 'contain',
              display: 'block',
              filter: 'drop-shadow(0 0 10px rgba(56, 189, 248, 0.4))',
            }}
          />
          <span>{siteConfig.name}</span>
          <span
            style={{
              fontSize: '0.7rem',
              padding: '0.1rem 0.4rem',
              borderRadius: 'var(--radius-full)',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            v{siteConfig.version}
          </span>
        </Link>

        {/* Desktop Nav Links */}
        <nav
          style={{
            display: 'none',
            alignItems: 'center',
            gap: '1.75rem',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
          className="desktop-nav"
        >
          <NavLink
            to="/docs"
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              transition: 'color 0.15s ease',
            })}
          >
            Docs
          </NavLink>
          <NavLink
            to="/docs/cli"
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              transition: 'color 0.15s ease',
            })}
          >
            CLI
          </NavLink>
          <NavLink
            to="/docs/mcp"
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              transition: 'color 0.15s ease',
            })}
          >
            MCP
          </NavLink>
          <NavLink
            to="/docs/architecture"
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              transition: 'color 0.15s ease',
            })}
          >
            Architecture
          </NavLink>
          <NavLink
            to="/benchmarks"
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              transition: 'color 0.15s ease',
            })}
          >
            Benchmarks
          </NavLink>
          <NavLink
            to="/privacy"
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
              transition: 'color 0.15s ease',
            })}
          >
            Privacy
          </NavLink>
        </nav>

        {/* Desktop Actions */}
        <div
          style={{
            display: 'none',
            alignItems: 'center',
            gap: '1rem',
          }}
          className="desktop-nav"
        >
          <a
            href={siteConfig.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub Repository"
            style={{
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              padding: '0.4rem',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <Github size={20} />
          </a>
          <Link to="/docs/getting-started" className="btn btn-primary" style={{ padding: '0.45rem 1rem' }}>
            <span>Get Started</span>
            <ArrowRight size={14} />
          </Link>
        </div>

        {/* Mobile Hamburger Toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle navigation menu"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-primary)',
            padding: '0.5rem',
            borderRadius: 'var(--radius-sm)',
          }}
          className="mobile-toggle"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-secondary)',
            padding: '1.25rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
          className="mobile-drawer"
        >
          <NavLink
            to="/docs"
            onClick={() => setMobileMenuOpen(false)}
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-primary)',
              fontSize: '1rem',
              fontWeight: 500,
            })}
          >
            Documentation
          </NavLink>
          <NavLink
            to="/docs/cli"
            onClick={() => setMobileMenuOpen(false)}
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-primary)',
              fontSize: '1rem',
              fontWeight: 500,
            })}
          >
            CLI Reference
          </NavLink>
          <NavLink
            to="/docs/mcp"
            onClick={() => setMobileMenuOpen(false)}
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-primary)',
              fontSize: '1rem',
              fontWeight: 500,
            })}
          >
            MCP Setup
          </NavLink>
          <NavLink
            to="/docs/architecture"
            onClick={() => setMobileMenuOpen(false)}
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-primary)',
              fontSize: '1rem',
              fontWeight: 500,
            })}
          >
            Architecture
          </NavLink>
          <NavLink
            to="/benchmarks"
            onClick={() => setMobileMenuOpen(false)}
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-primary)',
              fontSize: '1rem',
              fontWeight: 500,
            })}
          >
            Benchmarks
          </NavLink>
          <NavLink
            to="/privacy"
            onClick={() => setMobileMenuOpen(false)}
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent-cyan)' : 'var(--text-primary)',
              fontSize: '1rem',
              fontWeight: 500,
            })}
          >
            Privacy Policy
          </NavLink>
          <div
            style={{
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <a
              href={siteConfig.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: 'var(--text-secondary)',
                fontSize: '0.95rem',
              }}
            >
              <Github size={18} />
              <span>GitHub Repository</span>
            </a>
            <Link
              to="/docs/getting-started"
              onClick={() => setMobileMenuOpen(false)}
              className="btn btn-primary"
              style={{ width: '100%' }}
            >
              <span>Get Started</span>
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      {/* Media query styling for responsive nav */}
      <style>{`
        @media (min-width: 768px) {
          .desktop-nav {
            display: flex !important;
          }
          .mobile-toggle {
            display: none !important;
          }
          .mobile-drawer {
            display: none !important;
          }
        }
      `}</style>
    </header>
  );
};
