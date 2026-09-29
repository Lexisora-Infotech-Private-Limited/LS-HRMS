import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOrCreateKey, open, seal, SealedJsonFile, type KeyProtector } from './crypto-box';
import { OutboxStore } from './outbox-store';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'lx-tracker-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const fakeProtector: KeyProtector = {
  available: () => true,
  encrypt: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decrypt: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
};

describe('crypto box', () => {
  it('round-trips and rejects tampering', () => {
    const key = randomBytes(32);
    const box = seal(key, 'hello');
    expect(open(key, box).toString()).toBe('hello');
    box[box.length - 1] ^= 1;
    expect(() => open(key, box)).toThrow();
  });

  it('creates the key once and unwraps it with the protector', () => {
    const d = tmp();
    const k1 = loadOrCreateKey(join(d, 'store.key'), fakeProtector);
    const k2 = loadOrCreateKey(join(d, 'store.key'), fakeProtector);
    expect(k1.equals(k2)).toBe(true);
    expect(readFileSync(join(d, 'store.key')).includes(Buffer.from(k1.toString('base64')))).toBe(false);
  });

  it('sealed JSON files are not plaintext', () => {
    const d = tmp();
    const f = new SealedJsonFile<{ token: string }>(join(d, 's.bin'), randomBytes(32));
    f.write({ token: 'secret-device-token' });
    expect(readFileSync(join(d, 's.bin')).includes(Buffer.from('secret-device-token'))).toBe(false);
    expect(f.read()).toEqual({ token: 'secret-device-token' });
  });
});

describe('OutboxStore — encrypted append-only JSONL', () => {
  it('persists entries and acks across restarts, in order', () => {
    const d = tmp();
    const key = randomBytes(32);
    const a = new OutboxStore(d, key);
    a.append('event', 'e1', { type: 'PUNCH_IN' });
    a.append('segment', 's1', { kind: 'WORK' });
    a.append('event', 'e2', { type: 'BREAK_START' });
    a.ack(['s1']);
    const raw = readFileSync(join(d, 'outbox.jsonl'), 'utf8');
    expect(raw).not.toContain('PUNCH_IN');

    const b = new OutboxStore(d, key);
    expect(b.queue.pending().map((e) => e.clientId)).toEqual(['e1', 'e2']);
    // Idempotent: the same clientId is never queued twice, even after restart.
    expect(b.append('event', 'e1', { type: 'PUNCH_IN' })).toBeNull();
  });

  it('skips a torn/corrupt line instead of failing', () => {
    const d = tmp();
    const key = randomBytes(32);
    const a = new OutboxStore(d, key);
    a.append('event', 'e1', {});
    appendFileSync(join(d, 'outbox.jsonl'), 'Zm9vYmFy\n');
    const b = new OutboxStore(d, key);
    expect(b.corruptLines).toBe(1);
    expect(b.queue.size).toBe(1);
  });

  it('stores screenshot blobs encrypted and removes them on ack', () => {
    const d = tmp();
    const key = randomBytes(32);
    const s = new OutboxStore(d, key);
    const jpeg = Buffer.from('JFIF-fake-image');
    s.putBlob('p1', jpeg);
    s.append('shot', 'p1', { capturedAt: 'x' });
    expect(s.getBlob('p1')!.equals(jpeg)).toBe(true);
    s.ack(['p1']);
    expect(s.getBlob('p1')).toBeNull();
  });

  it('drops entries past retention and compacts the file', () => {
    const d = tmp();
    const key = randomBytes(32);
    let now = 0;
    const s = new OutboxStore(d, key, () => now);
    s.append('event', 'old', {});
    now = 8 * 86_400_000;
    s.append('event', 'new', {});
    expect(s.prune(7).map((e) => e.clientId)).toEqual(['old']);
    const again = new OutboxStore(d, key, () => now);
    expect(again.queue.pending().map((e) => e.clientId)).toEqual(['new']);
  });

  it('a wrong key cannot read the queue', () => {
    const d = tmp();
    const s = new OutboxStore(d, randomBytes(32));
    s.append('event', 'e1', {});
    writeFileSync(join(d, 'extra'), '');
    const other = new OutboxStore(d, randomBytes(32));
    expect(other.queue.size).toBe(0);
  });
});
