// A tiny zip writer for the Word fixtures and the reader's tests, with nothing but node:zlib. Entries
// are deflated or stored, and can carry a data descriptor after their data (as zip tools that stream
// write them, with zeros in the local header), so the reader has to take sizes from the central
// directory.
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** The CRC-32 a zip stores for each entry. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 11; // 11 Nov 2026
const UTF8_NAMES = 0x0800;
const DATA_DESCRIPTOR = 0x0008;

function header(size, fields) {
  const buffer = Buffer.alloc(size);
  for (const [offset, bytes, value] of fields) {
    if (bytes === 2) buffer.writeUInt16LE(value, offset);
    else buffer.writeUInt32LE(value, offset);
  }
  return buffer;
}

/** One entry's local part (header, name, data, descriptor) and its central directory record. */
function entryParts({ name, data, method }, { dataDescriptor, offset }) {
  const nameBytes = Buffer.from(name, 'utf8');
  const raw = Buffer.from(data);
  const stored = method === 8 ? deflateRawSync(raw) : raw;
  const crc = crc32(raw);
  const flags = UTF8_NAMES | (dataDescriptor ? DATA_DESCRIPTOR : 0);
  const known = (value) => (dataDescriptor ? 0 : value);
  const common = [
    [6, 2, flags],
    [8, 2, method],
    [12, 2, DOS_DATE],
  ];
  const local = header(30, [
    [0, 4, 0x04034b50],
    [4, 2, 20],
    ...common,
    [14, 4, known(crc)],
    [18, 4, known(stored.length)],
    [22, 4, known(raw.length)],
    [26, 2, nameBytes.length],
  ]);
  const descriptor = dataDescriptor
    ? [
        header(16, [
          [0, 4, 0x08074b50],
          [4, 4, crc],
          [8, 4, stored.length],
          [12, 4, raw.length],
        ]),
      ]
    : [];
  const central = header(46, [
    [0, 4, 0x02014b50],
    [4, 2, 20],
    [6, 2, 20],
    [8, 2, flags],
    [10, 2, method],
    [14, 2, DOS_DATE],
    [16, 4, crc],
    [20, 4, stored.length],
    [24, 4, raw.length],
    [28, 2, nameBytes.length],
    [42, 4, offset],
  ]);
  return { local: [local, nameBytes, stored, ...descriptor], central: [central, nameBytes] };
}

/**
 * A zip file.
 * @param {Array<{ name: string, data: string | Uint8Array, method?: 0 | 8 }>} entries
 * @param {{ method?: 0 | 8, dataDescriptor?: boolean, comment?: string }} [options] method: for
 *   entries that don't say (8, deflate, by default); dataDescriptor: sizes and CRC after the data
 * @returns {Buffer}
 */
export function writeZip(entries, { method = 8, dataDescriptor = false, comment = '' } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const parts = entryParts({ method, ...entry }, { dataDescriptor, offset });
    locals.push(...parts.local);
    centrals.push(...parts.central);
    offset += parts.local.reduce((sum, part) => sum + part.length, 0);
  }
  const directory = Buffer.concat(centrals);
  const commentBytes = Buffer.from(comment, 'utf8');
  const end = header(22, [
    [0, 4, 0x06054b50],
    [8, 2, entries.length],
    [10, 2, entries.length],
    [12, 4, directory.length],
    [16, 4, offset],
    [20, 2, commentBytes.length],
  ]);
  return Buffer.concat([...locals, directory, end, commentBytes]);
}
