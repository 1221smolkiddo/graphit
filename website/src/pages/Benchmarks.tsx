import React, { useEffect } from 'react';
import { BenchmarkCard } from '../components/BenchmarkCard';
import { siteConfig } from '../config/siteConfig';
import { Activity, Cpu, CheckCircle2, AlertTriangle, Layers, Zap } from 'lucide-react';

export const Benchmarks: React.FC = () => {
  useEffect(() => {
    document.title = `Benchmarks — ${siteConfig.name}`;
    window.scrollTo(0, 0);
  }, []);

  const { indexingStress: stress } = siteConfig.benchmarks;

  return (
    <div className="container-narrow" style={{ paddingTop: '3rem', paddingBottom: '6rem' }}>
      {/* Header */}
      <header style={{ marginBottom: '3rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '2rem' }}>
        <div className="badge badge-muted" style={{ marginBottom: '1rem' }}>
          <Activity size={14} />
          <span>Empirical Measurements</span>
        </div>
        <h1
          style={{
            fontSize: '2.5rem',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: 'var(--text-primary)',
            marginBottom: '0.75rem',
          }}
        >
          Measured Performance & Benchmarks
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: 1.6 }}>
          Empirical measurements from Graphit's standardized stress and context retrieval regression suites.
        </p>
      </header>

      {/* Main Retrieval Benchmark */}
      <section style={{ marginBottom: '4rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
          1. Context Reduction Benchmark (P3 Suite)
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Evaluated against a multi-package authentication fixture with complex token refresh rotation, callers, and historical architecture decisions.
        </p>
        <BenchmarkCard showDetailedTable={true} />
      </section>

      {/* Indexing Stress Suite */}
      <section style={{ marginBottom: '4rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
          2. Repository Scale & Indexing Stress Benchmark (P6C)
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Measured on a deterministic synthetic repository fixture containing <strong>1,000 files, 22,000 symbols, and 80,000 relationship edges</strong>.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1.25rem',
            marginBottom: '2rem',
          }}
        >
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-cyan)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              <Layers size={16} />
              <span>Fixture Size</span>
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
              {stress.files.toLocaleString()} files
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              {stress.symbols.toLocaleString()} symbols &bull; {stress.edges.toLocaleString()} edges
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-emerald)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              <Zap size={16} />
              <span>Unchanged Index Speedup</span>
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
              {stress.improvementPercent}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              19.3s &rarr; 8.8s via hash-verified fast path
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-indigo)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              <Cpu size={16} />
              <span>SQL BM25 Latency</span>
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#818cf8', fontFamily: 'var(--font-mono)' }}>
              {stress.bm25Latency}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Instant candidate keyword ranking
            </div>
          </div>
        </div>

        {/* Latency Table */}
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', fontWeight: 600, fontSize: '0.9rem' }}>
            Pipeline Latencies (1,000 File Repository)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.75rem 1.25rem', color: 'var(--text-secondary)' }}>Graph Assembly (ID-Set Dedup)</td>
                <td style={{ padding: '0.75rem 1.25rem', color: 'var(--text-primary)', textAlign: 'right' }}>1.14 s (was 56.09 s)</td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.75rem 1.25rem', color: 'var(--text-secondary)' }}>SQLite FTS5 BM25 Retrieval</td>
                <td style={{ padding: '0.75rem 1.25rem', color: 'var(--text-primary)', textAlign: 'right' }}>{stress.bm25Latency}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.75rem 1.25rem', color: 'var(--text-secondary)' }}>Bounded Personalized PageRank (PPR)</td>
                <td style={{ padding: '0.75rem 1.25rem', color: 'var(--text-primary)', textAlign: 'right' }}>{stress.pprLatency}</td>
              </tr>
              <tr>
                <td style={{ padding: '0.75rem 1.25rem', color: 'var(--text-secondary)' }}>Context Compilation & Packing</td>
                <td style={{ padding: '0.75rem 1.25rem', color: 'var(--text-primary)', textAlign: 'right' }}>{stress.contextPackingLatency}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Verified Environments */}
      <section>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
          3. Verified Test Matrix
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          Graphit's automated test suite is continuously verified across the following environments:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {siteConfig.platforms.ci.map((platform, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.9rem',
              }}
            >
              <CheckCircle2 size={16} color="#34d399" />
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{platform}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                Node.js {siteConfig.platforms.node}
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: '2rem',
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(251, 191, 36, 0.05)',
            border: '1px solid rgba(251, 191, 36, 0.2)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            fontSize: '0.85rem',
            color: 'var(--accent-amber)',
          }}
        >
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Disclaimer on Reproduction: </strong>
            Timings reflect single-instrumented runs on specified test fixtures. Real-world indexing and retrieval durations depend on CPU speed, disk I/O, repository depth, and requested token budgets. Graphit does not guarantee identical token reduction for arbitrary repositories.
          </div>
        </div>
      </section>
    </div>
  );
};
