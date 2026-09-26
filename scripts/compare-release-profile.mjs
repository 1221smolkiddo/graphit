import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';

const before = JSON.parse(readFileSync('benchmarks/release-profile-before.json', 'utf8'));
const after = JSON.parse(readFileSync('benchmarks/release-profile-after.json', 'utf8'));
assert.deepEqual(after.fixture, before.fixture);
const sample = (report, name) => report.samples.find(sample => sample.name === name);
const rewriteCounts = (report, name) => Object.entries(sample(report, name).sql_profile)
  .filter(([sql]) => /^(INSERT INTO|DELETE FROM) code_(edges|symbols|files|imports)\b/.test(sql))
  .map(([sql, stats]) => ({ sql, calls: stats.calls }));
assert.deepEqual(rewriteCounts(after, 'unchanged_index'), []);
assert.equal(sample(after, 'unchanged_index').index_metrics.files_parsed, 0);
assert.equal(sample(after, 'one_file_index').index_metrics.files_parsed, 1);
const report = {
  measured_at: new Date().toISOString(), node: process.version, platform: process.platform,
  fixture: after.fixture,
  operations: ['initial_index', 'unchanged_index', 'one_file_index'].map(name => ({
    name, before_ms: sample(before, name).elapsed_ms, after_ms: sample(after, name).elapsed_ms,
    improvement_percent: 100 * (1 - sample(after, name).elapsed_ms / sample(before, name).elapsed_ms),
  })),
  peak_rss_bytes: { before: before.peak_rss_bytes, after: after.peak_rss_bytes },
  unchanged_projection_rewrites: { before: rewriteCounts(before, 'unchanged_index'), after: rewriteCounts(after, 'unchanged_index') },
  notes: ['Single instrumented local run per version; CPU profiling adds overhead.',
    'Other local verification activity may affect initial timings; initial indexing was not optimized.',
    'Incremental changes intentionally retain global relationship resolution and full projection publication.',
    'No FTS queries or writes occur in the index phases; search projection maintenance is deferred to retrieval.'],
};
writeFileSync('benchmarks/release-performance.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
