// Generates build/icon.ico (16–256 px) for electron-builder / NSIS from the same drawing
// the app uses for its tray and window icons (src/main/windows/icons.ts): the Classical
// accent-outlined square with a clock hand. Pure Node — no image tooling needed.
//
//   node scripts/make-icon.mjs      (run automatically by `pnpm dist:win`)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCENT = [0xb6, 0x82, 0x35];
const PLATE = [0xf3, 0xf2, 0xf2];

/** Top-down BGRA bitmap, same geometry as drawIcon() in src/main/windows/icons.ts (without a status dot). */
function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const ea = buf[i + 3] / 255;
    const na = a / 255;
    const oa = na + ea * (1 - na);
    if (oa <= 0) return;
    buf[i] = Math.round((b * na + buf[i] * ea * (1 - na)) / oa);
    buf[i + 1] = Math.round((g * na + buf[i + 1] * ea * (1 - na)) / oa);
    buf[i + 2] = Math.round((r * na + buf[i + 2] * ea * (1 - na)) / oa);
    buf[i + 3] = Math.round(oa * 255);
  };
  const stroke = Math.max(2, Math.round(size / 10));
  const pad = Math.round(size * 0.12);
  for (let y = pad; y < size - pad; y++) for (let x = pad; x < size - pad; x++) put(x, y, PLATE, 235);
  for (let y = pad; y < size - pad; y++)
    for (let x = pad; x < size - pad; x++) {
      const edge = x < pad + stroke || x >= size - pad - stroke || y < pad + stroke || y >= size - pad - stroke;
      if (edge) put(x, y, ACCENT);
    }
  const cx = Math.round(size / 2) - Math.round(size * 0.06);
  const cy = Math.round(size / 2) - Math.round(size * 0.06);
  for (let k = 0; k < Math.round(size * 0.22); k++)
    for (let w = 0; w < Math.max(1, Math.round(stroke * 0.7)); w++) {
      put(cx + w, cy - k, ACCENT);
      put(cx + k, cy + w, ACCENT);
    }
  return buf;
}

/** One ICO image as a 32-bit BMP (BITMAPINFOHEADER, bottom-up rows, empty AND mask). */
function bmpEntry(size) {
  const px = draw(size);
  const maskRow = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  const rows = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) px.copy(rows, (size - 1 - y) * size * 4, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([header, rows, Buffer.alloc(maskRow * size)]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(bmpEntry);
const dir = Buffer.alloc(6 + 16 * sizes.length);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(sizes.length, 4);
let offset = dir.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, e);
  dir.writeUInt8(s >= 256 ? 0 : s, e + 1);
  dir.writeUInt8(0, e + 2);
  dir.writeUInt8(0, e + 3);
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(images[i].length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.ico');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([dir, ...images]));
console.log(`Wrote ${out} (${sizes.join(', ')} px)`);
