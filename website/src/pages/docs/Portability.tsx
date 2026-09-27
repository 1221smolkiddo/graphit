import React from 'react';
import { DocsLayout } from '../../components/DocsLayout';
import { CommandBlock } from '../../components/CommandBlock';
import { AlertCircle, Lock } from 'lucide-react';

export const Portability: React.FC = () => {
  return (
    <DocsLayout
      title=".graphit Export, Import & Encryption"
      description="Zero vendor lock-in. Package your repository's canonical memory, events, and source blobs into portable, verifiable, and optionally encrypted archives."
      currentSection="Portability"
    >
      <h2>What is a .graphit File?</h2>
      <p>
        A <code>.graphit</code> bundle is a standalone, self-contained archive of your project's canonical state. Unlike database dumps that capture machine-specific pointers and volatile indexes, a <code>.graphit</code> bundle captures only immutable ground truth:
      </p>
      <ul>
        <li><strong>Project Metadata:</strong> Canonical project identity, name, and creation parameters.</li>
        <li><strong>Immutable Events:</strong> Full append-only log of conversation events, decisions, and checkpoints.</li>
        <li><strong>SHA-256 Source Blobs:</strong> Complete base64-encoded file snapshots referenced by historical observations.</li>
        <li><strong>Session Records:</strong> Timestamps, agent attributions, and checkpoint boundaries.</li>
        <li><strong>Integrity Hashes & Manifest:</strong> Cryptographic digests protecting every record against corruption.</li>
      </ul>

      <p>
        <strong>Derived indexes are excluded:</strong> Because code graphs, FTS5 tables, and PageRank structures are derived, they are omitted from the export to keep archives compact. Upon running <code>graphit import</code>, Graphit transactionally rebuilds all derived projections in seconds.
      </p>

      <h2>Export & Import Commands</h2>
      <CommandBlock command="graphit export project.graphit" title="Create standard archive" />

      <p>To restore into an empty directory or another developer machine:</p>
      <CommandBlock
        command="graphit import /path/to/project.graphit"
        title="Import archive into clean directory"
      />

      <h2>Authenticated Encrypted Archives (P6C)</h2>
      <p>
        For sensitive repositories and shared team environments, Graphit provides hardware-grade authenticated encryption. When running with <code>--encrypt</code>, Graphit prompts for a passphrase twice in the terminal without echoing:
      </p>
      <CommandBlock command="graphit export secure.graphit --encrypt" title="Encrypted export" />

      <p>
        For CI/CD or automation pipelines, pass the environment variable name holding the passphrase:
      </p>
      <CommandBlock
        command="graphit export secure.graphit --encrypt --passphrase-env GRAPHIT_ARCHIVE_PASSPHRASE"
      />

      <div
        style={{
          background: 'rgba(129, 140, 248, 0.05)',
          border: '1px solid rgba(129, 140, 248, 0.25)',
          borderRadius: 'var(--radius-md)',
          padding: '1.25rem',
          margin: '1.5rem 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-indigo)', fontWeight: 600, marginBottom: '0.5rem' }}>
          <Lock size={18} />
          <span>Cryptographic Specification</span>
        </div>
        <ul style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', paddingLeft: '1.25rem', lineHeight: 1.6 }}>
          <li><strong>Cipher:</strong> Authenticated AES-256-GCM (12-byte random IV, 16-byte authentication tag).</li>
          <li><strong>Key Derivation Function:</strong> <code>scrypt</code> (N=32768, r=8, p=1, 32-byte key, 64 MiB memory limit).</li>
          <li><strong>Salt:</strong> 16 bytes of cryptographically secure random entropy.</li>
          <li><strong>Additional Authenticated Data (AAD):</strong> Full archive header and magic signature are authenticated to prevent tampering.</li>
          <li><strong>Atomic publishing:</strong> Writes to temporary files and verifies integrity before final atomic hard-link publication.</li>
        </ul>
      </div>

      {/* Honest Encryption Boundary */}
      <div
        style={{
          padding: '1.25rem',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(251, 191, 36, 0.05)',
          border: '1px solid rgba(251, 191, 36, 0.25)',
          color: 'var(--accent-amber)',
          fontSize: '0.875rem',
          display: 'flex',
          gap: '0.85rem',
          margin: '1.5rem 0',
        }}
      >
        <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <strong style={{ color: '#fbbf24' }}>Important Security Boundary: </strong>
          Encryption protects exported <code>.graphit</code> files in transit or storage. <strong>Graphit's live SQLite database (<code>.graphit/graphit.db</code>) is NOT encrypted at rest by Graphit.</strong> If your operating system disk is not protected, sensitive data in your local working directory remains visible to local users. We strongly recommend enabling full-disk encryption (BitLocker on Windows, FileVault on macOS, or LUKS on Linux).
        </div>
      </div>
    </DocsLayout>
  );
};
