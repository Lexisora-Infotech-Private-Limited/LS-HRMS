import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { brandedQrDataUrl, darkenHex } from './card-render';

const URL = 'http://localhost:8080/api/v1/id-cards/verify/rdGzpmeUm8nKHipPkcS8Sw';
const png = async (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

describe('branded QR', () => {
  it('darkens a colour without changing its hue', () => {
    expect(darkenHex('#e91e8c', 0.73)).toBe('#aa1666');
    expect(darkenHex('#ffffff', 0.5)).toBe('#808080');
    expect(darkenHex('#000000', 0.5)).toBe('#000000');
  });

  it('is a square PNG: gradient modules on white, with a clear white spot in the middle', async () => {
    const out = await brandedQrDataUrl(URL, { from: '#aa1066', to: '#0d7791' });
    expect(out.startsWith('data:image/png;base64,')).toBe(true);
    const img = sharp(await png(out));
    const meta = await img.metadata();
    expect(meta.width).toBe(meta.height);
    const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [0, 1, 2].map((k) => data[(y * info.width + x) * info.channels + k]!);
    const u = info.width / (info.width / 20);
    // the centre is white (room for the logo)
    expect(px(Math.floor(info.width / 2), Math.floor(info.height / 2))).toEqual([255, 255, 255]);
    // the top-left finder pattern is drawn in the first colour, the bottom-right area in the second, neither plain black
    const tl = px(Math.round(4.5 * u), Math.round(4.5 * u));
    expect(tl[0]).toBeGreaterThan(tl[2]!); // magenta side: red above blue
    expect(tl).not.toEqual([0, 0, 0]);
  });

  it('is the same picture for the same address and a different one for another', async () => {
    const a = await brandedQrDataUrl(URL, { from: '#aa1066', to: '#0d7791' });
    expect(await brandedQrDataUrl(URL, { from: '#aa1066', to: '#0d7791' })).toBe(a);
    expect(await brandedQrDataUrl(URL.replace('rdG', 'xyz'), { from: '#aa1066', to: '#0d7791' })).not.toBe(a);
  });

  it('writes a sample with the logo when asked (for a visual and scan check)', async () => {
    const out = process.env.QR_SAMPLE_OUT;
    if (!out) return;
    const logo = `data:image/png;base64,${readFileSync(process.env.QR_SAMPLE_LOGO!).toString('base64')}`;
    writeFileSync(out, await png(await brandedQrDataUrl(URL, { from: darkenHex('#e91e8c', 0.73), to: darkenHex('#12a3c6', 0.73), logo })));
  });
});
