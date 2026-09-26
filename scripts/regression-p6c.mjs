import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import console from 'node:console';
const env = { ...process.env }; delete env.NODE_OPTIONS; delete env.NODE_NO_WARNINGS;
const result = spawnSync(process.execPath, ['examples/context-demo.mjs'], { env, encoding: 'utf8', timeout: 120000 });
assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
assert.doesNotMatch(result.stderr, /ExperimentalWarning/);
const report = JSON.parse(result.stdout);
assert.equal(report.cli.quality.passed, true);
assert.equal(report.cli.quality.required_evidence_recall, 1);
assert.ok(report.retrieval.every(query => query.context_quality.passed));
const budget = report.budgets.find(budget => budget.requested_tokens === 2000);
assert.equal(budget.required_evidence_recall, 1);
assert.ok(budget.reduction_ratio > 0.92);
writeFileSync(process.argv[2] ?? 'benchmarks/p6c-p3-regression.json', JSON.stringify({
  measured_at: new Date().toISOString(), node: process.version, platform: process.platform,
  command: 'node examples/context-demo.mjs', exit_code: result.status, report,
}, null, 2) + '\n');
console.log(JSON.stringify({ quality: report.cli.quality, budget: report.cli.budget }, null, 2));
