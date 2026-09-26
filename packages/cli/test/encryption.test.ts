import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EventStore, readExportFile, validateExport } from '@graphit/storage';
import { encryptBundle, decryptBundle } from '../../storage/src/encryption.js';
import { canonical, cli, project, temporary } from './recovery-helpers.js';

const secret = 'long test passphrase — not a real secret';
function command(root: string, args: string[], password = secret) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, GRAPHIT_TEST_SECRET: password } });
}
async function archive() {
  const fixture = await project();
  const path = join(fixture.root, 'secure.graphit');
  const store = new EventStore(fixture.path);
  try { await store.exportArchive(fixture.id, path, '0.1.0', { passphrase: secret }); }
  finally { store.close(); }
  return { ...fixture, archive: path };
}

describe('authenticated encrypted portability', () => {
  it('CLI roundtrip preserves every canonical event, ID, source hash and blob', async () => {
    const fixture = await project();
    const path = join(fixture.root, 'secure.graphit');
    const result = command(fixture.root, ['export', path, '--encrypt', '--passphrase-env', 'GRAPHIT_TEST_SECRET']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(readFileSync(path).includes(Buffer.from(secret))).toBe(false);
    const destination = temporary();
    const imported = command(destination, ['import', path, '--passphrase-env', 'GRAPHIT_TEST_SECRET']);
    expect(imported.status, imported.stderr).toBe(0);
    expect(canonical(join(destination, '.graphit', 'graphit.db'))).toEqual(canonical(fixture.path));
    expect(command(destination, ['doctor', '--json']).status).toBe(0);
  });
  it.each(['password', 'ciphertext', 'tag', 'truncated', 'header', 'future', 'kdf'] as const)('fails closed before creating destination: %s', async mode => {
    const fixture = await archive();
    let bytes = readFileSync(fixture.archive);
    const end = bytes.indexOf(10, bytes.indexOf(10) + 1);
    if (mode === 'ciphertext') bytes[end + 2] = bytes[end + 2]! ^ 1;
    if (mode === 'tag') bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    if (mode === 'truncated') bytes = bytes.subarray(0, bytes.length - 20);
    if (mode === 'header') {
      const salt = bytes.indexOf(Buffer.from('"salt":"')) + 8;
      bytes[salt] = bytes[salt] === 97 ? 98 : 97;
    }
    if (mode === 'future') bytes = Buffer.concat([Buffer.from(bytes.subarray(0, end).toString().replace('"version":1', '"version":2')), bytes.subarray(end)]);
    if (mode === 'kdf') bytes = Buffer.concat([Buffer.from(bytes.subarray(0, end).toString().replace('"N":32768', '"N":999999999')), bytes.subarray(end)]);
    writeFileSync(fixture.archive, bytes);
    const destination = temporary();
    const result = command(destination, ['import', fixture.archive, '--passphrase-env', 'GRAPHIT_TEST_SECRET'], mode === 'password' ? 'wrong' : secret);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/authentication failed|Unsupported or invalid/);
    expect(result.stderr + result.stdout).not.toContain(secret);
    expect(readdirSync(destination)).toEqual([]);
  });
  it('uses independent random salt and nonce on each export, retaining plaintext compatibility', async () => {
    const fixture = await archive();
    const second = join(fixture.root, 'second.graphit'); const plain = join(fixture.root, 'plain.graphit');
    const store = new EventStore(fixture.path);
    try {
      await store.exportArchive(fixture.id, second, '0.1.0', { passphrase: secret });
      await store.exportArchive(fixture.id, plain, '0.1.0');
    } finally { store.close(); }
    const header = (path: string): { salt: string; iv: string } => JSON.parse(readFileSync(path).toString().split('\n')[1]!) as { salt: string; iv: string };
    expect(header(second).salt).not.toBe(header(fixture.archive).salt);
    expect(header(second).iv).not.toBe(header(fixture.archive).iv);
    expect(validateExport(await readExportFile(second, secret)).rows).toEqual(validateExport(await readExportFile(plain)).rows);
    const destination = temporary();
    expect(command(destination, ['import', plain]).status).toBe(0);
    expect(canonical(join(destination, '.graphit', 'graphit.db'))).toEqual(canonical(fixture.path));
  });
  it('validates the inner manifest after authentication and never overwrites an export', async () => {
    const fixture = await archive();
    const bytes = readFileSync(fixture.archive);
    const compressed = await decryptBundle(bytes, secret);
    compressed[0] = 0; // Valid outer encryption, invalid inner gzip.
    const invalid = join(fixture.root, 'invalid.graphit');
    writeFileSync(invalid, encryptBundle(compressed, secret));
    const destination = temporary();
    expect(command(destination, ['import', invalid, '--passphrase-env', 'GRAPHIT_TEST_SECRET']).status).toBe(1);
    expect(readdirSync(destination)).toEqual([]);
    writeFileSync(invalid, encryptBundle(gzipSync('GRAPHIT_EXPORT\n{"type":"manifest","data":{}}\n'), secret));
    expect(command(destination, ['import', invalid, '--passphrase-env', 'GRAPHIT_TEST_SECRET']).status).toBe(1);
    expect(readdirSync(destination)).toEqual([]);
    expect(command(fixture.root, ['export', fixture.archive, '--encrypt', '--passphrase-env', 'GRAPHIT_TEST_SECRET']).status).toBe(1);
    expect(readFileSync(fixture.archive)).toEqual(bytes);
    expect(readdirSync(fixture.root).filter(path => path.endsWith('.partial'))).toEqual([]);
  });
  it('requires explicit non-interactive input and rejects empty or misplaced secrets', async () => {
    const fixture = await project(); const path = join(fixture.root, 'new.graphit');
    for (const args of [
      ['export', path, '--encrypt'],
      ['export', path, '--passphrase-env', 'GRAPHIT_TEST_SECRET'],
      ['export', path, '--encrypt', '--passphrase', secret],
    ]) expect(command(fixture.root, args).status).toBe(1);
    expect(command(fixture.root, ['export', path, '--encrypt', '--passphrase-env', 'GRAPHIT_TEST_SECRET'], '').status).toBe(1);
    expect(existsSync(path)).toBe(false);
  });
});
