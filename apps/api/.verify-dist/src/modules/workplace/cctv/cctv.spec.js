"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _vitest = require("vitest");
const _cctvrules = require("./cctv.rules");
(0, _vitest.describe)('cctv rules', ()=>{
    (0, _vitest.it)('never exposes RTSP credentials or paths', ()=>{
        (0, _vitest.expect)((0, _cctvrules.maskRtsp)('rtsp://admin:S3cret@10.0.0.21:554/Streaming/Channels/101')).toBe('rtsp://***@10.0.0.21/…');
        (0, _vitest.expect)((0, _cctvrules.maskRtsp)('rtsp://10.0.0.21/live')).toBe('rtsp://10.0.0.21/…');
        (0, _vitest.expect)((0, _cctvrules.maskRtsp)('rtsps://cam.local')).toBe('rtsps://cam.local');
        (0, _vitest.expect)((0, _cctvrules.maskRtsp)(null)).toBeNull();
    });
    (0, _vitest.it)('tile kicker and meta follow the wireframe', ()=>{
        (0, _vitest.expect)((0, _cctvrules.cameraTile)({
            status: 'ONLINE',
            enabled: true,
            location: 'Ahmedabad HQ',
            lastSeen: '09:39'
        })).toEqual({
            kicker: 'Live',
            meta: 'Ahmedabad HQ',
            live: true
        });
        (0, _vitest.expect)((0, _cctvrules.cameraTile)({
            status: 'OFFLINE',
            enabled: true,
            location: 'Ahmedabad HQ',
            lastSeen: '08:12'
        })).toEqual({
            kicker: 'Offline',
            meta: 'Last seen 08:12',
            live: false
        });
        (0, _vitest.expect)((0, _cctvrules.cameraTile)({
            status: 'ONLINE',
            enabled: false,
            location: 'Parking',
            lastSeen: null
        }).kicker).toBe('Disabled');
        (0, _vitest.expect)((0, _cctvrules.cameraTile)({
            status: 'UNKNOWN',
            enabled: true,
            location: 'Parking',
            lastSeen: null
        }).kicker).toBe('Connecting');
    });
    (0, _vitest.it)('goes offline after two failed probes and back online after one success', ()=>{
        const a = (0, _cctvrules.nextHealth)({
            status: 'ONLINE',
            failures: 0
        }, false);
        (0, _vitest.expect)(a).toMatchObject({
            status: 'UNKNOWN',
            failures: 1,
            wentOffline: false
        });
        const b = (0, _cctvrules.nextHealth)({
            status: a.status,
            failures: a.failures
        }, false);
        (0, _vitest.expect)(b).toMatchObject({
            status: 'OFFLINE',
            wentOffline: true
        });
        (0, _vitest.expect)((0, _cctvrules.nextHealth)({
            status: 'OFFLINE',
            failures: 5
        }, false).wentOffline).toBe(false);
        (0, _vitest.expect)((0, _cctvrules.nextHealth)({
            status: 'OFFLINE',
            failures: 5
        }, true)).toMatchObject({
            status: 'ONLINE',
            failures: 0
        });
    });
    (0, _vitest.it)('viewing tokens are bound to the session, path and expiry', ()=>{
        const secret = 'test-secret';
        const now = Date.now();
        const tok = (0, _cctvrules.signViewToken)(secret, {
            sid: 's1',
            path: 't_abc_cam1',
            exp: now + 60_000
        });
        (0, _vitest.expect)((0, _cctvrules.verifyViewToken)(secret, tok, now)).toEqual({
            sid: 's1',
            path: 't_abc_cam1',
            exp: now + 60_000
        });
        (0, _vitest.expect)((0, _cctvrules.verifyViewToken)('other', tok, now)).toBeNull();
        (0, _vitest.expect)((0, _cctvrules.verifyViewToken)(secret, tok, now + 120_000)).toBeNull();
        (0, _vitest.expect)((0, _cctvrules.verifyViewToken)(secret, `${tok}x`, now)).toBeNull();
    });
});

//# sourceMappingURL=cctv.spec.js.map