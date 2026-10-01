import type { Response } from 'express';

/** Sends a generated document (PDF / CSV) as a download or inline. */
export function sendFile(res: Response, data: Buffer | string, filename: string, mime: string, inline = false) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(data);
}

/** Tiny fixed-window rate limiter for public endpoints (per key, e.g. IP). */
export function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { start: number; n: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) {
      hits.set(key, { start: now, n: 1 });
      if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
      return true;
    }
    h.n++;
    return h.n <= limit;
  };
}
