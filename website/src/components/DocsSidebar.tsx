import React from 'react';
import { NavLink } from 'react-router-dom';
import { BookOpen, Terminal, Cpu, Database, Share2, Shield, HardDrive, Layers, Activity } from 'lucide-react';

interface NavGroup {
  title: string;
  items: Array<{
    label: string;
    href: string;
    icon: React.ReactNode;
  }>;
}

const docsNavGroups: NavGroup[] = [
  {
    title: 'Core Documentation',
    items: [
      { label: 'Documentation Overview', href: '/docs', icon: <BookOpen size={16} /> },
      { label: 'Getting Started', href: '/docs/getting-started', icon: <Layers size={16} /> },
      { label: 'CLI Reference', href: '/docs/cli', icon: <Terminal size={16} /> },
      { label: 'MCP Setup', href: '/docs/mcp', icon: <Share2 size={16} /> },
    ],
  },
  {
    title: 'Deep Architecture',
    items: [
      { label: 'Architecture Overview', href: '/docs/architecture', icon: <Cpu size={16} /> },
      { label: 'Project Memory', href: '/docs/memory', icon: <Database size={16} /> },
      { label: 'Retrieval & Context Compiler', href: '/docs/retrieval', icon: <Layers size={16} /> },
      { label: '.graphit Portability', href: '/docs/portability', icon: <HardDrive size={16} /> },
      { label: 'Data Preservation', href: '/docs/data-preservation', icon: <Shield size={16} /> },
    ],
  },
  {
    title: 'Verification & Trust',
    items: [
      { label: 'Measured Benchmarks', href: '/benchmarks', icon: <Activity size={16} /> },
      { label: 'Privacy Policy', href: '/privacy', icon: <Shield size={16} /> },
    ],
  },
];

export const DocsSidebar: React.FC<{ onItemClick?: () => void }> = ({ onItemClick }) => {
  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.75rem',
        paddingRight: '1rem',
      }}
    >
      {docsNavGroups.map((group, groupIdx) => (
        <div key={groupIdx}>
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              marginBottom: '0.65rem',
              paddingLeft: '0.75rem',
            }}
          >
            {group.title}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {group.items.map((item, itemIdx) => (
              <NavLink
                key={itemIdx}
                to={item.href}
                end={item.href === '/docs'}
                onClick={onItemClick}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  padding: '0.45rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.875rem',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  backgroundColor: isActive ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                  transition: 'all 0.15s ease',
                })}
              >
                <span style={{ opacity: 0.85 }}>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
};
