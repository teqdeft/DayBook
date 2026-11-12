// docxText (CONTRACT 22): the text of a Word document.xml in document order, by a tokenizer that
// never expands anything. readDocx.test.js reads the same text out of real .docx files.
import { describe, expect, it } from 'vitest';
import { decodeEntities, docxText, MAX_TABLE_DEPTH } from '@/app/(app)/projects/[id]/docxText';
import { MAX_TEXT_LENGTH } from '@/modules/projectSummaries/schemas';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const doc = (body) =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:mc="${MC}"><w:body>${body}</w:body></w:document>`;
const p = (...runs) => `<w:p>${runs.map((run) => `<w:r>${run}</w:r>`).join('')}</w:p>`;
const t = (text) => `<w:t xml:space="preserve">${text}</w:t>`;
const tc = (...paragraphs) => `<w:tc>${paragraphs.join('')}</w:tc>`;
const tr = (...cells) => `<w:tr>${cells.join('')}</w:tr>`;

describe('paragraphs, tabs and breaks', () => {
  it('makes each paragraph a line, runs joined as written', () => {
    expect(docxText(doc(p(t('Go-live is on '), t('15 December.')) + p(t('Next'))))).toBe(
      'Go-live is on 15 December.\nNext\n',
    );
    expect(docxText(doc('<w:p/>' + p(t('After an empty one'))))).toBe('\nAfter an empty one\n');
  });

  it('reads w:tab as a tab, but not the tab stops in a paragraph’s properties', () => {
    const tabStops = '<w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>';
    const xml = doc(`<w:p>${tabStops}<w:r>${t('Owner')}<w:tab/>${t('Riya')}</w:r></w:p>`);
    expect(docxText(xml)).toBe('Owner\tRiya\n');
    expect(docxText(doc(p(`${t('A')}<w:ptab w:alignment="right"/>${t('B')}`)))).toBe('A\tB\n');
  });

  it('reads w:br and w:cr as line breaks, a page break too', () => {
    expect(docxText(doc(p(`${t('One')}<w:br/>${t('Two')}<w:cr/>${t('Three')}`)))).toBe(
      'One\nTwo\nThree\n',
    );
    expect(docxText(doc(p(`${t('A')}<w:br w:type="page"/>${t('B')}`)))).toBe('A\nB\n');
  });

  it('reads a non-breaking hyphen and leaves a soft one out', () => {
    expect(docxText(doc(p(`${t('Go')}<w:noBreakHyphen/>${t('live')}<w:softHyphen/>`)))).toBe(
      'Go-live\n',
    );
  });
});

describe('tables', () => {
  it('joins cells with a tab and makes each row a line', () => {
    const table = `<w:tbl><w:tblPr/>${tr(tc(p(t('Phase'))), tc(p(t('Ends'))))}${tr(
      tc(p(t('Design'))),
      tc(p(t('30 Oct')), p(t('(after review)'))),
    )}</w:tbl>`;
    expect(docxText(doc(p(t('Before')) + table + p(t('After'))))).toBe(
      'Before\nPhase\tEnds\nDesign\t30 Oct (after review)\nAfter\n',
    );
  });

  it('keeps an empty cell’s place and leaves empty rows out', () => {
    const table = `<w:tbl>${tr(tc(p(t('A'))), '<w:tc/>', tc(p(t('C'))))}${tr(tc('<w:p/>'))}</w:tbl>`;
    expect(docxText(doc(table))).toBe('A\t\tC\n');
  });

  it('turns a table inside a cell into words of that cell, and tabs and breaks into spaces', () => {
    const inner = `<w:tbl>${tr(tc(p(t('x'))), tc(p(t('y'))))}${tr(tc(p(t('z'))))}</w:tbl>`;
    const table = `<w:tbl>${tr(tc(p(t('Outer')), inner), tc(p(`${t('a')}<w:tab/>${t('b')}<w:br/>${t('c')}`)))}</w:tbl>`;
    expect(docxText(doc(table))).toBe('Outer x y z\ta b c\n');
  });

  it('closes a table the file never closed', () => {
    expect(docxText(doc(`<w:tbl><w:tr><w:tc>${p(t('Cut off'))}`))).toBe('Cut off\n');
  });

  it('reads tables nested past the cap as words of the deepest cell, in order', () => {
    const levels = MAX_TABLE_DEPTH + 4;
    let xml = p(t(`L${levels}`));
    for (let level = levels - 1; level >= 1; level -= 1) {
      xml = tc(p(t(`L${level}`)), `<w:tbl>${tr(tc(p(t('a'))), tc(xml))}</w:tbl>`);
    }
    const words = Array.from({ length: levels - 1 }, (_, i) => `L${i + 1} a`).join(' ');
    expect(docxText(doc(`<w:tbl>${tr(xml, tc(p(t('Next'))))}</w:tbl>`))).toBe(
      `${words} L${levels}\tNext\n`,
    );
  });

  it('reads a file nested 3,000 tables deep around 1 MB of text in well under a second', () => {
    const depth = 3000;
    const xml = doc(
      '<w:tbl><w:tr><w:tc>'.repeat(depth) +
        p(t('x'.repeat(1_000_000))) +
        '</w:tc></w:tr></w:tbl>'.repeat(depth) +
        p(t('After')),
    );
    const started = performance.now();
    const text = docxText(xml);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(text.trim()).toBe('x'.repeat(1_000_000));
  });
});

describe('the most text it reads', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`);
  const whole = docxText(doc(lines.map((line) => p(t(line))).join('')));

  it('stops once the text holds more than maxLength characters other than spaces', () => {
    const text = docxText(doc(lines.map((line) => p(t(line))).join('')), { maxLength: 20 });
    expect(text.length).toBeLessThan(40);
    expect(text.replace(/\s+/g, '').length).toBeGreaterThan(20);
    expect(whole.startsWith(text)).toBe(true);
  });

  it('keeps the first maxLength characters of the trimmed text, past spaces a table merges', () => {
    const spaces = ' '.repeat(500);
    const table = `<w:tbl>${tr(tc(p(t(`A${spaces}B`)), p(t(`C${spaces}D`))), tc(p(t('E F G H'))))}</w:tbl>`;
    const xml = doc(`<w:p/>`.repeat(30) + table + lines.map((line) => p(t(line))).join(''));
    const full = docxText(xml, { maxLength: Infinity }).trim();
    for (const maxLength of [3, 8, 12, 30]) {
      const text = docxText(xml, { maxLength }).trim();
      expect(text.length).toBeGreaterThan(maxLength);
      expect(text.slice(0, maxLength)).toBe(full.slice(0, maxLength));
      expect(text.length).toBeLessThan(full.length);
    }
  });

  it('reads up to MAX_TEXT_LENGTH by default', () => {
    const big = 'y'.repeat(MAX_TEXT_LENGTH);
    expect(docxText(doc(p(t(big)) + p(t('Beyond'))))).toBe(`${big}\nBeyond`);
    expect(docxText(doc(p(t(`${big}z`)) + p(t('Beyond'))))).toBe(`${big}z`);
  });
});

