/**
 * Central Configuration for Graphit Documentation & Marketing Website
 *
 * NOTE: All package identities, URLs, version numbers, contact addresses,
 * and measured benchmark figures are maintained solely in this file.
 * To update the package name (e.g. finalizing @smolkiddo/graphit), repo URLs,
 * privacy email, or benchmark measurements, edit them once here.
 */

export interface BenchmarkMetrics {
  candidateTokens: number;
  candidateTokensFormatted: string;
  selectedTokens: number;
  selectedTokensFormatted: string;
  reductionPercentage: string;
  evidenceRetained: string;
  estimator: string;
  disclaimer: string;
  detailedRuns: Array<{
    budget: number;
    estimatedTokens: number;
    candidateTokens: number;
    reductionPercentage: string;
    evidenceRetained: string;
  }>;
  indexingStress: {
    files: number;
    symbols: number;
    edges: number;
    unchangedBaselineMs: number;
    unchangedOptimizedMs: number;
    improvementPercent: string;
    bm25Latency: string;
    pprLatency: string;
    contextPackingLatency: string;
  };
}

export interface SiteConfig {
  name: string;
  tagline: string;
  headline: string;
  supportingCopy: string;
  corePrinciple: string;
  
  // Package identity & Repository
  packageName: string;
  installCommand: string;
  githubUrl: string;
  githubIssuesUrl: string;
  version: string;
  license: string;
  
  // Privacy & Contact
  privacyContactEmail: string | null;
  privacyLastUpdated: string;
  
  // Benchmarks
  benchmarks: BenchmarkMetrics;
  
  // Platform & Environment
  platforms: {
    ci: string[];
    node: string;
    languages: string[];
  };
  
  // Navigation links
  navLinks: Array<{ label: string; href: string }>;
}

export const siteConfig: SiteConfig = {
  name: 'Graphit',
  tagline: 'Local-first project memory and code intelligence layer for AI coding agents.',
  headline: 'Persistent project intelligence for AI coding agents.',
  supportingCopy:
    'Graphit builds a source-verifiable memory and code graph for your repository, retrieves only the evidence an agent needs, and lets work continue across different AI providers without replaying the entire project history.',
  corePrinciple: 'History is immutable. Memory is derived. Context is disposable.',

  // Central Package & Repository Config (Change once here!)
  packageName: 'graphit-cmp',
  installCommand: 'npm install -g graphit-cmp',
  githubUrl: 'https://github.com/1221smolkiddo/graphit',
  githubIssuesUrl: 'https://github.com/1221smolkiddo/graphit/issues',
  version: '1.0.1',
  license: 'MIT',

  // Configurable privacy contact and date (routed through GitHub Issues)
  privacyContactEmail: null,
  privacyLastUpdated: 'September 2026',

  // Real measured Graphit benchmarks
  benchmarks: {
    candidateTokens: 27662,
    candidateTokensFormatted: '27,662',
    selectedTokens: 1959,
    selectedTokensFormatted: '1,959',
    reductionPercentage: '92.92%',
    evidenceRetained: '6 / 6',
    estimator: 'ceil(UTF-8 bytes / 4)',
    disclaimer:
      "These are measured results from Graphit's current benchmark fixture. Actual token reduction varies by repository, query and requested token budget.",
    detailedRuns: [
      {
        budget: 2000,
        estimatedTokens: 1959,
        candidateTokens: 27662,
        reductionPercentage: '92.92%',
        evidenceRetained: '6 / 6',
      },
      {
        budget: 4000,
        estimatedTokens: 3993,
        candidateTokens: 27664,
        reductionPercentage: '85.57%',
        evidenceRetained: '6 / 6',
      },
      {
        budget: 8000,
        estimatedTokens: 7994,
        candidateTokens: 27664,
        reductionPercentage: '71.10%',
        evidenceRetained: '6 / 6',
      },
    ],
    indexingStress: {
      files: 1000,
      symbols: 22000,
      edges: 80000,
      unchangedBaselineMs: 19316,
      unchangedOptimizedMs: 8844,
      improvementPercent: '54.2%',
      bm25Latency: '0.59 ms',
      pprLatency: '80–156 ms',
      contextPackingLatency: '387–474 ms',
    },
  },

  platforms: {
    ci: ['Windows x64', 'Ubuntu / Linux', 'macOS'],
    node: '>=22.0.0 (v22.x)',
    languages: ['TypeScript', 'TSX', 'JavaScript', 'JSX', 'Python'],
  },

  navLinks: [
    { label: 'Docs', href: '/docs' },
    { label: 'CLI', href: '/docs/cli' },
    { label: 'MCP', href: '/docs/mcp' },
    { label: 'Architecture', href: '/docs/architecture' },
    { label: 'Benchmarks', href: '/benchmarks' },
    { label: 'Privacy', href: '/privacy' },
  ],
};
