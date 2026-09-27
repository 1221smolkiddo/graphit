import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(metadata.name, 'graphit-cmp');
assert.equal(metadata.version, '1.0.0');
assert.equal(metadata.repository?.url, 'git+https://github.com/1221smolkiddo/graphit.git');
assert.equal(process.env.GITHUB_REPOSITORY, '1221smolkiddo/graphit');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
assert.ok(process.env.npm_execpath, 'Run via npm or a runner with npm_execpath');
let versions;
try {
  const output = execFileSync(process.execPath, [process.env.npm_execpath,
    'view', metadata.name, 'versions', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  versions = JSON.parse(output);
} catch (error) {
  if (error?.stdout?.includes('E404') || error?.stderr?.includes('E404')) {
    versions = [];
  } else {
    throw error;
  }
}
assert.ok(!(Array.isArray(versions) ? versions : [versions]).includes(metadata.version),
  'graphit-cmp@1.0.0 already exists on npm. Resolve the package name/version before publishing.');
console.log('Release identity and registry preflight passed.');
