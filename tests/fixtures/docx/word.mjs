// The parts of a small Word .docx, as Word writes them, for the fixtures and the reader's tests.
// Only word/document.xml is ever read: the header, footer and comments are here to prove that.
import { writeZip } from './zip.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const MAIN_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A part's XML with the namespaces Word declares on its root. */
const part = (root, inner) =>
  `${XML_DECLARATION}<${root} xmlns:mc="${MC}" xmlns:r="${R}" xmlns:w="${W}" mc:Ignorable="w14">${inner}</${root}>`;

/** A paragraph of plain runs. */
export const paragraph = (...runs) =>
  `<w:p>${runs.map((text) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`).join('')}</w:p>`;

const CONTENT_TYPES =
  `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  `<Override PartName="/word/document.xml" ContentType="${MAIN_TYPE}.document.main+xml"/>` +
  `<Override PartName="/word/header1.xml" ContentType="${MAIN_TYPE}.header+xml"/>` +
  `<Override PartName="/word/footer1.xml" ContentType="${MAIN_TYPE}.footer+xml"/>` +
  `<Override PartName="/word/comments.xml" ContentType="${MAIN_TYPE}.comments+xml"/>` +
  '</Types>';

const relationships = (rows) =>
  `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  rows
    .map(
      ([id, type, target]) =>
        `<Relationship Id="${id}" Type="${RELATIONSHIP}/${type}" Target="${target}"/>`,
    )
    .join('') +
  '</Relationships>';

/** Text that lives outside word/document.xml, so it must never be read. */
export const OTHER_PARTS_TEXT = Object.freeze({
  header: 'Acme Clinics confidential header',
  footer: 'Footer with the page number',
  comment: 'Reviewer comment: check the dates',
});

const SECTION =
  '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/>' +
  '<w:footerReference w:type="default" r:id="rId2"/>' +
  '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

/** word/document.xml around a body. */
export const documentXml = (body) => part('w:document', `<w:body>${body}${SECTION}</w:body>`);

/**
 * Every part of a .docx whose document has `body`.
 * @param {string} body the XML inside w:body
 * @param {{ document?: boolean }} [options] document: false leaves word/document.xml out
 * @returns {Array<{ name: string, data: string }>}
 */
export function docxEntries(body, { document = true } = {}) {
  const entries = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    {
      name: '_rels/.rels',
      data: relationships([['rId1', 'officeDocument', 'word/document.xml']]),
    },
    document && { name: 'word/document.xml', data: documentXml(body) },
    {
      name: 'word/_rels/document.xml.rels',
      data: relationships([
        ['rId1', 'header', 'header1.xml'],
        ['rId2', 'footer', 'footer1.xml'],
        ['rId3', 'comments', 'comments.xml'],
      ]),
    },
    { name: 'word/header1.xml', data: part('w:hdr', paragraph(OTHER_PARTS_TEXT.header)) },
    { name: 'word/footer1.xml', data: part('w:ftr', paragraph(OTHER_PARTS_TEXT.footer)) },
    {
      name: 'word/comments.xml',
      data: part(
        'w:comments',
        `<w:comment w:id="0" w:author="Riya Kapoor">${paragraph(OTHER_PARTS_TEXT.comment)}</w:comment>`,
      ),
    },
  ];
  return entries.filter(Boolean);
}

/**
 * A whole .docx file.
 * @param {string} body the XML inside w:body
 * @param {{ document?: boolean, method?: 0 | 8, dataDescriptor?: boolean }} [options] see
 *   docxEntries and writeZip
 * @returns {Buffer}
 */
export function docxFile(body, { document, ...zip } = {}) {
  return writeZip(docxEntries(body, { document }), zip);
}

/**
 * The first bytes of an OLE compound file: what Word writes for an old .doc, and for a .docx saved
 * with a password (its zip is encrypted inside one). Only the header and the names of its streams.
 * @param {string[]} streams e.g. ['EncryptionInfo', 'EncryptedPackage']
 * @returns {Buffer}
 */
export function oleFile(streams) {
  const headerBytes = Buffer.alloc(512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(headerBytes);
  headerBytes.writeUInt16LE(0x003e, 24); // minor version
  headerBytes.writeUInt16LE(0x0003, 26); // major version 3
  headerBytes.writeUInt16LE(0xfffe, 28); // little endian
  headerBytes.writeUInt16LE(9, 30); // 512-byte sectors
  headerBytes.writeUInt16LE(6, 32); // 64-byte mini sectors
  const directory = Buffer.alloc(512);
  ['Root Entry', ...streams].forEach((name, index) => {
    directory.write(name, index * 128, 'utf16le');
    directory.writeUInt16LE((name.length + 1) * 2, index * 128 + 64);
  });
  return Buffer.concat([headerBytes, directory]);
}
