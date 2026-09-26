import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPassphrase } from '../src/passphrase.js';

afterEach(() => { vi.restoreAllMocks(); delete process.env.GRAPHIT_PROMPT_TEST; });
function terminal() {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false,
    setRawMode: vi.fn((raw: boolean) => { input.isRaw = raw; return input; }) });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  let displayed = ''; output.on('data', chunk => { displayed += String(chunk); });
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as typeof process.stdin);
  vi.spyOn(process, 'stderr', 'get').mockReturnValue(output as unknown as typeof process.stderr);
  return { input, output: () => displayed };
}
describe('passphrase input', () => {
  it('does not echo Unicode or backspaces, and restores the terminal', async () => {
    const tty = terminal();
    const pending = readPassphrase();
    tty.input.write(Buffer.from('caféX\u007f\r'));
    expect(await pending).toBe('café');
    expect(tty.output()).toBe('Passphrase: \n');
    expect(tty.input.isRaw).toBe(false);
    expect(tty.input.listenerCount('data')).toBe(0);
  });
  it('confirms exports without echoing either entry', async () => {
    const tty = terminal(); const pending = readPassphrase(undefined, true);
    tty.input.write(Buffer.from('secret\r'));
    await Promise.resolve();
    tty.input.write(Buffer.from('secret\r'));
    expect(await pending).toBe('secret');
    expect(tty.output()).not.toContain('secret');
  });
  it('rejects mismatched confirmation', async () => {
    const tty = terminal(); const pending = readPassphrase(undefined, true);
    const rejected = expect(pending).rejects.toThrow('do not match');
    tty.input.write(Buffer.from('one\r')); await Promise.resolve();
    tty.input.write(Buffer.from('two\r')); await rejected;
    expect(tty.input.isRaw).toBe(false);
  });
  it.each(['\u0003', '\u0004', '\u001b'])('cancels safely on control input %j', async key => {
    const tty = terminal(); const pending = readPassphrase();
    const rejected = expect(pending).rejects.toThrow();
    tty.input.write(Buffer.from(key)); await rejected;
    expect(tty.input.isRaw).toBe(false);
    expect(tty.input.listenerCount('data')).toBe(0);
  });
  it('consumes only an explicitly selected environment variable', async () => {
    process.env.GRAPHIT_PROMPT_TEST = 'selected';
    expect(await readPassphrase('GRAPHIT_PROMPT_TEST')).toBe('selected');
    expect(process.env.GRAPHIT_PROMPT_TEST).toBeUndefined();
    await expect(readPassphrase('GRAPHIT_PROMPT_TEST')).rejects.toThrow('must contain');
  });
});
