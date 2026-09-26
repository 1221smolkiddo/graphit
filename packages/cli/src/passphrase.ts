import { StringDecoder } from 'node:string_decoder';

/** No secret value is accepted in argv. Environment use is explicit and opt-in. */
export async function readPassphrase(environmentName?: string, confirm = false): Promise<string> {
  if (environmentName !== undefined) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(environmentName)) throw new Error('Invalid passphrase environment variable name');
    const secret = process.env[environmentName];
    delete process.env[environmentName];
    if (!secret || Buffer.byteLength(secret) > 4096) throw new Error('Passphrase environment variable must contain 1..4096 UTF-8 bytes');
    return secret;
  }
  const secret = await prompt('Passphrase: ');
  if (confirm && secret !== await prompt('Confirm passphrase: ')) throw new Error('Passphrases do not match');
  return secret;
}

function prompt(label: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || !process.stderr.isTTY) throw new Error('Passphrase requires a TTY or explicit --passphrase-env <VARIABLE_NAME>');
  return new Promise((resolve, reject) => {
    const previousRaw = input.isRaw;
    const decoder = new StringDecoder('utf8');
    let secret = '';
    const finish = (error?: Error) => {
      input.off('data', onData); input.off('end', onEnd); input.off('error', onError);
      process.off('SIGINT', onEnd); process.off('SIGTERM', onEnd);
      input.setRawMode(previousRaw); input.pause();
      process.stderr.write('\n');
      if (error) reject(error); else resolve(secret);
      secret = '';
    };
    const onEnd = () => finish(new Error('Passphrase entry cancelled'));
    const onError = () => finish(new Error('Passphrase input failed'));
    const onData = (chunk: Buffer) => {
      for (const character of decoder.write(chunk)) {
        if (character === '\u0003' || character === '\u0004') { onEnd(); return; }
        if (character === '\r' || character === '\n') {
          finish(secret ? undefined : new Error('Passphrase cannot be empty')); return;
        }
        if (character === '\u007f' || character === '\b') secret = [...secret].slice(0, -1).join('');
        else if (character < ' ' || character === '\u001b') { finish(new Error('Unsupported control character in passphrase')); return; }
        else secret += character;
        if (Buffer.byteLength(secret) > 4096) { finish(new Error('Passphrase exceeds 4096 UTF-8 bytes')); return; }
      }
    };
    process.stderr.write(label);
    input.setRawMode(true);
    input.on('data', onData); input.once('end', onEnd); input.once('error', onError);
    process.once('SIGINT', onEnd); process.once('SIGTERM', onEnd);
    input.resume();
  });
}
