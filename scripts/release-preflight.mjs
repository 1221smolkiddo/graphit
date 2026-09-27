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
// Registry failures are blockers, not permission to publish. An existing version
// cannot be overwritten, even after ownership transfer.
const versions = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath,
  'view', metadata.name, 'versions', '--json'], { encoding: 'utf8' }));
assert.ok(!(Array.isArray(versions) ? versions : [versions]).includes(metadata.version),
  'graphit-cmp@1.0.0 already exists on npm. Resolve the package name/version before publishing.');
console.log('Release identity and registry preflight passed.');
