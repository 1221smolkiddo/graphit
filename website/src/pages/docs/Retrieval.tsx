import React from 'react';
import { DocsLayout } from '../../components/DocsLayout';
import { CommandBlock } from '../../components/CommandBlock';
import { BenchmarkCard } from '../../components/BenchmarkCard';
import { siteConfig } from '../../config/siteConfig';

export const Retrieval: React.FC = () => {
  return (
    <DocsLayout
      title="Retrieval Engine & Context Compiler"
      description="How Graphit combines SQLite FTS5 BM25, Reciprocal Rank Fusion, Personalized PageRank, and MMR to compile token-budgeted context."
      currentSection="Core Concepts"
    >
      <h2>No Embeddings. Pure Verifiable Evidence.</h2>
      <p>
        Graphit does not use external vector databases, proprietary embeddings, or opaque distance metrics. Instead, it relies entirely on <strong>syntactic precision, keyword frequency, and topological graph diffusion</strong>. This makes retrieval deterministic, instant, reproducible, and 100% offline.
      </p>

      <h2>The Multi-Stage Retrieval Pipeline</h2>

      <h3>1. Candidate Gathering</h3>
      <p>
        When a query enters the retrieval engine, candidates are drawn from two complementary sources:
      </p>
      <ul>
        <li><strong>Exact Syntactic Matches:</strong> Symbols, qualified names, and file paths matching the query terms.</li>
        <li><strong>SQLite FTS5 BM25:</strong> Full-text keyword scoring against code comments, function names, and memory records.</li>
      </ul>

      <h3>2. Reciprocal Rank Fusion (RRF)</h3>
      <p>
        BM25 scores and exact match distances are normalized and combined using Reciprocal Rank Fusion:
      </p>
      <pre
        style={{
          background: '#0d0d10',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '0.85rem 1rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          color: 'var(--accent-cyan)',
          marginBottom: '1rem',
        }}
      >
        RRF_Score(d) = Σ [ 1 / (k + rank_i(d)) ]  where k = 60
      </pre>

      <h3>3. Bounded Personalized PageRank (PPR)</h3>
      <p>
        High-scoring candidate nodes act as seed nodes for a localized random walk along the repository's code graph (e.g. <code>CALLS</code>, <code>IMPORTS</code>) and memory relations. This naturally pulls in essential helper functions, imported types, and caller context that keyword matching alone would miss.
      </p>

      <h3>4. Deterministic Maximal Marginal Relevance (MMR)</h3>
      <p>
        To avoid saturating the context window with repetitive definitions or duplicate code spans, MMR enforces diversity among selected candidates, ensuring the prompt gets maximum unique information per token.
      </p>

      <h2>Token-Aware Context Compiler</h2>
      <p>
        Once evidence is ranked, the Context Compiler packs the items into a strictly budgeted envelope:
      </p>
      <ul>
        <li>
          <strong>Token Estimation:</strong> Calculated using the formula <code>{siteConfig.benchmarks.estimator}</code>. This formula provides a reliable, provider-neutral upper bound.
        </li>
        <li>
          <strong>Metadata Accounting:</strong> The compiler reserves space for JSON packet framing and node provenance tags so that total output never exceeds the requested budget.
        </li>
        <li>
          <strong>Explicit Budget Insufficiency:</strong> If the token budget is too small to accommodate the minimum required evidence, Graphit returns <code>budget_insufficient: true</code> with exit code 2, rather than silently omitting critical code blocks.
        </li>
      </ul>

      <h2>Measured Retrieval Benchmark</h2>
      <p>
        On Graphit's standardized multi-step regression benchmark fixture (querying complex authentication and refresh token rotation workflows), Graphit achieved the following measured results:
      </p>

      <div style={{ margin: '1.5rem 0' }}>
        <BenchmarkCard showDetailedTable={true} />
      </div>

      <h2>Retrieval Commands</h2>
      <CommandBlock
        command='graphit retrieve "where is session created?" --limit 10'
        title="Inspect ranked candidates and graph paths"
      />
      <CommandBlock
        command='graphit context "explain session creation" --tokens 2000 --mode auto'
        title="Generate budgeted context packet"
      />
    </DocsLayout>
  );
};
