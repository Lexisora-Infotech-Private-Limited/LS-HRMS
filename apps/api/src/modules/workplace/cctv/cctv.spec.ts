import { describe, expect, it } from 'vitest';
import { cameraTile, maskRtsp, nextHealth, signViewToken, verifyViewToken } from './cctv.rules';

describe('cctv rules', () => {
  it('never exposes RTSP credentials or paths', () => {
    expect(maskRtsp('rtsp://admin:S3cret@10.0.0.21:554/Streaming/Channels/101')).toBe('rtsp://***@10.0.0.21/…');
    expect(maskRtsp('rtsp://10.0.0.21/live')).toBe('rtsp://10.0.0.21/…');
    expect(maskRtsp('rtsps://cam.local')).toBe('rtsps://cam.local');
    expect(maskRtsp(null)).toBeNull();
  });
  it('tile kicker and meta follow the wireframe', () => {
    expect(cameraTile({ status: 'ONLINE', enabled: true, location: 'Ahmedabad HQ', lastSeen: '09:39' })).toEqual({ kicker: 'Live', meta: 'Ahmedabad HQ', live: true });
    expect(cameraTile({ status: 'OFFLINE', enabled: true, location: 'Ahmedabad HQ', lastSeen: '08:12' })).toEqual({ kicker: 'Offline', meta: 'Last seen 08:12', live: false });
    expect(cameraTile({ status: 'ONLINE', enabled: false, location: 'Parking', lastSeen: null }).kicker).toBe('Disabled');
    expect(cameraTile({ status: 'UNKNOWN', enabled: true, location: 'Parking', lastSeen: null }).kicker).toBe('Connecting');
  });
  it('goes offline after two failed probes and back online after one success', () => {
    const a = nextHealth({ status: 'ONLINE', failures: 0 }, false);
    expect(a).toMatchObject({ status: 'UNKNOWN', failures: 1, wentOffline: false });
    const b = nextHealth({ status: a.status, failures: a.failures }, false);
    expect(b).toMatchObject({ status: 'OFFLINE', wentOffline: true });
    expect(nextHealth({ status: 'OFFLINE', failures: 5 }, false).wentOffline).toBe(false);
    expect(nextHealth({ status: 'OFFLINE', failures: 5 }, true)).toMatchObject({ status: 'ONLINE', failures: 0 });
  });
  it('viewing tokens are bound to the session, path and expiry', () => {
    const secret = 'test-secret';
    const now = Date.now();
    const tok = signViewToken(secret, { sid: 's1', path: 't_abc_cam1', exp: now + 60_000 });
    expect(verifyViewToken(secret, tok, now)).toEqual({ sid: 's1', path: 't_abc_cam1', exp: now + 60_000 });
    expect(verifyViewToken('other', tok, now)).toBeNull();
    expect(verifyViewToken(secret, tok, now + 120_000)).toBeNull();
    expect(verifyViewToken(secret, `${tok}x`, now)).toBeNull();
  });
});
