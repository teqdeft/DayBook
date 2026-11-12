// Writes the small PDFs in this folder, by hand and with no dependencies, so anyone can see what each
// one holds: node tests/fixtures/pdf/make-fixtures.mjs (README.md says what they are for).
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const USER_PASSWORD = 'secret';
const FILE_ID = '00112233445566778899aabbccddeeff';
const PADDING = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
);

const out = (name) => new URL(name, import.meta.url);
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();

/** RC4, written out: OpenSSL 3 no longer offers it, and old PDF encryption needs nothing else. */
function rc4(key, data) {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 255;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const output = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n += 1) {
    i = (i + 1) & 255;
    j = (j + state[i]) & 255;
    [state[i], state[j]] = [state[j], state[i]];
    output[n] = data[n] ^ state[(state[i] + state[j]) & 255];
  }
  return output;
}

/** The standard security handler, revision 2 (40-bit RC4), with an owner password equal to the user's. */
function encryption(password) {
  const padded = Buffer.concat([Buffer.from(password, 'latin1'), PADDING]).subarray(0, 32);
  const owner = rc4(md5(padded).subarray(0, 5), padded);
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-44);
  const key = md5(padded, owner, permissions, Buffer.from(FILE_ID, 'hex')).subarray(0, 5);
  return {
    dictionary:
      '<< /Filter /Standard /V 1 /R 2 /P -44 ' +
      `/O <${owner.toString('hex')}> /U <${rc4(key, PADDING).toString('hex')}> >>`,
    /** Streams are encrypted with a key made from the file's key and the object's number. */
    encryptStream(number, data) {
      const objectKey = Buffer.from([
        number & 255,
        (number >> 8) & 255,
        (number >> 16) & 255,
        0,
        0,
      ]);
      return rc4(md5(key, objectKey).subarray(0, 10), data);
    },
  };
}

/**
 * Puts objects together into a file with a cross-reference table.
 * @param {Array<string | { dictionary?: string, stream: Buffer }>} objects numbered from 1; 1 is the
 *   catalog
 * @param {{ encrypt?: object }} [options] encrypt: from encryption(), added as one more object
 * @returns {Buffer}
 */
function buildPdf(objects, { encrypt } = {}) {
  const all = encrypt ? [...objects, encrypt.dictionary] : objects;
  const parts = [Buffer.from('%PDF-1.4\n')];
  let length = parts[0].length;
  const push = (part) => {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part, 'latin1');
    parts.push(buffer);
    length += buffer.length;
  };
  const offsets = all.map((object, index) => {
    const number = index + 1;
    const offset = length;
    if (typeof object === 'string') {
      push(`${number} 0 obj\n${object}\nendobj\n`);
    } else {
      const data = encrypt ? encrypt.encryptStream(number, object.stream) : object.stream;
      push(`${number} 0 obj\n<< ${object.dictionary ?? ''} /Length ${data.length} >>\nstream\n`);
      push(data);
      push('\nendstream\nendobj\n');
    }
    return offset;
  });
  const xref = length;
  const rows = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  const extra = encrypt ? ` /Encrypt ${all.length} 0 R /ID [<${FILE_ID}> <${FILE_ID}>]` : '';
  push(`xref\n0 ${all.length + 1}\n0000000000 65535 f \n${rows}`);
  push(`trailer\n<< /Size ${all.length + 1} /Root 1 0 R${extra} >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

/** A page's drawing: one line of Helvetica per string, top down. */
function textStream(lines) {
  const shown = lines.map((line) => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`).join('\n');
  return { stream: Buffer.from(`BT /F1 12 Tf 14 TL 72 720 Td\n${shown}\nET`, 'latin1') };
}

/** A document with one text page per entry of `pages`. */
function textPdf(pages, options) {
  const first = 4; // 1 catalog, 2 pages, 3 font
  const kids = pages.map((_, index) => `${first + index * 2} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((lines, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${first + index * 2 + 1} 0 R >>`,
      textStream(lines),
    );
  });
  return buildPdf(objects, options);
}

/** One page holding only a picture, as a scanner makes: no text layer. */
function scanPdf() {
  const pixels = Buffer.alloc(16 * 16);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 16) & 255;
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
    { stream: Buffer.from('q 400 0 0 400 106 196 cm /Im0 Do Q', 'latin1') },
    {
      dictionary:
        '/Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceGray /BitsPerComponent 8',
      stream: pixels,
    },
  ]);
}

const TWO_PAGES = [
  ['Scope for Acme Clinics.', 'Go-live is on 15 December.'],
  ['Payment provider still to be decided.', 'Acme sends the logo files by Friday.'],
];
const MANY_PAGES = Array.from({ length: 101 }, (_, index) => [`This is page ${index + 1}.`]);

writeFileSync(out('two-pages.pdf'), textPdf(TWO_PAGES));
writeFileSync(out('scan.pdf'), scanPdf());
writeFileSync(
  out('password.pdf'),
  textPdf([['Nobody reads this without the password.']], { encrypt: encryption(USER_PASSWORD) }),
);
writeFileSync(out('broken.pdf'), 'This file is called a PDF, but it is only this sentence.\n');
writeFileSync(out('101-pages.pdf'), textPdf(MANY_PAGES));
