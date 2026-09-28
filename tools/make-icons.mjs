import fs from 'fs';
import zlib from 'zlib';
import path from 'path';

const __dirname = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1'));

// CRC table for PNG
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
  }
  crcTable[n] = c >>> 0;
}

function calculateCRC(data, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = ((crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff]) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  // CRC of type + data
  const crc = calculateCRC(chunk, 4, 8 + data.length);
  chunk.writeUInt32BE(crc, 8 + data.length);

  return chunk;
}

function createPNG(width, height, fillColor) {
  // Create raw pixel data: for each scanline, 1 byte filter + width * 4 bytes (RGBA)
  const scanlineLength = width * 4 + 1;
  const imageDataRaw = Buffer.allocUnsafe(scanlineLength * height);

  // Fill with color
  const [r, g, b, a] = fillColor;
  let pos = 0;
  for (let y = 0; y < height; y++) {
    imageDataRaw[pos++] = 0; // filter type (None)
    for (let x = 0; x < width; x++) {
      imageDataRaw[pos++] = r;
      imageDataRaw[pos++] = g;
      imageDataRaw[pos++] = b;
      imageDataRaw[pos++] = a;
    }
  }

  // Draw a dollar sign: simple rectangle frame + center line
  const margin = Math.floor(width * 0.25);
  const cw = width * 0.5; // center width
  const ch = width * 0.6; // center height
  const cx = width * 0.5;
  const cy = width * 0.5;

  const white = [255, 255, 255, 255];

  // Draw rectangle
  for (let y = Math.floor(cy - ch / 2); y < Math.floor(cy + ch / 2); y++) {
    for (let x = Math.floor(cx - cw / 2); x < Math.floor(cx + cw / 2); x++) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        const idx = y * scanlineLength + x * 4 + 1;
        if (x === Math.floor(cx - cw / 2) || x === Math.floor(cx + cw / 2 - 1) ||
            y === Math.floor(cy - ch / 2) || y === Math.floor(cy + ch / 2 - 1)) {
          imageDataRaw[idx] = white[0];
          imageDataRaw[idx + 1] = white[1];
          imageDataRaw[idx + 2] = white[2];
          imageDataRaw[idx + 3] = white[3];
        }
      }
    }
  }

  // Draw $ lines (horizontal)
  const lineY1 = Math.floor(cy - ch / 6);
  const lineY2 = Math.floor(cy + ch / 6);
  for (let x = Math.floor(cx - cw / 2 + 2); x < Math.floor(cx + cw / 2 - 2); x++) {
    if (lineY1 >= 0 && lineY1 < height) {
      const idx = lineY1 * scanlineLength + x * 4 + 1;
      imageDataRaw[idx] = white[0];
      imageDataRaw[idx + 1] = white[1];
      imageDataRaw[idx + 2] = white[2];
      imageDataRaw[idx + 3] = white[3];
    }
    if (lineY2 >= 0 && lineY2 < height) {
      const idx = lineY2 * scanlineLength + x * 4 + 1;
      imageDataRaw[idx] = white[0];
      imageDataRaw[idx + 1] = white[1];
      imageDataRaw[idx + 2] = white[2];
      imageDataRaw[idx + 3] = white[3];
    }
  }

  // Compress
  const compressed = zlib.deflateSync(imageDataRaw);

  // Build PNG
  const png = [];

  // Signature
  png.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  // IHDR chunk
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);  // bit depth
  ihdr.writeUInt8(6, 9);  // color type (RGBA)
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace
  png.push(createChunk('IHDR', ihdr));

  // IDAT chunk
  png.push(createChunk('IDAT', compressed));

  // IEND chunk
  png.push(createChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(png);
}

// Create icon directory if not exists
const iconDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconDir)) {
  fs.mkdirSync(iconDir, { recursive: true });
}

// Generate PNGs with primary color #0f6b5c
const primaryColor = [15, 107, 92, 255]; // #0f6b5c RGBA

const sizes = [
  { w: 192, h: 192, name: 'icon-192.png' },
  { w: 512, h: 512, name: 'icon-512.png' },
  { w: 512, h: 512, name: 'icon-maskable-512.png' },
  { w: 180, h: 180, name: 'apple-touch-icon.png' },
];

for (const { w, h, name } of sizes) {
  const png = createPNG(w, h, primaryColor);
  const filePath = path.join(iconDir, name);
  fs.writeFileSync(filePath, png);
  console.log(`✓ ${name} (${w}x${h})`);
}

// Ícono de la app de iPhone (1024x1024) si existe el proyecto de Xcode (npm run ios:sync lo crea).
const iosIcon = path.join(__dirname, '..', 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
if (fs.existsSync(path.dirname(iosIcon))) {
  fs.writeFileSync(iosIcon, createPNG(1024, 1024, primaryColor));
  console.log('✓ ios AppIcon-512@2x.png (1024x1024)');
}

console.log('\nIcons generated successfully!');
