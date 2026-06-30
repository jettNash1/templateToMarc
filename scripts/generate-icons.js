import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../public/icons');
mkdirSync(outDir, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPng(size) {
  const width = size;
  const height = size;
  const rowSize = width * 3 + 1;
  const raw = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 3;
      const edge = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      raw[px] = edge ? 26 : 45;
      raw[px + 1] = edge ? 86 : 125;
      raw[px + 2] = edge ? 118 : 168;
    }
  }

  const compressed = deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunks = [
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ];

  return Buffer.concat([signature, ...chunks]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  const crcInput = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

for (const size of [16, 48, 128]) {
  writeFileSync(resolve(outDir, `icon${size}.png`), createPng(size));
}

console.log('Icons generated in public/icons/');
