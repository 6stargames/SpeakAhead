/**
 * Generate the application icons.
 *
 * Written as a script rather than committed as opaque binaries so the artwork
 * is reviewable and reproducible. No image dependency: a PNG is a zlib stream
 * with a handful of length-prefixed, CRC-checked chunks, which is less code
 * than adding a toolchain for it.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle, for cheap anti-aliasing. */
function roundedRectDistance(x, y, cx, cy, halfWidth, halfHeight, radius) {
  const dx = Math.abs(x - cx) - (halfWidth - radius);
  const dy = Math.abs(y - cy) - (halfHeight - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function blend(target, offset, [r, g, b], alpha) {
  if (alpha <= 0) return;
  const a = Math.min(1, alpha);
  target[offset] = Math.round(target[offset] * (1 - a) + r * a);
  target[offset + 1] = Math.round(target[offset + 1] * (1 - a) + g * a);
  target[offset + 2] = Math.round(target[offset + 2] * (1 - a) + b * a);
  target[offset + 3] = Math.max(target[offset + 3], Math.round(255 * a));
}

/**
 * A speech bubble with three dots: the universal mark for "someone is about to
 * say something", which is exactly what this device is for.
 *
 * @param {number} size
 * @param {boolean} maskable Fill the whole canvas so platform masks can crop.
 */
function drawIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const navy = [11, 17, 32];
  const white = [255, 255, 255];
  const accent = [122, 160, 255];

  const padding = maskable ? 0 : size * 0.06;
  const half = size / 2 - padding;
  const backgroundRadius = maskable ? size / 2 : size * 0.22;

  // Bubble geometry, expressed relative to the safe zone so the maskable
  // variant keeps the artwork inside the 40% platform crop.
  const scale = maskable ? 0.62 : 0.76;
  const bubbleHalfWidth = (size * scale) / 2;
  const bubbleHalfHeight = (size * scale * 0.72) / 2;
  const bubbleCx = size / 2;
  const bubbleCy = size / 2 - size * 0.035;
  const bubbleRadius = size * 0.1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      const background = roundedRectDistance(px, py, size / 2, size / 2, half, half, backgroundRadius);
      blend(rgba, offset, navy, -background);

      const bubble = roundedRectDistance(
        px,
        py,
        bubbleCx,
        bubbleCy,
        bubbleHalfWidth,
        bubbleHalfHeight,
        bubbleRadius,
      );

      // Tail: a triangle hanging from the lower-left of the bubble.
      const tailX = bubbleCx - bubbleHalfWidth * 0.34;
      const tailTop = bubbleCy + bubbleHalfHeight - 1;
      const tailHeight = size * scale * 0.2;
      const tailHalf = size * scale * 0.11;
      const withinTail =
        py >= tailTop &&
        py <= tailTop + tailHeight &&
        Math.abs(px - tailX) <= tailHalf * (1 - (py - tailTop) / tailHeight);

      blend(rgba, offset, white, Math.min(1, -bubble));
      if (withinTail) blend(rgba, offset, white, 1);

      // Three dots: the composition indicator.
      const dotRadius = size * scale * 0.062;
      const spacing = bubbleHalfWidth * 0.62;
      for (let index = -1; index <= 1; index += 1) {
        const distance = Math.hypot(px - (bubbleCx + index * spacing), py - bubbleCy);
        const colour = index === 1 ? accent : navy;
        blend(rgba, offset, colour, dotRadius - distance);
      }
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];

for (const [name, size, maskable] of targets) {
  const png = drawIcon(size, maskable);
  writeFileSync(resolve(OUT_DIR, name), png);
  console.log(`[icons] ${name} (${size}×${size}, ${(png.length / 1024).toFixed(1)} kB)`);
}
