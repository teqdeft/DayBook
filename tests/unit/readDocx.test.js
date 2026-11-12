// readDocx (CONTRACT 22): a .docx's word/document.xml found through the zip's central directory and
// inflated by the platform, with every fixture in tests/fixtures/docx, both with the browser's
// DecompressionStream (Node's copy) and with node:zlib, and every way a file is refused.
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createInflateRaw, deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DocxError,
  inflateRaw,
  isOleFile,
  MAX_XML_BYTES,
  readDocxText,
} from '@/app/(app)/projects/[id]/readDocx';
import { FIXTURE_TEXT, NORMAL_TEXT } from '../fixtures/docx/make-fixtures.mjs';
import {
  docxEntries,
  documentXml,
  docxFile,
  OTHER_PARTS_TEXT,
  paragraph,
} from '../fixtures/docx/word.mjs';
import { writeZip } from '../fixtures/docx/zip.mjs';

const fixture = (name) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/docx/${name}`, import.meta.url)));

/** node:zlib's inflate, as a web stream like DecompressionStream's. */
function zlibInflate(bytes) {
  const inflater = createInflateRaw();
  inflater.end(bytes);
  return Readable.toWeb(inflater);
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected it to fail');
}

async function refusal(bytes, options) {
  const error = await failure(readDocxText(bytes, options));
  expect(error).toBeInstanceOf(DocxError);
  return error;
}

/** A stream of `count` chunks made only when pulled, which records how far it got. */
function lazyStream(chunk, count) {
  const seen = { pulled: 0, cancelled: false };
  const source = {
    pull(controller) {
      seen.pulled += 1;
      if (seen.pulled > count) controller.close();
      else controller.enqueue(chunk(seen.pulled));
    },
    cancel() {
      seen.cancelled = true;
    },
  };
  // A high-water mark of 0: a chunk is made only when read, never ahead.
  return { stream: new ReadableStream(source, { highWaterMark: 0 }), seen };
}

/** The offset of the central directory record of `name`, to damage it in a test. */
function centralRecord(zip, name) {
  const at = zip.indexOf(Buffer.from('PK\u0001\u0002', 'latin1'));
  const record = zip.indexOf(Buffer.from(name), at) - 46;
  expect(zip.readUInt32LE(record)).toBe(0x02014b50);
  return record;
}

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ['DecompressionStream', inflateRaw],
  ['node:zlib', zlibInflate],
])('the fixtures, inflated by %s', (_, inflate) => {
  it('reads normal.docx in document order, with nothing from its other parts', async () => {
    const text = await readDocxText(fixture('normal.docx'), { inflate });
    expect(text).toBe(`${NORMAL_TEXT}\n`);
    for (const other of Object.values(OTHER_PARTS_TEXT)) expect(text).not.toContain(other);
    expect(text).not.toContain('November');
    expect(text).not.toContain('HYPERLINK');
    expect(text).not.toContain('\f');
  });

  it('reads a file whose sizes come after the data, from the central directory', async () => {
    const text = await readDocxText(fixture('data-descriptor.docx'), { inflate });
    expect(text.trim()).toBe(FIXTURE_TEXT.dataDescriptor);
  });

  it('reads a file with nothing in it as no text', async () => {
    expect((await readDocxText(fixture('no-text.docx'), { inflate })).trim()).toBe('');
  });
});

describe('the other fixtures', () => {
  it('reads a stored (method 0) file as it is, without inflating anything', async () => {
    const inflate = vi.fn();
    const text = await readDocxText(fixture('stored.docx'), { inflate });
    expect(text.trim()).toBe(FIXTURE_TEXT.stored);
    expect(inflate).not.toHaveBeenCalled();
  });

  it('knows an OLE file, which is a .docx with a password or an old .doc', async () => {
    for (const name of ['password.docx', 'old-word.doc']) {
      expect(isOleFile(fixture(name))).toBe(true);
      expect((await refusal(fixture(name))).code).toBe('ole');
    }
    expect(isOleFile(fixture('normal.docx'))).toBe(false);
  });

  it('refuses a zip cut in half and one without word/document.xml', async () => {
    expect((await refusal(fixture('broken.docx'))).message).toBe('No end of central directory.');
    expect((await refusal(fixture('no-document.docx'))).message).toBe('No word/document.xml.');
  });
});

describe('refusing what is not a .docx it can read', () => {
  const zip = () => docxFile(paragraph('Some text'));

  it('refuses an empty file, plain text and a zip of something else', async () => {
    expect((await refusal(new Uint8Array())).code).toBe('broken');
    expect((await refusal(new TextEncoder().encode('Not a zip at all'))).code).toBe('broken');
    const other = writeZip([{ name: 'word/document.xml', data: '<html><p>Hello</p></html>' }]);
    expect((await refusal(other)).message).toBe('document.xml is not a Word document.');
  });

  it('refuses an encrypted entry, an unknown method and a damaged deflate stream', async () => {
    const encrypted = zip();
    encrypted.writeUInt16LE(0x0801, centralRecord(encrypted, 'word/document.xml') + 8);
    expect((await refusal(encrypted)).message).toBe('Encrypted entry.');
    const bzip2 = zip();
    bzip2.writeUInt16LE(12, centralRecord(bzip2, 'word/document.xml') + 10);
    expect((await refusal(bzip2)).message).toBe('Unknown method.');
  });

  it('refuses deflate data that is damaged or cut short, whichever inflate reads it', async () => {
    const whole = deflateRawSync(documentXml(paragraph('Some text')));
    const damaged = [Buffer.from([0xff, 0xff, 0xff, 0xff]), whole.subarray(0, whole.length / 2)];
    for (const data of damaged) {
      // stored, so the bytes go in as they are, then marked as deflated
      const file = writeZip([{ name: 'word/document.xml', data }], { method: 0 });
      file.writeUInt16LE(8, centralRecord(file, 'word/document.xml') + 10);
      expect((await refusal(file)).message).toBe('Inflate failed.');
      expect((await refusal(file, { inflate: zlibInflate })).message).toBe('Inflate failed.');
    }
  });

  it('refuses zip64 archives and entries, and split archives', async () => {
    const locator = zip();
    const end = locator.lastIndexOf(Buffer.from('PK\u0005\u0006', 'latin1'));
    const withLocator = Buffer.concat([
      locator.subarray(0, end),
      Buffer.from('PK\u0006\u0007', 'latin1'),
      Buffer.alloc(16),
      locator.subarray(end),
    ]);
    expect((await refusal(withLocator)).message).toBe('Zip64 archive.');
    const marked = zip();
    marked.writeUInt16LE(0xffff, marked.lastIndexOf(Buffer.from('PK\u0005\u0006', 'latin1')) + 10);
    expect((await refusal(marked)).message).toBe('Zip64.');
    const entry = zip();
    entry.writeUInt32LE(0xffffffff, centralRecord(entry, 'word/document.xml') + 20);
    expect((await refusal(entry)).message).toBe('Zip64 entry.');
    const split = zip();
    split.writeUInt16LE(1, split.lastIndexOf(Buffer.from('PK\u0005\u0006', 'latin1')) + 4);
    expect((await refusal(split)).message).toBe('Split archive.');
  });

  it('refuses offsets and sizes that point outside the file', async () => {
    const local = zip();
    local.writeUInt32LE(1, centralRecord(local, 'word/document.xml') + 42);
    expect((await refusal(local)).message).toBe('Bad local header.');
    const size = zip();
    size.writeUInt32LE(size.length, centralRecord(size, 'word/document.xml') + 20);
    expect((await refusal(size)).message).toBe('Entry out of bounds.');
    const name = zip();
    name.writeUInt16LE(0xfff0, centralRecord(name, '[Content_Types].xml') + 28);
    expect((await refusal(name)).message).toBe('Central directory entry out of bounds.');
  });

  it('finds the end record past a zip comment, and the part whatever its case', async () => {
    const entries = docxEntries(paragraph('Commented')).map((entry) =>
      entry.name === 'word/document.xml' ? { ...entry, name: 'Word/Document.xml' } : entry,
    );
    const text = await readDocxText(writeZip(entries, { comment: 'Saved by a zip tool' }));
    expect(text).toBe('Commented\n');
  });
});

describe('the 50 MB limit on the unzipped document.xml', () => {
  it('is 50 MB', () => {
    expect(MAX_XML_BYTES).toBe(50 * 1024 * 1024);
  });

  it('stops inflating as soon as the XML passes the limit, before the rest is made', async () => {
    const start = new TextEncoder().encode(documentXml('').replace('</w:body></w:document>', ''));
    const filler = new TextEncoder().encode(paragraph('x'.repeat(1000)));
    const { stream, seen } = lazyStream((n) => (n === 1 ? start : filler), 10_000);
    const error = await refusal(docxFile(paragraph('Small')), {
      inflate: () => stream,
      maxXmlBytes: 8 * 1024,
    });
    expect(error.message).toBe('document.xml is too big.');
    expect(seen.pulled).toBeLessThan(12);
    expect(seen.cancelled).toBe(true);
  });

  it('lets XML of exactly the limit through, by deflate and when stored', async () => {
    const xml = documentXml(paragraph('Fits'));
    const bytes = new TextEncoder().encode(xml).length;
    for (const method of [8, 0]) {
      const file = writeZip([{ name: 'word/document.xml', data: xml }], { method });
      expect(await readDocxText(file, { maxXmlBytes: bytes })).toBe('Fits\n');
      expect((await refusal(file, { maxXmlBytes: bytes - 1 })).message).toBe(
        'document.xml is too big.',
      );
    }
  });

  it('stops a small file that inflates past 50 MB, with the real limit', async () => {
    const xml = documentXml(`${paragraph('Bomb')}${' '.repeat(MAX_XML_BYTES)}`);
    const file = writeZip([{ name: 'word/document.xml', data: xml }]);
    expect(file.length).toBeLessThan(200 * 1024);
    expect((await refusal(file)).message).toBe('document.xml is too big.');
  }, 30_000);
});

describe('a small file built to be slow', () => {
  it('reads 3,000 nested tables around 1 MB of text in well under a second', async () => {
    const depth = 3000;
    const body =
      '<w:tbl><w:tr><w:tc>'.repeat(depth) +
      paragraph('x'.repeat(1_000_000)) +
      '</w:tc></w:tr></w:tbl>'.repeat(depth);
    const file = docxFile(body);
    expect(file.length).toBeLessThan(10 * 1024);
    const started = performance.now();
    const text = await readDocxText(file);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(text.trim()).toBe('x'.repeat(1_000_000));
  });
});

describe('stopping and missing parts of the browser', () => {
  it('stops before inflating when the signal already fired', async () => {
    const controller = new AbortController();
    controller.abort();
    const inflate = vi.fn(zlibInflate);
    const error = await failure(
      readDocxText(fixture('normal.docx'), { signal: controller.signal, inflate }),
    );
    expect(error.name).toBe('AbortError');
    expect(inflate).not.toHaveBeenCalled();
  });

  it('stops while inflating, and cancels the stream', async () => {
    const controller = new AbortController();
    const { stream, seen } = lazyStream(() => {
      controller.abort();
      return new TextEncoder().encode('<w:document>');
    }, 100);
    const error = await failure(
      readDocxText(fixture('normal.docx'), { signal: controller.signal, inflate: () => stream }),
    );
    expect(error.name).toBe('AbortError');
    expect(seen.cancelled).toBe(true);
    expect(seen.pulled).toBeLessThan(4);
  });

  it('says when the browser has no DecompressionStream', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    expect((await refusal(fixture('normal.docx'))).code).toBe('unsupported');
    expect(await readDocxText(fixture('stored.docx'))).toContain(FIXTURE_TEXT.stored);
  });
});
