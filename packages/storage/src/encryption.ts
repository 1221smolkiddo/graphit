import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '@graphit/core';

const MAGIC = Buffer.from('GRAPHIT_ENCRYPTED\n');
const headerSchema = z.object({
  version: z.literal(1), cipher: z.literal('aes-256-gcm'), kdf: z.literal('scrypt'),
  N: z.literal(32768), r: z.literal(8), p: z.literal(1),
  salt: z.string().regex(/^[a-f0-9]{32}$/), iv: z.string().regex(/^[a-f0-9]{24}$/),
}).strict();
export type PassphraseSource = string | (() => Promise<string>);
export interface ArchiveEncryption { passphrase: string }

function keyFor(passphrase: string, salt: string): Buffer {
  if (!passphrase || Buffer.byteLength(passphrase) > 4096) throw new Error('Passphrase must contain 1..4096 UTF-8 bytes');
  return scryptSync(passphrase, Buffer.from(salt, 'hex'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** Encrypt the existing gzip bundle, not a different canonical export format. */
export function encryptBundle(compressed: Buffer, passphrase: string): Buffer {
  const header = { version: 1, cipher: 'aes-256-gcm', kdf: 'scrypt', N: 32768, r: 8, p: 1,
    salt: randomBytes(16).toString('hex'), iv: randomBytes(12).toString('hex') };
  const aad = Buffer.concat([MAGIC, Buffer.from(canonicalJson(header) + '\n')]);
  const key = keyFor(passphrase, header.salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'hex'), { authTagLength: 16 });
    cipher.setAAD(aad);
    return Buffer.concat([aad, cipher.update(compressed), cipher.final(), cipher.getAuthTag()]);
  } finally { key.fill(0); }
}

/** Authenticate completely before releasing any compressed plaintext to the caller. */
export async function decryptBundle(bytes: Buffer, source?: PassphraseSource): Promise<Buffer> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return bytes; // Existing gzip exports.
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Unknown Graphit bundle format');
  const end = bytes.indexOf(10, MAGIC.length);
  if (end < 0 || end > 2048 || bytes.length < end + 1 + 16) throw new Error('Invalid encrypted bundle header or truncated bundle');
  let header: z.infer<typeof headerSchema>;
  try { header = headerSchema.parse(JSON.parse(bytes.subarray(MAGIC.length, end).toString('utf8')) as unknown); }
  catch { throw new Error('Unsupported or invalid encrypted bundle version/parameters'); }
  if (source === undefined) throw new Error('Encrypted bundle requires a passphrase');
  const passphrase = typeof source === 'function' ? await source() : source;
  const key = keyFor(passphrase, header.salt);
  let pending: Buffer | undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'hex'), { authTagLength: 16 });
    decipher.setAAD(bytes.subarray(0, end + 1));
    decipher.setAuthTag(bytes.subarray(-16));
    pending = decipher.update(bytes.subarray(end + 1, -16));
    return Buffer.concat([pending, decipher.final()]);
  } catch { throw new Error('Encrypted bundle authentication failed: wrong passphrase or damaged bundle'); }
  finally { key.fill(0); pending?.fill(0); }
}
