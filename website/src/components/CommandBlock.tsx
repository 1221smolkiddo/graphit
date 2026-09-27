import React from 'react';
import { CopyButton } from './CopyButton';

interface CommandBlockProps {
  command: string;
  title?: string;
  showPrompt?: boolean;
  className?: string;
}

export const CommandBlock: React.FC<CommandBlockProps> = ({
  command,
  title,
  showPrompt = true,
  className = '',
}) => {
  return (
    <div
      style={{
        background: '#0d0d10',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        margin: '0.75rem 0',
      }}
      className={className}
    >
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.4rem 0.85rem',
            background: 'rgba(24, 24, 27, 0.6)',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span>{title}</span>
          <CopyButton text={command} label="Copy" />
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: title ? '0.75rem 1rem' : '0.65rem 0.85rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          color: 'var(--text-primary)',
          overflowX: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flex: 1, minWidth: 0 }}>
          {showPrompt && (
            <span style={{ color: 'var(--text-muted)', userSelect: 'none' }}>$</span>
          )}
          <pre
            style={{
              margin: 0,
              fontFamily: 'inherit',
              whiteSpace: 'pre',
              overflowX: 'auto',
              flex: 1,
            }}
          >
            <code>{command}</code>
          </pre>
        </div>
        {!title && <CopyButton text={command} />}
      </div>
    </div>
  );
};
