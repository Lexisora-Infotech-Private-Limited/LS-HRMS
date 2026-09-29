import { nativeImage, type NativeImage } from 'electron';

/**
 * Tray / window icons drawn in code (no binary assets): the wireframe's accent
 * outlined square with a status dot. Dot colours follow spec T7:
 *   Working accent-400 · Idle neutral-400 · Break neutral-100 · Out neutral-500
 */
export const DOT = {
  WORKING: '#e1ad66',
  IDLE: '#bab6b6',
  BREAK: '#f8f4f4',
  OUT: '#9b9797',
} as const;
export type DotState = keyof typeof DOT;

const ACCENT = '#b68235';

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Raw BGRA bitmap (Windows / Chromium native order). */
export function drawIcon(size: number, dot: string | null): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x: number, y: number, [r, g, b]: [number, number, number], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // simple "over" blend onto whatever is there
    const ea = buf[i + 3] / 255;
    const na = a / 255;
    const oa = na + ea * (1 - na);
    if (oa <= 0) return;
    buf[i] = Math.round((b * na + buf[i] * ea * (1 - na)) / oa);
    buf[i + 1] = Math.round((g * na + buf[i + 1] * ea * (1 - na)) / oa);
    buf[i + 2] = Math.round((r * na + buf[i + 2] * ea * (1 - na)) / oa);
    buf[i + 3] = Math.round(oa * 255);
  };
  const accent = hex(ACCENT);
  const stroke = Math.max(2, Math.round(size / 10));
  const pad = Math.round(size * 0.12);
  // background plate (light) so the icon reads on dark taskbars
  const plate = hex('#f3f2f2');
  for (let y = pad; y < size - pad; y++) for (let x = pad; x < size - pad; x++) put(x, y, plate, 235);
  // accent outline
  for (let y = pad; y < size - pad; y++)
    for (let x = pad; x < size - pad; x++) {
      const edge = x < pad + stroke || x >= size - pad - stroke || y < pad + stroke || y >= size - pad - stroke;
      if (edge) put(x, y, accent);
    }
  // inner tick mark (a small clock hand)
  const cx = Math.round(size / 2) - Math.round(size * 0.06);
  const cy = Math.round(size / 2) - Math.round(size * 0.06);
  for (let k = 0; k < Math.round(size * 0.22); k++) {
    for (let w = 0; w < Math.max(1, Math.round(stroke * 0.7)); w++) {
      put(cx + w, cy - k, accent);
      put(cx + k, cy + w, accent);
    }
  }
  if (dot) {
    const r = size * 0.2;
    const ox = size - r - 1;
    const oy = size - r - 1;
    const border = hex('#2d2b2b');
    const fill = hex(dot);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - ox, y + 0.5 - oy);
        if (d <= r + 0.5) put(x, y, border);
        if (d <= r - Math.max(1, size / 32)) put(x, y, fill);
      }
  }
  return buf;
}

const cache = new Map<string, NativeImage>();

export function trayIcon(state: DotState): NativeImage {
  const key = `tray:${state}`;
  if (!cache.has(key)) {
    const img = nativeImage.createFromBitmap(drawIcon(32, DOT[state]), { width: 32, height: 32, scaleFactor: 2 });
    cache.set(key, img);
  }
  return cache.get(key)!;
}

export function appIcon(): NativeImage {
  if (!cache.has('app')) cache.set('app', nativeImage.createFromBitmap(drawIcon(64, null), { width: 64, height: 64 }));
  return cache.get('app')!;
}
