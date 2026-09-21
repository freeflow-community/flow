// Generate the small raster icons the shell needs and cannot draw at run time
// (the main process has no canvas): a tray icon for Windows/Linux and the
// red-dot overlay Windows shows on the taskbar button when unread > 0.
// Pure Node — a minimal PNG encoder over zlib — so nothing is added to the
// dependency tree for two tiny files. Outputs are committed; rerun on change.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** RGBA pixels → PNG bytes. */
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Anti-aliased filled circle coverage for a pixel. */
function circle(x, y, cx, cy, r) {
  let inside = 0;
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
    const dx = x + (sx + 0.5) / 4 - cx, dy = y + (sy + 0.5) / 4 - cy;
    if (dx * dx + dy * dy <= r * r) inside++;
  }
  return inside / 16;
}

// Tray: Flow's purple disc with a white "F" made of three bars.
for (const size of [16, 32]) {
  const s = size / 16;
  const bars = [
    { x: 5, y: 4, w: 2, h: 8 },   // stem
    { x: 5, y: 4, w: 6, h: 2 },   // top
    { x: 5, y: 7.5, w: 4.5, h: 1.8 }, // middle
  ];
  const buf = png(size, size, (x, y) => {
    const cov = circle(x, y, size / 2, size / 2, size / 2 - 0.5 * s);
    let white = 0;
    for (const b of bars) {
      const inX = x >= b.x * s && x < (b.x + b.w) * s, inY = y >= b.y * s && y < (b.y + b.h) * s;
      if (inX && inY) white = 1;
    }
    const a = Math.round(cov * 255);
    return white ? [255, 255, 255, a] : [107, 48, 175, a]; // #6b30af, the web theme accent
  });
  writeFileSync(resolve(out, size === 16 ? 'tray.png' : 'tray@2x.png'), buf);
}

// Windows overlay: a red dot on transparent, 16×16 (the size Windows expects).
writeFileSync(resolve(out, 'overlay-unread.png'), png(16, 16, (x, y) => {
  const cov = circle(x, y, 8, 8, 6.5);
  return [220, 38, 38, Math.round(cov * 255)];
}));
console.log('icons written to', out);
