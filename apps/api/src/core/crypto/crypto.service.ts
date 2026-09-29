import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env';

/**
 * Field-level encryption (AES-256-GCM) for sensitive columns: PAN, Aadhaar, bank account,
 * salary structures. Ciphertext format: v1:<iv b64>:<tag b64>:<data b64>.
 * Phase 3 swaps the static key for per-tenant data keys (envelope encryption).
 */
@Injectable()
export class CryptoService {
  private readonly key = createHash('sha256').update(env.DATA_ENCRYPTION_KEY).digest();

  encrypt(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined || plain === '') return null;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
  }

  decrypt(cipher: string | null | undefined): string | null {
    if (!cipher) return null;
    const [v, iv, tag, data] = cipher.split(':');
    if (v !== 'v1' || !iv || !tag || !data) return null;
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  }

  encryptJson(v: unknown): string | null {
    return this.encrypt(JSON.stringify(v));
  }

  decryptJson<T>(c: string | null | undefined): T | null {
    const s = this.decrypt(c);
    return s ? (JSON.parse(s) as T) : null;
  }

  /** "XXXX XXXX 1234" style masking for display. */
  static mask(last4: string | null | undefined, prefix = 'XXXX XXXX '): string {
    return last4 ? prefix + last4 : '—';
  }
}
