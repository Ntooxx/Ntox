import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "web", "icons");

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const GLYPH = ["X.....X", "XX....X", "X.X...X", "X..X..X", "X...X.X", "X....XX", "X.....X"];

function hex(color) {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
    255,
  ];
}

function roundedRectInside(x, y, size, radius) {
  const min = radius;
  const max = size - 1 - radius;
  const cx = x < min ? min : x > max ? max : x;
  const cy = y < min ? min : y > max ? max : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function renderIcon(size, { rounded, glyphRatio, background, glyph }) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg = hex(background);
  const fg = hex(glyph);
  const radius = Math.round(size * 0.22);
  const grid = GLYPH.length;
  const glyphSize = Math.round(size * glyphRatio);
  const cell = glyphSize / grid;
  const origin = (size - glyphSize) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      if (rounded && !roundedRectInside(x, y, size, radius)) continue;

      const col = Math.floor((x - origin) / cell);
      const row = Math.floor((y - origin) / cell);
      const on =
        x >= origin &&
        y >= origin &&
        col >= 0 &&
        col < grid &&
        row >= 0 &&
        row < grid &&
        GLYPH[row][col] === "X";

      const pixel = on ? fg : bg;
      rgba[offset] = pixel[0];
      rgba[offset + 1] = pixel[1];
      rgba[offset + 2] = pixel[2];
      rgba[offset + 3] = 255;
    }
  }

  return encodePng(size, size, rgba);
}

const DARK = "#151613";
const ACCENT = "#5eead4";

const targets = [
  { file: "icon-192.png", size: 192, opts: { rounded: true, glyphRatio: 0.66, background: DARK, glyph: ACCENT } },
  { file: "icon-512.png", size: 512, opts: { rounded: true, glyphRatio: 0.66, background: DARK, glyph: ACCENT } },
  { file: "maskable-512.png", size: 512, opts: { rounded: false, glyphRatio: 0.5, background: DARK, glyph: ACCENT } },
  { file: "apple-touch-icon.png", size: 180, opts: { rounded: false, glyphRatio: 0.6, background: DARK, glyph: ACCENT } },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const target of targets) {
  const png = renderIcon(target.size, target.opts);
  writeFileSync(join(OUT_DIR, target.file), png);
  console.log(`  web/icons/${target.file} (${target.size}x${target.size}, ${png.length} bytes)`);
}
