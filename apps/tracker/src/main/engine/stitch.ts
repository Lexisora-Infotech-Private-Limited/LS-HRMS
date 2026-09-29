/**
 * Horizontal stitching of raw 32-bit bitmaps (one per display) into one frame.
 * Frames must already share the same height (the capture service resizes them);
 * shorter frames are top-aligned and padded with black.
 */
export interface RawFrame {
  buf: Uint8Array;
  width: number;
  height: number;
}

export function stitchHorizontal(frames: readonly RawFrame[]): RawFrame {
  if (frames.length === 0) throw new Error('No frames to stitch');
  if (frames.length === 1) return frames[0];
  const width = frames.reduce((a, f) => a + f.width, 0);
  const height = Math.max(...frames.map((f) => f.height));
  const out = new Uint8Array(width * height * 4);
  // Opaque black background (alpha = 255) for padding.
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  let x0 = 0;
  for (const f of frames) {
    const rowBytes = f.width * 4;
    for (let y = 0; y < f.height; y++) {
      const src = f.buf.subarray(y * rowBytes, (y + 1) * rowBytes);
      out.set(src, (y * width + x0) * 4);
    }
    x0 += f.width;
  }
  return { buf: out, width, height };
}

/** Target size for each display so the stitched frame stays within maxW × maxH. */
export function fitFrames(
  sizes: readonly { width: number; height: number }[],
  maxW = 3840,
  maxH = 1080,
): { width: number; height: number }[] {
  if (!sizes.length) return [];
  const h = Math.min(maxH, Math.min(...sizes.map((s) => s.height)));
  let scaled = sizes.map((s) => ({ width: Math.max(1, Math.round((s.width * h) / s.height)), height: h }));
  const total = scaled.reduce((a, s) => a + s.width, 0);
  if (total > maxW) {
    const k = maxW / total;
    scaled = scaled.map((s) => ({ width: Math.max(1, Math.floor(s.width * k)), height: Math.max(1, Math.floor(s.height * k)) }));
  }
  return scaled;
}
