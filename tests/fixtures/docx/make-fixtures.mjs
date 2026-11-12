// Writes the small Word files in this folder, by hand and with nothing but node:zlib, so anyone can
// see what each one holds: node tests/fixtures/docx/make-fixtures.mjs (README.md says what they are
// for). NORMAL_TEXT is the text Daybook must read from normal.docx, exactly.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { docxFile, oleFile, paragraph } from './word.mjs';

const run = (inner) => `<w:r>${inner}</w:r>`;
const text = (value) => `<w:t xml:space="preserve">${value}</w:t>`;
const cell = (...paragraphs) =>
  `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${paragraphs.join('')}</w:tc>`;
const row = (...cells) => `<w:tr>${cells.join('')}</w:tr>`;
const REVISION = 'w:author="Riya Kapoor" w:date="2026-11-10T09:00:00Z"';

/** Everything the reader must handle, in the order Word would write it. */
export const NORMAL_BODY = [
  '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>' + run(text('Scope for Acme Clinics')) + '</w:p>',
  '<w:p>' +
    run(text('Go-live is on ')) +
    run('<w:rPr><w:b/></w:rPr>' + text('15 December')) +
    run(text('.')) +
    '</w:p>',
  // A tab stop in the paragraph's properties is not a tab; the w:tab in the run is.
  '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="2880"/></w:tabs></w:pPr>' +
    run(text('Owner')) +
    run('<w:tab/>' + text('Riya Kapoor')) +
    '</w:p>',
  '<w:p>' +
    run(
      text('Patients can book a visit.') +
        '<w:br/>' +
        text('They can move or cancel it.') +
        '<w:cr/>' +
        text('Reminders go by SMS.'),
    ) +
    '</w:p>',
  paragraph('Design &amp; build. Prices are in &#x20B9; and &#8377;, &lt;not&gt; dollars.'),
  // A deleted run (with a tab in it) and an inserted one: only the insertion is read.
  '<w:p>' +
    run(text('Launch is in ')) +
    `<w:del w:id="1" ${REVISION}><w:r><w:tab/><w:delText>November</w:delText></w:r></w:del>` +
    `<w:ins w:id="2" ${REVISION}>${run(text('December'))}</w:ins>` +
    run(text('.')) +
    '</w:p>',
  // A field: its code (w:instrText) is left out, its result is read.
  '<w:p>' +
    run(text('The plan is on the ')) +
    run('<w:fldChar w:fldCharType="begin"/>') +
    run('<w:instrText xml:space="preserve"> HYPERLINK "https://acme.example/plan" </w:instrText>') +
    run('<w:fldChar w:fldCharType="separate"/>') +
    run(text('booking page')) +
    run('<w:fldChar w:fldCharType="end"/>') +
    run(text('.')) +
    '</w:p>',
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>' +
    row(cell(paragraph('Phase')), cell(paragraph('Ends'))) +
    row(cell(paragraph('Design')), cell(paragraph('30 October'), paragraph('(after review)'))) +
    '</w:tbl>',
  paragraph('परियोजना की समय सीमा 15 दिसंबर है।'),
  paragraph('ਪ੍ਰੋਜੈਕਟ ਦੀ ਸਮਾਂ ਸੀਮਾ 15 ਦਸੰਬਰ ਹੈ।'),
  // A page break is a line break: a .docx has no pages.
  '<w:p>' + run('<w:br w:type="page"/>') + '</w:p>',
  paragraph('After the page break.'),
].join('');

export const NORMAL_TEXT = [
  'Scope for Acme Clinics',
  'Go-live is on 15 December.',
  'Owner\tRiya Kapoor',
  'Patients can book a visit.',
  'They can move or cancel it.',
  'Reminders go by SMS.',
  'Design & build. Prices are in ₹ and ₹, <not> dollars.',
  'Launch is in December.',
  'The plan is on the booking page.',
  'Phase\tEnds',
  'Design\t30 October (after review)',
  'परियोजना की समय सीमा 15 दिसंबर है।',
  'ਪ੍ਰੋਜੈਕਟ ਦੀ ਸਮਾਂ ਸੀਮਾ 15 ਦਸੰਬਰ ਹੈ।',
  '', // the page break's line break,
  '', // and the end of its paragraph
  'After the page break.',
].join('\n');

/** Paragraphs, a table and a deleted run, but not one word left to read. */
const EMPTY_BODY =
  '<w:p/><w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>' +
  '<w:p>' +
  run('<w:br w:type="page"/>') +
  `<w:del w:id="3" ${REVISION}><w:r><w:delText>Only deleted words here.</w:delText></w:r></w:del>` +
  '</w:p>' +
  `<w:tbl>${row(cell('<w:p/>'), cell('<w:p/>'))}</w:tbl>`;

const STORED_TEXT = 'This file was saved without compression.';
const DESCRIPTOR_TEXT = 'Each part of this file has its sizes after its data.';

/** Writes every fixture into this folder. */
function writeFixtures() {
  const out = (name) => new URL(name, import.meta.url);
  const normal = docxFile(NORMAL_BODY);
  writeFileSync(out('normal.docx'), normal);
  writeFileSync(out('stored.docx'), docxFile(paragraph(STORED_TEXT), { method: 0 }));
  writeFileSync(
    out('data-descriptor.docx'),
    docxFile(paragraph(DESCRIPTOR_TEXT), { dataDescriptor: true }),
  );
  writeFileSync(out('no-text.docx'), docxFile(EMPTY_BODY));
  writeFileSync(out('password.docx'), oleFile(['EncryptionInfo', 'EncryptedPackage']));
  writeFileSync(out('old-word.doc'), oleFile(['WordDocument', '1Table']));
  writeFileSync(out('broken.docx'), normal.subarray(0, Math.floor(normal.length / 2)));
  writeFileSync(out('no-document.docx'), docxFile(NORMAL_BODY, { document: false }));
}

export const FIXTURE_TEXT = Object.freeze({
  stored: STORED_TEXT,
  dataDescriptor: DESCRIPTOR_TEXT,
});

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) writeFixtures();
