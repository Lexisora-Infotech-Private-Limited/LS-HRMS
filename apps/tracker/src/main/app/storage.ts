import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TrackerMode, TrackerPolicyResponse, TrackerTask, TrackerToday } from '@lexisora/shared';
import type { Prefs } from '@tracker-shared/ipc';
import type { EngineSnapshot } from '../engine/engine';
import { atomicWrite, loadOrCreateKey, open, SealedJsonFile, seal, type KeyProtector } from '../services/crypto-box';

/**
 * Everything the tracker keeps on disk, under app.getPath('userData'):
 *   key.bin          256-bit data key, wrapped by the OS (safeStorage → DPAPI on Windows)
 *   device.bin       device credential (token) — safeStorage-encrypted JSON
 *   state.bin        engine snapshot (open session, today's segments) — AES-256-GCM
 *   cache.bin        policy / tasks / today baseline / ack log — AES-256-GCM
 *   prefs.json       non-sensitive UI preferences
 *   outbox/          encrypted append-only JSONL queue + sealed screenshot blobs (OutboxStore)
 *   logs/            rolling diagnostic log
 */

export type Credentials = {
  serverUrl: string;
  workspace: string;
  deviceId: string;
  deviceToken: string;
  hostname: string;
  os: string;
  pairedAt: string | null;
  mode: TrackerMode;
  modeMessage: string | null;
  user: { name: string; initials: string; email: string; empCode: string; workMode: string; tenantName: string };
};

export type StoredPrefs = Prefs & {
  serverUrl: string | null;
  lastWorkspace: string;
  lastEmail: string;
  lastPairedEmail: string | null;
  widgetPos: { x: number; y: number } | null;
  trayHintShown: boolean;
  firstRunDone: boolean;
};

export const DEFAULT_PREFS: StoredPrefs = {
  launchAtStartup: true,
  showTrayWidget: true,
  breakReminders: true,
  serverUrl: null,
  lastWorkspace: 'lexisora.hrms.app',
  lastEmail: '',
  lastPairedEmail: null,
  widgetPos: null,
  trayHintShown: false,
  firstRunDone: false,
};

export type CachedToday = TrackerToday & { requestedAt: number; fetchedAt: number };

export type CacheDoc = {
  v: 1;
  policy: TrackerPolicyResponse | null;
  tasks: TrackerTask[];
  today: CachedToday | null;
  /** Task metadata seen in any list or summary (keeps "By task" labels for finished tasks). */
  known: Record<string, { key: string; title: string; projectName?: string }>;
  /** Entries acked after the cached baseline was requested: clientId → [ackedAt, isShot]. */
  acks: Record<string, [number, boolean]>;
  lastSyncAt: number | null;
  /** Start of the session this device is tracking (own punch-in or attach). */
  sessionStartedAt: number | null;
  /** IST date whose "Add to weekly timesheet" still has to reach the server. */
  pendingConfirm: string | null;
};

export const emptyCache = (): CacheDoc => ({
  v: 1,
  policy: null,
  tasks: [],
  today: null,
  known: {},
  acks: {},
  lastSyncAt: null,
  sessionStartedAt: null,
  pendingConfirm: null,
});

type SecretEnvelope = { v: 1; kind: 'os' | 'sealed'; data: string };

export class LocalStore {
  readonly key: Buffer;
  readonly snapshot: SealedJsonFile<EngineSnapshot>;
  readonly cache: SealedJsonFile<CacheDoc>;
  private readonly prefsPath: string;
  private readonly credPath: string;

  constructor(
    readonly dir: string,
    private readonly protector: KeyProtector,
  ) {
    this.key = loadOrCreateKey(join(dir, 'key.bin'), protector);
    this.snapshot = new SealedJsonFile<EngineSnapshot>(join(dir, 'state.bin'), this.key);
    this.cache = new SealedJsonFile<CacheDoc>(join(dir, 'cache.bin'), this.key);
    this.prefsPath = join(dir, 'prefs.json');
    this.credPath = join(dir, 'device.bin');
  }

  get outboxDir() {
    return join(this.dir, 'outbox');
  }

  get logDir() {
    return join(this.dir, 'logs');
  }

  readPrefs(): StoredPrefs {
    try {
      if (!existsSync(this.prefsPath)) return { ...DEFAULT_PREFS };
      const raw = JSON.parse(readFileSync(this.prefsPath, 'utf8')) as Partial<StoredPrefs>;
      return { ...DEFAULT_PREFS, ...raw };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  writePrefs(p: StoredPrefs) {
    atomicWrite(this.prefsPath, JSON.stringify(p, null, 2));
  }

  readCache(): CacheDoc {
    const c = this.cache.read();
    return c && c.v === 1 ? { ...emptyCache(), ...c } : emptyCache();
  }

  /** The device token is encrypted with safeStorage (DPAPI) when available, else sealed with the data key. */
  readCredentials(): Credentials | null {
    try {
      if (!existsSync(this.credPath)) return null;
      const env = JSON.parse(readFileSync(this.credPath, 'utf8')) as SecretEnvelope;
      const buf = Buffer.from(env.data, 'base64');
      const json = env.kind === 'os' ? this.protector.decrypt(buf) : open(this.key, buf).toString('utf8');
      const c = JSON.parse(json) as Credentials;
      return c?.deviceToken ? c : null;
    } catch {
      return null;
    }
  }

  writeCredentials(c: Credentials) {
    const json = JSON.stringify(c);
    const env: SecretEnvelope = this.protector.available()
      ? { v: 1, kind: 'os', data: this.protector.encrypt(json).toString('base64') }
      : { v: 1, kind: 'sealed', data: seal(this.key, json).toString('base64') };
    atomicWrite(this.credPath, JSON.stringify(env));
  }

  clearCredentials() {
    rmSync(this.credPath, { force: true });
  }
}
