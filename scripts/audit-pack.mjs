import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import console from 'node:console';
import process from 'node:process';

const archive = realpathSync(resolve(process.argv[2] ?? 'graphit-cmp-1.0.0.tgz'));
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
const docs = new Set(['GETTING_STARTED', 'CLI', 'MCP', 'ARCHITECTURE', 'MEMORY', 'RETRIEVAL', 'PORTABILITY', 'DATA_PRESERVATION', 'RELEASE'].map((name) => `package/docs/${name}.md`));
const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:sk-(?:proj-)?|gh[pousr]_|github_pat_|npm_)[A-Za-z0-9_-]{24,}/,
  /(?:[A-Za-z]:[\\/]+Users[\\/]+(?!<)[\w.-]+|\/Users\/(?!<)[\w.-]+|\/home\/(?!<)[\w.-]+)/i,
  /(?:_authToken|api[_-]?key|client[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9_-]{20,}["']/i,
];
let bytes = 0;
for (const path of entries) {
  assert.ok(!path.includes('..') && !path.includes('node_modules') && !path.includes('.graphit'), `Unexpected path: ${path}`);
  assert.ok(['package/package.json', 'package/README.md', 'package/LICENSE'].includes(path) || docs.has(path) ||
    /^package\/dist\/(?:cli|core|storage|memory|codegraph|indexer|retrieval|context|mcp)\/[a-z-]+\.js$/.test(path) ||
    /^package\/dist\/storage\/migrations\/00[1-4]_[a-z_]+\.sql$/.test(path), `Not allowlisted: ${path}`);
  const content = execFileSync('tar', ['-xOzf', archive, path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  bytes += Buffer.byteLength(content);
  assert.ok(forbidden.every((pattern) => !pattern.test(content)), `Potential secret or local path in ${path}`);
  if (path.startsWith('package/dist/')) assert.ok(!/['"]@graphit\//.test(content), `Unresolved workspace import: ${path}`);
}
for (const required of ['package/dist/cli/index.js', 'package/dist/mcp/index.js', 'package/dist/indexer/parser.js',
  'package/dist/storage/portable.js', 'package/dist/storage/migrations/004_retrieval.sql', ...docs]) assert.ok(entries.includes(required), `Missing ${required}`);
console.log(JSON.stringify({ archive: 'graphit-cmp-1.0.0.tgz', files: entries.length, packed_bytes: statSync(archive).size,
  unpacked_bytes: bytes, allowlist: 'passed', credential_and_machine_path_patterns: 'passed',
  databases_transcripts_tests_fixtures_source_maps: 'excluded', runtime_imports: 'passed', publication_performed: false }, null, 2));
