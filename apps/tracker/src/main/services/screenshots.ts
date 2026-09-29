import { desktopCapturer, nativeImage, screen, type NativeImage } from 'electron';
import { fitFrames, stitchHorizontal } from '../engine/stitch';

export type Capture = { jpeg: Buffer; thumbDataUrl: string; displays: number; width: number; height: number; blurred: boolean };

/**
 * Screen capture via desktopCapturer (main process): all displays stitched side by side
 * (max 3840×1080) or the primary display only, JPEG ~70 %. When the policy asks for blur
 * it is applied here, on the device, so unblurred pixels never leave the machine
 * (downscale to ~1/16 then upscale — a cheap, irreversible box blur).
 */
export async function captureScreens(opts: { allMonitors: boolean; blur: boolean }): Promise<Capture> {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const px = (d: Electron.Display) => ({
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
  });
  const largest = displays.map(px).reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b), px(primary));
  const scale = Math.min(1, 1920 / largest.width);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(largest.width * scale), height: Math.round(largest.height * scale) },
  });
  let images: NativeImage[] = sources.map((s) => s.thumbnail).filter((t) => !t.isEmpty());
  if (!opts.allMonitors && sources.length > 1) {
    const match = sources.find((s) => s.display_id === String(primary.id));
    images = [(match ?? sources[0]).thumbnail];
  }
  if (!images.length) throw new Error('Screen capture returned no image');

  let frame: NativeImage;
  if (images.length === 1) {
    frame = images[0];
    const sz = frame.getSize();
    if (sz.width > 1920) frame = frame.resize({ width: 1920, quality: 'good' });
  } else {
    const targets = fitFrames(images.map((i) => i.getSize()));
    const raw = images.map((img, i) => {
      const r = img.resize({ width: targets[i].width, height: targets[i].height, quality: 'good' });
      const s = r.getSize();
      return { buf: new Uint8Array(r.toBitmap()), width: s.width, height: s.height };
    });
    const st = stitchHorizontal(raw);
    frame = nativeImage.createFromBitmap(Buffer.from(st.buf), { width: st.width, height: st.height });
  }

  if (opts.blur) {
    const { width, height } = frame.getSize();
    const small = frame.resize({ width: Math.max(24, Math.round(width / 16)), quality: 'good' });
    frame = small.resize({ width, height, quality: 'best' });
  }
  const { width, height } = frame.getSize();
  return {
    jpeg: frame.toJPEG(70),
    thumbDataUrl: frame.resize({ width: 160, quality: 'good' }).toDataURL(),
    displays: images.length,
    width,
    height,
    blurred: opts.blur,
  };
}
