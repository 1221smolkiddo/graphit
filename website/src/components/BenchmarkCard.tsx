import React from 'react';
import { AlertCircle, TrendingDown, CheckCircle2, Hash, Layers } from 'lucide-react';
import { siteConfig } from '../config/siteConfig';

export const BenchmarkCard: React.FC<{ showDetailedTable?: boolean }> = ({
  showDetailedTable = false,
}) => {
  const { benchmarks } = siteConfig;

  return (
    <div
      style={{
        background: 'rgba(18, 18, 21, 0.9)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '2rem',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '1.5rem',
          marginBottom: '2rem',
        }}
      >
        {/* Metric 1 */}
        <div
          style={{
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            <Hash size={15} />
            <span>Candidate Tokens</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {benchmarks.candidateTokensFormatted}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Candidate estimated tokens
          </div>
        </div>

        {/* Metric 2 */}
        <div
          style={{
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            <Layers size={15} />
            <span>Selected Tokens</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
            {benchmarks.selectedTokensFormatted}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Selected estimated tokens
          </div>
        </div>

        {/* Metric 3 */}
        <div
          style={{
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(56, 189, 248, 0.05)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-cyan)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            <TrendingDown size={15} />
            <span>Context Reduction</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
            {benchmarks.reductionPercentage}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Token budget reduction
          </div>
        </div>

        {/* Metric 4 */}
        <div
          style={{
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(52, 211, 153, 0.05)',
            border: '1px solid rgba(52, 211, 153, 0.25)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-emerald)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            <CheckCircle2 size={15} />
            <span>Evidence Retained</span>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
            {benchmarks.evidenceRetained}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Required evidence nodes retained
          </div>
        </div>
      </div>

      {/* Detailed Runs Table if requested */}
      {showDetailedTable && (
        <div style={{ marginBottom: '1.5rem', overflowX: 'auto' }}>
          <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
            Regression Fixture: Budget Scaling Breakdown
          </h4>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.85rem',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.6rem 0.75rem' }}>Requested Budget</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Estimated Selected</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Candidate Pool</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Reduction</th>
                <th style={{ padding: '0.6rem 0.75rem' }}>Evidence Recall</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.detailedRuns.map((run, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-primary)' }}>{run.budget} tokens</td>
                  <td style={{ padding: '0.65rem 0.75rem', color: 'var(--accent-cyan)' }}>{run.estimatedTokens} tokens</td>
                  <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-secondary)' }}>{run.candidateTokens.toLocaleString()}</td>
                  <td style={{ padding: '0.65rem 0.75rem', color: 'var(--accent-emerald)' }}>{run.reductionPercentage}</td>
                  <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-primary)' }}>{run.evidenceRetained}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mandatory Disclaimer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.75rem',
          padding: '0.85rem 1rem',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(251, 191, 36, 0.05)',
          border: '1px solid rgba(251, 191, 36, 0.2)',
          color: 'var(--accent-amber)',
          fontSize: '0.825rem',
          lineHeight: 1.5,
        }}
      >
        <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <span style={{ fontWeight: 600 }}>Important disclaimer: </span>
          {benchmarks.disclaimer} Graphit token counts use the formula{' '}
          <code style={{ fontFamily: 'var(--font-mono)', background: 'rgba(255,255,255,0.06)', padding: '0.1rem 0.3rem', borderRadius: '4px' }}>
            {benchmarks.estimator}
          </code>{' '}
          and may differ from provider-specific tokenizer counts. Do not imply 92.92% is guaranteed.
        </div>
      </div>
    </div>
  );
};