describe('what is left out', () => {
  it('skips deleted and moved-away text, with any tab or break in it, and keeps insertions', () => {
    const xml = doc(
      '<w:p>' +
        `<w:r>${t('Launch in ')}</w:r>` +
        '<w:del w:id="1" w:author="R"><w:r><w:tab/><w:delText>November</w:delText><w:br/></w:r></w:del>' +
        `<w:ins w:id="2" w:author="R"><w:r>${t('December')}</w:r></w:ins>` +
        `<w:moveFrom w:id="3" w:author="R"><w:r>${t(' (moved)')}</w:r></w:moveFrom>` +
        `<w:moveFromRangeStart w:id="4" w:name="m"/><w:r>${t('.')}</w:r><w:moveFromRangeEnd w:id="4"/>` +
        '</w:p>',
    );
    expect(docxText(xml)).toBe('Launch in December.\n');
  });

  it('skips field codes and keeps their result', () => {
    const xml = doc(
      p(
        '<w:fldChar w:fldCharType="begin"/>',
        '<w:instrText xml:space="preserve"> HYPERLINK "https://x.example" </w:instrText>',
        '<w:fldChar w:fldCharType="separate"/>',
        t('the site'),
        '<w:fldChar w:fldCharType="end"/>',
      ) + `<w:p><w:fldSimple w:instr=" PAGE "><w:r>${t('3')}</w:r></w:fldSimple></w:p>`,
    );
    expect(docxText(xml)).toBe('the site\n3\n');
  });

  it('reads a drawing’s text box once, not its fallback copy', () => {
    const box = (text) => `<w:txbxContent>${p(t(text))}</w:txbxContent>`;
    const run =
      '<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>' +
      box('In the box') +
      '</w:drawing></mc:Choice><mc:Fallback><w:pict>' +
      box('In the box') +
      '</w:pict></mc:Fallback></mc:AlternateContent>';
    expect(docxText(doc(p(t('Before '), run, t('after'))))).toBe('Before In the box\nafter\n');
  });

  it('reads only w:t, never other text in the XML or run properties', () => {
    const xml = doc(
      `<w:p><w:pPr><w:rPr><w:t>not text</w:t></w:rPr></w:pPr><w:r><w:rPr><w:lang w:val="hi-IN"/></w:rPr>${t('Real')}</w:r><w:r><w:t/></w:r>loose words</w:p>`,
    );
    expect(docxText(xml)).toBe('Real\n');
  });

  it('skips comments and processing instructions, and a ">" inside an attribute', () => {
    const xml = doc(
      `<!-- <w:t>hidden</w:t> --><?mso-application progid="Word.Document"?><w:p w:custom="a/> b">` +
        `<w:r><w:t w:note='1 > 0' xml:space="preserve">Shown</w:t></w:r></w:p>`,
    );
    expect(docxText(xml)).toBe('Shown\n');
  });
});

