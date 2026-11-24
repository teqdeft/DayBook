// Picture headers (CONTRACT 27, Finish step 3): whether a finished file is a picture Daybook may
// show inline, and its size in pixels, from its first bytes only (no decoding). PNG, GIF and WebP
// are read from the first 64 KB; a JPEG's segments are walked with positional reads up to 1 MB in,
// since EXIF, XMP, ICC and Photoshop segments often come before the SOF. Over 40 megapixels, or
// bytes that don't match the extension, is not a picture. Pure and browser-safe (no imports).

/** The most pixels a picture shown inside Daybook may have. */
export const MAX_PICTURE_PIXELS = 40_000_000;

const HEAD_BYTES = 65_536;
const JPEG_SCAN_BYTES = 1_048_576;
const NOT_A_PICTURE = Object.freeze({ isPicture: false, width: null, height: null });

const ascii = (bytes, start, length) =>
  String.fromCharCode(...bytes.subarray(start, start + length));
const be16 = (b, i) => (b[i] << 8) | b[i + 1];
const be32 = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

function pngSize(b) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || signature.some((byte, i) => b[i] !== byte)) return null;
  if (ascii(b, 12, 4) !== 'IHDR') return null;
  return { width: be32(b, 16), height: be32(b, 20) };
}

function gifSize(b) {
  if (b.length < 10 || !['GIF87a', 'GIF89a'].includes(ascii(b, 0, 6))) return null;
  return { width: le16(b, 6), height: le16(b, 8) };
}

function webpSize(b) {
  if (b.length < 25 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
    const height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
    return { width, height };
  }
  if (chunk === 'VP8X' && b.length >= 30)
    return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) };
  return null;
}

// Start-of-frame markers (baseline, progressive, lossless...), not DHT (C4), JPG (C8) or DAC (CC).
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
// Markers without a length: TEM and RST0 to RST7.
const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

/**
 * Walks a JPEG's segments (each 4-byte marker and length, then the segment is skipped) to the SOF.
 * @param {(position: number, length: number) => Promise<Uint8Array>} read
 */
async function jpegSize(read) {
  const start = await read(0, 3);
  if (start.length < 3 || start[0] !== 0xff || start[1] !== 0xd8 || start[2] !== 0xff) return null;
  let position = 2;
  while (position < JPEG_SCAN_BYTES) {
    const head = await read(position, 4);
    if (head.length < 2 || head[0] !== 0xff) return null;
    const marker = head[1];
    if (marker === 0xff) {
      position += 1; // a fill byte before the marker
      continue;
    }
    if (STANDALONE.has(marker)) {
      position += 2;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda || head.length < 4) return null;
    const length = be16(head, 2);
    if (length < 2) return null;
    if (SOF.has(marker)) {
      const frame = await read(position + 4, 5);
      if (frame.length < 5) return null;
      return { width: be16(frame, 3), height: be16(frame, 1) };
    }
    position += 2 + length;
  }
  return null;
}

const MATCHERS = { png: pngSize, gif: gifSize, webp: webpSize };

/**
 * Reads a file's header: a picture is a PNG, JPEG, GIF or WebP whose bytes match its extension,
 * with a width and height above 0 and at most 40,000,000 pixels.
 * @param {(position: number, length: number) => Promise<Uint8Array>} read positional reads; may
 *   answer fewer bytes at the end of the file
 * @param {string} ext the stored extension
 * @returns {Promise<{ isPicture: boolean, width: number | null, height: number | null }>}
 */
export async function readPicture(read, ext) {
  const kind = String(ext ?? '').toLowerCase();
  let size = null;
  if (kind === 'jpg' || kind === 'jpeg') size = await jpegSize(read);
  else if (Object.hasOwn(MATCHERS, kind)) size = MATCHERS[kind](await read(0, HEAD_BYTES));
  if (!size || size.width < 1 || size.height < 1) return NOT_A_PICTURE;
  if (size.width * size.height > MAX_PICTURE_PIXELS) return NOT_A_PICTURE;
  return { isPicture: true, width: size.width, height: size.height };
}

/**
 * `readPicture` over bytes already in memory (tests, a header the caller holds).
 * @param {Uint8Array} bytes
 * @param {string} ext
 */
export function readPictureFromBytes(bytes, ext) {
  const read = async (position, length) => bytes.subarray(position, position + length);
  return readPicture(read, ext);
}
