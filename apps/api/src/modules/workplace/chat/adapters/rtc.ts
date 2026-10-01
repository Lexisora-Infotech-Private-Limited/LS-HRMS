import { Logger } from '@nestjs/common';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { env } from '../../../../config/env';

/** Realtime audio/video provider (spec §5.7). */
export interface RtcProvider {
  readonly name: 'livekit' | 'local';
  /** Public signalling URL the browser connects to (null for the local stub). */
  readonly url: string | null;
  issueToken(p: { room: string; identity: string; name: string; ttlSec?: number }): Promise<string | null>;
  endRoom(room: string): Promise<void>;
}

/** LiveKit (self-hosted or cloud) — chosen when LIVEKIT_URL / _API_KEY / _API_SECRET are set. */
export class LiveKitProvider implements RtcProvider {
  readonly name = 'livekit' as const;
  private readonly log = new Logger('LiveKit');
  constructor(
    readonly url: string,
    private readonly key: string,
    private readonly secret: string,
  ) {}

  async issueToken(p: { room: string; identity: string; name: string; ttlSec?: number }): Promise<string> {
    const at = new AccessToken(this.key, this.secret, { identity: p.identity, name: p.name, ttl: p.ttlSec ?? 4 * 3600 });
    at.addGrant({ roomJoin: true, room: p.room, canPublish: true, canSubscribe: true, canPublishData: true });
    return at.toJwt();
  }

  async endRoom(room: string): Promise<void> {
    try {
      const http = this.url.replace(/^ws/, 'http');
      await new RoomServiceClient(http, this.key, this.secret).deleteRoom(room);
    } catch (e) {
      this.log.debug(`deleteRoom ${room}: ${(e as Error).message}`);
    }
  }
}

/** Without LiveKit the web app shows a local camera/screen preview and the "Calls need LiveKit configured" note. */
export class LocalRtcProvider implements RtcProvider {
  readonly name = 'local' as const;
  readonly url = null;
  async issueToken(): Promise<null> {
    return null;
  }
  async endRoom(): Promise<void> {
    /* nothing to tear down */
  }
}

export function rtcProviderFromEnv(): RtcProvider {
  if (env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) return new LiveKitProvider(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  return new LocalRtcProvider();
}
