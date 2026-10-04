"use strict";
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
    get rateLimiter () {
        return rateLimiter;
    },
    get sendFile () {
        return sendFile;
    }
});
function sendFile(res, data, filename, mime, inline = false) {
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
}
function rateLimiter(limit, windowMs) {
    const hits = new Map();
    return (key)=>{
        const now = Date.now();
        const h = hits.get(key);
        if (!h || now - h.start > windowMs) {
            hits.set(key, {
                start: now,
                n: 1
            });
            if (hits.size > 5000) {
                for (const [k, v] of hits)if (now - v.start > windowMs) hits.delete(k);
            }
            return true;
        }
        h.n++;
        return h.n <= limit;
    };
}

//# sourceMappingURL=http.js.map