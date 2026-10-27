/**
 * Generates the extension icons into public/icons/ without any image library:
 * a rounded teal square with a white ring and a red "record" dot.
 *
 * Deterministic, so the PNGs can be committed and regenerated at will.
 *   node scripts/gen-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const SIZES = [16, 32, 48, 128];

// ---- tiny PNG encoder (RGBA, 8-bit, no interlace) ----

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
};

const encodePng = (size, pixels /* Uint8Array RGBA */) => {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// ---- drawing with 4x supersampling for smooth edges ----

const TEAL_A = [13, 148, 136];
const TEAL_B = [20, 184, 166];
const WHITE = [255, 255, 255];
const RED = [220, 38, 38];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const sampleColor = (x, y, size) => {
  // x, y in [0, size)
  const r = size * 0.22; // corner radius
  const cx = size / 2;
  const cy = size / 2;

  // rounded square mask
  const dx = Math.max(Math.abs(x - cx) - (size / 2 - r), 0);
  const dy = Math.max(Math.abs(y - cy) - (size / 2 - r), 0);
  if (Math.hypot(dx, dy) > r) return null;

  const dist = Math.hypot(x - cx, y - cy) / size; // 0 .. ~0.7
  const ringOuter = 0.31;
  const ringInner = 0.23;
  const dotR = 0.14;

  if (dist <= dotR) return RED;
  if (dist >= ringInner && dist <= ringOuter) return WHITE;
  const t = (x + y) / (2 * size);
  return mix(TEAL_A, TEAL_B, t);
};

const render = (size) => {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sampleColor(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, size);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      }
      const n = SS * SS;
      const cov = a / n / 255;
      const i = (y * size + x) * 4;
      // un-premultiply by coverage so edge pixels keep the true colour
      px[i] = cov > 0 ? Math.round(r / n / cov) : 0;
      px[i + 1] = cov > 0 ? Math.round(g / n / cov) : 0;
      px[i + 2] = cov > 0 ? Math.round(b / n / cov) : 0;
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
};

for (const size of SIZES) {
  const file = resolve(outDir, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`[gen-icons] wrote ${file}`);
}
