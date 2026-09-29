import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** AES-256-GCM: output = iv(12) ‖ tag(16) ‖ ciphertext. */
export function seal(key: Buffer, plain: Buffer | string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(typeof plain === 'string' ? Buffer.from(plain, 'utf8') : plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function open(key: Buffer, box: Buffer): Buffer {
  if (box.length < 28) throw new Error('Sealed payload too short');
  const d = createDecipheriv('aes-256-gcm', key, box.subarray(0, 12));
  d.setAuthTag(box.subarray(12, 28));
  return Buffer.concat([d.update(box.subarray(28)), d.final()]);
}

/** Protects the data key at rest (Electron safeStorage → Windows DPAPI in production). */
export interface KeyProtector {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

/**
 * Load the 256-bit store key, creating it on first run. The key file holds the key
 * wrapped by the protector; when OS encryption is unavailable (rare: no DPAPI/keyring)
 * it falls back to a plain key file marked "PLAIN:" so the store still works.
 */
export function loadOrCreateKey(path: string, protector: KeyProtector): Buffer {
  if (existsSync(path)) {
    const raw = readFileSync(path);
    const head = raw.subarray(0, 6).toString('utf8');
    if (head === 'PLAIN:') return Buffer.from(raw.subarray(6).toString('utf8'), 'base64');
    return Buffer.from(protector.decrypt(raw), 'base64');
  }
  const key = randomBytes(32);
  mkdirSync(dirname(path), { recursive: true });
  const data = protector.available()
    ? protector.encrypt(key.toString('base64'))
    : Buffer.from('PLAIN:' + key.toString('base64'), 'utf8');
  atomicWrite(path, data);
  return key;
}

export function atomicWrite(path: string, data: Buffer | string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

/** A small encrypted JSON document (engine snapshot, caches, secrets). */
export class SealedJsonFile<T> {
  constructor(
    private readonly path: string,
    private readonly key: Buffer,
  ) {}

  read(): T | null {
    try {
      if (!existsSync(this.path)) return null;
      return JSON.parse(open(this.key, readFileSync(this.path)).toString('utf8')) as T;
    } catch {
      return null;
    }
  }

  write(value: T) {
    atomicWrite(this.path, seal(this.key, JSON.stringify(value)));
  }
}