describe('characters', () => {
  it('decodes the five XML entities and numeric references', () => {
    expect(decodeEntities('A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe(
      'A & B <c> "d" \'e\'',
    );
    expect(decodeEntities('&#x20B9;5 &#8377;6 &#X1F600;')).toBe('₹5 ₹6 😀');
  });

  it('drops references to characters XML forbids, and leaves unknown names as written', () => {
    expect(decodeEntities('a&#0;b&#xD800;c&#x110000;d&#7;e&#99999999999999999999;f')).toBe(
      'abcdef',
    );
    expect(decodeEntities('&nbsp; &copy; &amp')).toBe('&nbsp; &copy; &amp');
  });

  it('never expands an entity a DOCTYPE declares, and never reads the DOCTYPE', () => {
    const subset =
      '[<!ENTITY boom "<w:p><w:r><w:t>Injected</w:t></w:r></w:p>"> <!ENTITY x SYSTEM "file:///etc/passwd">]';
    const xml =
      `<?xml version="1.0"?><!DOCTYPE w:document ${subset}>` +
      `<w:document xmlns:w="${W}"><w:body>${p(t('&boom; &x; &amp;'))}</w:body></w:document>`;
    expect(docxText(xml)).toBe('&boom; &x; &\n');
  });

  it('keeps Hindi and Punjabi as written, and CDATA without decoding it', () => {
    expect(docxText(doc(p(t('समय सीमा')) + p(t('ਸਮਾਂ ਸੀਮਾ'))))).toBe('समय सीमा\nਸਮਾਂ ਸੀਮਾ\n');
    expect(docxText(doc(p('<w:t><![CDATA[a &amp; <b>]]></w:t>')))).toBe('a &amp; <b>\n');
  });

  it('turns line breaks and tabs inside w:t into spaces and drops other controls', () => {
    expect(docxText(doc(p(t('a\r\nb\tc\u0007d&#9;e'))))).toBe('a b cd e\n');
  });
});

describe('the document itself', () => {
  it('follows the prefix the root declares, for transitional and strict files', () => {
    const plain = `<document xmlns="${W}"><body><p><r><t>Default namespace</t></r></p></body></document>`;
    expect(docxText(plain)).toBe('Default namespace\n');
    const strict =
      '<x:document xmlns:x="http://purl.oclc.org/ooxml/wordprocessingml/main"><x:body>' +
      '<x:p><x:r><x:t>Strict</x:t><x:tab/><x:t>file</x:t></x:r></x:p><w:p><w:r><w:t>not Word</w:t></w:r></w:p>' +
      '</x:body></x:document>';
    expect(docxText(strict)).toBe('Strict\tfile\n');
  });

  it('says null when the XML is not a Word document', () => {
    expect(docxText('<html><body><p>Hello</p></body></html>')).toBeNull();
    expect(docxText('')).toBeNull();
    expect(docxText('Just some words')).toBeNull();
    expect(docxText('<?xml version="1.0"?><!-- nothing -->')).toBeNull();
  });

  it('gives what it read so far when the XML stops in the middle of a tag', () => {
    const start = `<w:document xmlns:w="${W}"><w:body>${p(t('Kept'))}`;
    expect(docxText(`${start}<w:p w:rsidR="00A1`)).toBe('Kept\n');
    expect(docxText(`${start}<w:p><w:r><w:t>Never closed`)).toBe('Kept\n');
  });

  it('reads an empty document as no text', () => {
    expect(docxText(doc('<w:p/><w:sectPr/>'))).toBe('\n');
  });
});
