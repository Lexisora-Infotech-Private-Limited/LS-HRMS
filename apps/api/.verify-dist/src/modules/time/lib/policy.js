/**
 * Pure policy resolution (spec-time A5, D3, E3). The effective rule for a punch is
 * `policy[audience]` AND the location's punch mode, plus the geo-fence when enforced.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get desktopPunchAllowed () {
        return desktopPunchAllowed;
    },
    get distanceM () {
        return distanceM;
    },
    get effectiveAudience () {
        return effectiveAudience;
    },
    get evaluatePunch () {
        return evaluatePunch;
    },
    get geoCheck () {
        return geoCheck;
    },
    get modeNote () {
        return modeNote;
    },
    get normalizePolicy () {
        return normalizePolicy;
    },
    get trackerMode () {
        return trackerMode;
    },
    get webPunchAllowed () {
        return webPunchAllowed;
    }
});
function effectiveAudience(workMode, opts = {}) {
    if (opts.wfhOverride) return 'REMOTE';
    if (workMode === 'OFFICE') return 'OFFICE';
    if (workMode === 'HYBRID' && opts.biometricToday) return 'OFFICE';
    return 'REMOTE';
}
function distanceM(lat1, lng1, lat2, lng2) {
    const R = 6_371_000;
    const toRad = (d)=>d * Math.PI / 180;
    const dPhi = toRad(lat2 - lat1);
    const dLambda = toRad(lng2 - lng1);
    const a = Math.sin(dPhi / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}
function geoCheck(location, geo) {
    const required = !!location && !location.isRemote && location.geoFenceWebPunch && location.lat != null && location.lng != null && !!location.geoRadiusM;
    if (!required) return {
        geoStatus: 'NOT_REQUIRED',
        distanceM: null
    };
    if (geo?.lat == null || geo?.lng == null) return {
        geoStatus: 'UNAVAILABLE',
        distanceM: null
    };
    const acc = geo.accuracyM ?? 50;
    const d = Math.round(distanceM(geo.lat, geo.lng, location.lat, location.lng));
    if (acc > 200) return {
        geoStatus: 'LOW_ACCURACY',
        distanceM: d
    };
    return {
        geoStatus: d - Math.min(acc, 50) <= location.geoRadiusM ? 'INSIDE' : 'OUTSIDE',
        distanceM: d
    };
}
function evaluatePunch(p) {
    const none = {
        geoStatus: 'NOT_REQUIRED',
        distanceM: null
    };
    if (p.source === 'BIOMETRIC' || p.source === 'SYSTEM' || p.source === 'REGULARIZATION') return {
        allowed: true,
        geo: none
    };
    if (p.direction === 'OUT') {
        if (p.openSessionSource === 'BIOMETRIC') return {
            allowed: false,
            code: 'PUNCH_NOT_ALLOWED',
            message: 'Punch out at the biometric sensor',
            geo: none
        };
        // A web/desktop session may always be closed from web or desktop (cross-channel).
        if (p.openSessionSource === 'WEB' || p.openSessionSource === 'DESKTOP' || p.openSessionSource === 'MOBILE') return {
            allowed: true,
            geo: none
        };
    }
    const channelAllowed = p.source === 'DESKTOP' ? p.policy.allowDesktopPunch : p.policy.allowWebPunch;
    const biometricOnly = p.location?.punchMode === 'BIOMETRIC_ONLY';
    if (p.policy.biometricMandatory || !channelAllowed || biometricOnly) {
        const message = p.audience === 'OFFICE' || biometricOnly ? p.source === 'DESKTOP' ? 'Office mode: desktop punch is off · punch in with the biometric sensor' : 'Office mode: punch in with the biometric sensor' : p.source === 'DESKTOP' ? 'Desktop punch is disabled by HR policy' : 'Web punch is disabled by HR policy · use the desktop tracker';
        return {
            allowed: false,
            code: 'PUNCH_NOT_ALLOWED',
            message,
            geo: none
        };
    }
    if (p.source === 'WEB' || p.source === 'MOBILE') {
        const geo = geoCheck(p.location, p.geo);
        if (geo.geoStatus === 'UNAVAILABLE') return {
            allowed: false,
            code: 'GEO_REQUIRED',
            message: 'Location permission required',
            geo
        };
        if (geo.geoStatus === 'LOW_ACCURACY') return {
            allowed: false,
            code: 'GEO_LOW_ACCURACY',
            message: 'Location accuracy is too low · try again near a window',
            geo
        };
        if (geo.geoStatus === 'OUTSIDE') return {
            allowed: false,
            code: 'GEOFENCE_OUTSIDE',
            message: `You are outside the allowed area (${geo.distanceM} m from ${p.location.name})`,
            geo
        };
        return {
            allowed: true,
            geo
        };
    }
    return {
        allowed: true,
        geo: none
    };
}
function webPunchAllowed(policy, location) {
    return !policy.biometricMandatory && policy.allowWebPunch && location?.punchMode !== 'BIOMETRIC_ONLY';
}
function desktopPunchAllowed(policy, location) {
    return !policy.biometricMandatory && policy.allowDesktopPunch && location?.punchMode !== 'BIOMETRIC_ONLY';
}
function trackerMode(policy, location) {
    if (desktopPunchAllowed(policy, location)) return 'PUNCH';
    if (policy.autoIdleEnabled || policy.screenshotsEnabled) return 'MONITOR_ONLY';
    return 'DISABLED';
}
function modeNote(audience, policy, location) {
    if (audience === 'OFFICE' || location?.punchMode === 'BIOMETRIC_ONLY') return 'Office · biometric punch';
    if (webPunchAllowed(policy, location)) return 'Remote · web punch allowed';
    if (desktopPunchAllowed(policy, location)) return 'Remote · desktop tracker';
    return 'Remote · punching disabled';
}
function normalizePolicy(next, changed) {
    const out = {
        ...next
    };
    const cleared = [];
    if (changed.biometricMandatory === true) {
        if (out.allowWebPunch) cleared.push('allowWebPunch');
        if (out.allowDesktopPunch) cleared.push('allowDesktopPunch');
        out.allowWebPunch = false;
        out.allowDesktopPunch = false;
    } else if ((changed.allowWebPunch === true || changed.allowDesktopPunch === true) && out.biometricMandatory) {
        out.biometricMandatory = false;
        cleared.push('biometricMandatory');
    }
    if (!out.screenshotsEnabled && out.blurScreenshots) {
        out.blurScreenshots = false;
        cleared.push('blurScreenshots');
    }
    if (!out.autoIdleEnabled && out.deductIdleFromPayroll) {
        out.deductIdleFromPayroll = false;
        cleared.push('deductIdleFromPayroll');
    }
    if (changed.blurScreenshots === true && !out.screenshotsEnabled) return {
        policy: out,
        autoCleared: cleared,
        error: 'Blur needs screenshots switched on'
    };
    if (changed.deductIdleFromPayroll === true && !out.autoIdleEnabled) return {
        policy: out,
        autoCleared: cleared,
        error: 'Idle deduction needs auto-idle switched on'
    };
    if (!out.biometricMandatory && !out.allowWebPunch && !out.allowDesktopPunch) {
        return {
            policy: out,
            autoCleared: cleared,
            error: 'Each column needs at least one punch method'
        };
    }
    return {
        policy: out,
        autoCleared: cleared
    };
}

//# sourceMappingURL=policy.js.map