import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const size = 200;
const scale = 4;
const width = size * scale;
const height = size * scale;
const pixels = new Uint8ClampedArray(width * height * 4);

const colors = {
  mauve: [136, 57, 239],
  blue: [30, 102, 245],
  sky: [4, 165, 229],
  green: [64, 160, 43],
  card: [255, 255, 255],
  ink: [76, 79, 105],
  softLine: [172, 176, 190],
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function mix(a, b, t) {
  return a.map((value, index) => value + (b[index] - value) * t);
}

function blendPixel(x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= width || y >= height || alpha <= 0) return;

  const index = (Math.floor(y) * width + Math.floor(x)) * 4;
  const sourceAlpha = clamp(alpha);
  const targetAlpha = pixels[index + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);

  if (outAlpha === 0) return;

  pixels[index] = Math.round((color[0] * sourceAlpha + pixels[index] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[index + 1] = Math.round((color[1] * sourceAlpha + pixels[index + 1] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[index + 2] = Math.round((color[2] * sourceAlpha + pixels[index + 2] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[index + 3] = Math.round(outAlpha * 255);
}

function roundedRectCoverage(px, py, x, y, w, h, r) {
  const cx = clamp(px, x + r, x + w - r);
  const cy = clamp(py, y + r, y + h - r);
  const distance = Math.hypot(px - cx, py - cy);
  return clamp(r + 0.7 - distance);
}

function drawRoundedRect(x, y, w, h, r, fill, alpha = 1) {
  const sx = Math.floor((x - 2) * scale);
  const sy = Math.floor((y - 2) * scale);
  const ex = Math.ceil((x + w + 2) * scale);
  const ey = Math.ceil((y + h + 2) * scale);

  for (let py = sy; py < ey; py += 1) {
    for (let px = sx; px < ex; px += 1) {
      const ux = (px + 0.5) / scale;
      const uy = (py + 0.5) / scale;
      const coverage = roundedRectCoverage(ux, uy, x, y, w, h, r);
      if (coverage <= 0) continue;
      const color = typeof fill === 'function' ? fill(ux, uy) : fill;
      blendPixel(px, py, color, alpha * coverage);
    }
  }
}

function drawCircle(cx, cy, radius, color, alpha = 1) {
  const sx = Math.floor((cx - radius - 2) * scale);
  const sy = Math.floor((cy - radius - 2) * scale);
  const ex = Math.ceil((cx + radius + 2) * scale);
  const ey = Math.ceil((cy + radius + 2) * scale);

  for (let py = sy; py < ey; py += 1) {
    for (let px = sx; px < ex; px += 1) {
      const ux = (px + 0.5) / scale;
      const uy = (py + 0.5) / scale;
      const coverage = clamp(radius + 0.7 - Math.hypot(ux - cx, uy - cy));
      if (coverage > 0) blendPixel(px, py, color, alpha * coverage);
    }
  }
}

function lineDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function drawLine(x1, y1, x2, y2, stroke, color, alpha = 1) {
  const radius = stroke / 2;
  const sx = Math.floor((Math.min(x1, x2) - radius - 2) * scale);
  const sy = Math.floor((Math.min(y1, y2) - radius - 2) * scale);
  const ex = Math.ceil((Math.max(x1, x2) + radius + 2) * scale);
  const ey = Math.ceil((Math.max(y1, y2) + radius + 2) * scale);

  for (let py = sy; py < ey; py += 1) {
    for (let px = sx; px < ex; px += 1) {
      const ux = (px + 0.5) / scale;
      const uy = (py + 0.5) / scale;
      const coverage = clamp(radius + 0.65 - lineDistance(ux, uy, x1, y1, x2, y2));
      if (coverage > 0) blendPixel(px, py, color, alpha * coverage);
    }
  }
}

function drawCheck(points, stroke, color, alpha = 1) {
  for (let index = 0; index < points.length - 1; index += 1) {
    drawLine(points[index][0], points[index][1], points[index + 1][0], points[index + 1][1], stroke, color, alpha);
  }
}

function drawBlurredShadow(x, y, w, h, r) {
  for (let i = 11; i > 0; i -= 1) {
    drawRoundedRect(x - i * 0.35, y + i * 0.6, w + i * 0.7, h + i * 0.45, r + i * 0.2, [17, 17, 27], 0.018);
  }
}

function adler32(data) {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const buffer = Buffer.concat([typeBuffer, data]);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(buffer), 8 + data.length);
  return result;
}

function encodePng(rgba, pngWidth, pngHeight) {
  const raw = Buffer.alloc((pngWidth * 4 + 1) * pngHeight);
  for (let y = 0; y < pngHeight; y += 1) {
    const rowStart = y * (pngWidth * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.subarray(y * pngWidth * 4, (y + 1) * pngWidth * 4)).copy(raw, rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(pngWidth, 0);
  ihdr.writeUInt32BE(pngHeight, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const srgb = Buffer.from([0]);
  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('sRGB', srgb),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

drawBlurredShadow(22, 22, 156, 156, 42);

drawRoundedRect(24, 20, 152, 156, 40, (x, y) => {
  const diagonal = clamp((x + y - 44) / 304);
  const base = mix(colors.mauve, colors.blue, diagonal);
  return mix(base, colors.sky, clamp((y - 30) / 170) * 0.28);
});

drawRoundedRect(51, 38, 98, 124, 22, colors.card, 0.94);
drawRoundedRect(62, 51, 76, 9, 4.5, [239, 241, 245], 1);

const rows = [
  { y: 77, color: colors.sky, width: 42, done: false },
  { y: 101, color: colors.mauve, width: 38, done: true },
  { y: 126, color: colors.green, width: 48, done: false },
];

for (const row of rows) {
  drawCircle(70, row.y, 6.5, row.color, 0.95);
  if (row.done) {
    drawLine(66.8, row.y, 69.4, row.y + 3.2, 2.2, colors.card, 1);
    drawLine(69.4, row.y + 3.2, 74.2, row.y - 3.8, 2.2, colors.card, 1);
  }
  drawRoundedRect(86, row.y - 4, row.width, 8, 4, colors.softLine, 0.48);
}

drawCheck(
  [
    [79, 126],
    [97, 144],
    [134, 96],
  ],
  14,
  [255, 255, 255],
  0.96,
);
drawCheck(
  [
    [79, 126],
    [97, 144],
    [134, 96],
  ],
  7,
  [64, 160, 43],
  1,
);

const finalPixels = new Uint8ClampedArray(size * size * 4);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const sums = [0, 0, 0, 0];
    for (let sy = 0; sy < scale; sy += 1) {
      for (let sx = 0; sx < scale; sx += 1) {
        const index = ((y * scale + sy) * width + x * scale + sx) * 4;
        for (let c = 0; c < 4; c += 1) sums[c] += pixels[index + c];
      }
    }

    const out = (y * size + x) * 4;
    for (let c = 0; c < 4; c += 1) finalPixels[out + c] = Math.round(sums[c] / (scale * scale));
  }
}

writeFileSync('public/logo.png', encodePng(finalPixels, size, size));
