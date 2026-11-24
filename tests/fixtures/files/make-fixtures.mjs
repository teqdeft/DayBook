// Writes the small files in this folder, by hand and with nothing but `node:zlib`, so anyone can see
// what each one holds: node tests/fixtures/files/make-fixtures.mjs (README.md says what they are
// for). Every file is plain and harmless: no script, no event attributes, no links, no real
// program, since the deploy branch copies tests/ to a host whose malware scanner reads them.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const out = (name) => new URL(name, import.meta.url);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 as PNG chunks use it. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A 48 x 48 RGB PNG: a navy square with a white border and a green dot, like a small logo.
 * @returns {Buffer}
 */
function logoPng() {
  const size = 48;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = [0]; // filter: none
    for (let x = 0; x < size; x += 1) {
      const border = x < 4 || y < 4 || x >= size - 4 || y >= size - 4;
      const dot = (x - 24) ** 2 + (y - 24) ** 2 < 100;
      row.push(...(border ? [255, 255, 255] : dot ? [34, 160, 90] : [21, 24, 51]));
    }
    rows.push(...row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, truecolour, deflate, no filter method, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Writes bits into bytes, most significant first, with JPEG's byte stuffing (FF -> FF 00). */
class BitWriter {
  bytes = [];
  current = 0;
  count = 0;

  write(value, length) {
    for (let bit = length - 1; bit >= 0; bit -= 1) {
      this.current = (this.current << 1) | ((value >> bit) & 1);
      this.count += 1;
      if (this.count === 8) this.flushByte();
    }
  }

  flushByte() {
    this.bytes.push(this.current);
    if (this.current === 0xff) this.bytes.push(0);
    this.current = 0;
    this.count = 0;
  }

  /** Pads the last byte with ones, as the standard asks. */
  end() {
    while (this.count !== 0) this.write(1, 1);
    return Buffer.from(this.bytes);
  }
}

const segment = (marker, data) => {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(data.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, Buffer.from(data)]);
};

/**
 * A 64 x 48 baseline grayscale JPEG: one flat shade per 8 x 8 block, a diagonal gradient. Only DC
 * coefficients are coded, with two small Huffman tables: DC categories 0 to 11 as 4-bit codes,
 * and AC holding only end-of-block as "0".
 * @returns {Buffer}
 */
function photoJpeg() {
  const width = 64;
  const height = 48;
  const across = width / 8;
  const down = height / 8;
  const jfif = [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const quant = [0, ...new Array(64).fill(1)]; // table 0, 8-bit, every step 1
  const frame = [8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0];
  const dcTable = [
    0x00,
    0,
    0,
    0,
    12,
    ...new Array(12).fill(0),
    ...Array.from({ length: 12 }, (_, i) => i),
  ];
  const acTable = [0x10, 1, ...new Array(15).fill(0), 0x00];
  const scan = [1, 1, 0x00, 0, 63, 0];

  const bits = new BitWriter();
  let previous = 0;
  for (let by = 0; by < down; by += 1) {
    for (let bx = 0; bx < across; bx += 1) {
      const shade = Math.round(70 + (150 * (bx + by)) / (across + down - 2));
      const dc = 8 * (shade - 128); // the DCT's DC term of a flat block, quantised by 1
      const diff = dc - previous;
      previous = dc;
      const category = diff === 0 ? 0 : Math.floor(Math.log2(Math.abs(diff))) + 1;
      bits.write(category, 4);
      if (category > 0) bits.write(diff > 0 ? diff : diff - 1 + (1 << category), category);
      bits.write(0, 1); // end of block
    }
  }
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, jfif),
    segment(0xdb, quant),
    segment(0xc0, frame),
    segment(0xc4, dcTable),
    segment(0xc4, acTable),
    segment(0xda, scan),
    bits.end(),
    Buffer.from([0xff, 0xd9]),
  ]);
}

const FILES = {
  'logo.png': logoPng(),
  'photo.jpg': photoJpeg(),
  'wrong-bytes.png': 'This is plain text with a .png name, not a picture.\n',
  'drawing.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">' +
    '<rect width="40" height="40" fill="#3355cc"/></svg>\n',
  'page.html': '<!doctype html><title>Test</title><p>Test page</p>\n',
  'setup.exe': 'Plain text file\n', // 16 bytes, named like a program
  'notes.txt': 'Notes for the checkout test.\nCard payments work.\n',
  'empty.txt': '',
};

for (const [name, content] of Object.entries(FILES)) writeFileSync(out(name), content);
console.log(`Wrote ${Object.keys(FILES).length} files to tests/fixtures/files.`);
