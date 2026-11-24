// Writes the small files in this folder for the demo's acme-store (db/demo/projectFiles.js), by
// hand and with no dependencies, so anyone can see what each one holds:
//   node db/demo/files/make-files.mjs
// A PNG drawn in code (a checkout page with its error), one-page PDFs of plain text and a Word
// .docx of three paragraphs. Nothing in them runs: no scripts, links or macros, each a few KB.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { crc32, writeZip } from '../../../tests/fixtures/docx/zip.mjs';

const out = (name) => new URL(name, import.meta.url);

// ---------- PNG ----------

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** A width x height RGB picture; `paint(x, y)` gives each pixel's [r, g, b]. */
function png(width, height, paint) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3); // filter 0, then the pixels
    for (let x = 0; x < width; x += 1) row.set(paint(x, y), 1 + x * 3);
    rows.push(row);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inside = (x, y, [left, top, right, bottom]) =>
  x >= left && x < right && y >= top && y < bottom;

/** A checkout page: the top bar, a red error line on its banner, three fields, the Pay button. */
const SHAPES = [
  { box: [0, 0, 400, 28], rgb: [25, 28, 64] },
  { box: [48, 60, 220, 68], rgb: [220, 38, 38] },
  { box: [40, 52, 360, 76], rgb: [253, 226, 226] },
  { box: [40, 96, 360, 120], rgb: [241, 243, 248] },
  { box: [40, 132, 360, 156], rgb: [241, 243, 248] },
  { box: [40, 168, 360, 192], rgb: [241, 243, 248] },
  { box: [120, 216, 280, 248], rgb: [67, 76, 229] },
];

const checkoutPicture = (x, y) =>
  SHAPES.find(({ box }) => inside(x, y, box))?.rgb ?? [255, 255, 255];

// ---------- PDF ----------

/** One page of Helvetica lines, with a cross-reference table, as a PDF reader expects. */
function textPdf(lines) {
  const shown = lines.map((line) => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`).join('\n');
  const content = `BT /F1 12 Tf 16 TL 72 720 Td\n${shown}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(text, 'latin1');
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(text, 'latin1');
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text, 'latin1');
}

// ---------- Word .docx ----------

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** A .docx with one paragraph per line, the three parts Word needs and nothing else. */
function wordFile(lines) {
  const body = lines
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`)
    .join('');
  return writeZip([
    {
      name: '[Content_Types].xml',
      data:
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="${TYPE}"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `${XML}<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${OFFICE}" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: 'word/document.xml',
      data: `${XML}<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    },
  ]);
}

// ---------- the files ----------

writeFileSync(out('card-payment-error.png'), png(400, 270, checkoutPicture));
writeFileSync(
  out('checkout-error-steps.pdf'),
  textPdf([
    'Checkout error: steps to see it',
    '1. Add any product to the cart.',
    '2. Go to the checkout and pay with a test card.',
    '3. The last step shows "Payment failed. Try again." and the order is not saved.',
  ]),
);
writeFileSync(
  out('zoom-notes.docx'),
  wordFile([
    'Product image zoom',
    'Zoom opens on a click on the product photo, up to twice its size.',
    'On phones, pinch to zoom; the photo never leaves the screen.',
  ]),
);
writeFileSync(
  out('acme-brand-guide.pdf'),
  textPdf([
    'Acme Retail brand guide (demo)',
    'Logo: keep clear space around it the height of the A.',
    'Colours: Acme green, white and dark grey.',
    'Type: one sans serif for headings and text.',
  ]),
);
writeFileSync(
  out('acme-store-contract-signed.pdf'),
  textPdf([
    'acme-store contract (demo)',
    'Client: Acme Retail',
    'This is sample text for the demo data. It is not a real contract.',
  ]),
);
console.log('Wrote the demo files.');
