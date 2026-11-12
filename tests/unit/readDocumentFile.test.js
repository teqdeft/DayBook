// readDocumentFile (CONTRACT 22): the text handling, and the real fixtures read with pdf.js's legacy
// build (Node's copy here; the browser's worker is checked in the end-to-end test) and, for Word,
// with Node's own DecompressionStream. readDocx.test.js covers the zip itself.
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cutNotice,
  decodeText,
  DocumentReadError,
  FILE_ACCEPT,
  fileTypeOf,
  hasNoText,
  joinPages,
  MAX_FILE_BYTES,
  pageText,
  READ_ERRORS,
  readDocumentFile,
  readingLabel,
} from '@/app/(app)/projects/[id]/readDocumentFile';
import { DocxError } from '@/app/(app)/projects/[id]/readDocx';
import { MAX_PAGES, MAX_TEXT_LENGTH } from '@/modules/projectSummaries/schemas';
import { FIXTURE_TEXT, NORMAL_TEXT } from '../fixtures/docx/make-fixtures.mjs';
import { docxFile, paragraph } from '../fixtures/docx/word.mjs';

const loadReader = () => import('pdfjs-dist/legacy/build/pdf.mjs');
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function fixture(name) {
  const bytes = readFileSync(new URL(`../fixtures/pdf/${name}`, import.meta.url));
  return new File([bytes], name, { type: 'application/pdf' });
}

/** A Word fixture as a picked file, under its own name or another. */
function wordFixture(name, { as = name, type = DOCX_TYPE } = {}) {
  const bytes = readFileSync(new URL(`../fixtures/docx/${name}`, import.meta.url));
  return new File([bytes], as, { type });
}

afterEach(() => vi.unstubAllGlobals());

const read = (file, options = {}) => readDocumentFile(file, { loadReader, ...options });

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected it to fail');
}

describe('reading a PDF with pdf.js', () => {
  it('reads every page, joined by a form feed, and reports its progress', async () => {
    const progress = [];
    const result = await read(fixture('two-pages.pdf'), {
      onProgress: (step) => progress.push(step),
    });
    expect(result.title).toBe('two-pages.pdf');
    expect(result.pages).toBe(2);
    expect(result.pagesTotal).toBe(2);
    expect(result.notice).toBeNull();
    const pages = result.text.split('\f');
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('Go-live is on 15 December.');
    expect(pages[1]).toContain('Payment provider still to be decided.');
    expect(pages[0]).not.toContain('Payment provider');
    expect(progress).toEqual([
      { page: 1, pages: 2 },
      { page: 2, pages: 2 },
    ]);
  });

  it('reads the first 100 pages of a longer file and says so', async () => {
    const progress = [];
    const result = await read(fixture('101-pages.pdf'), {
      onProgress: (step) => progress.push(step),
    });
    expect(result.pages).toBe(MAX_PAGES);
    expect(result.pagesTotal).toBe(101);
    expect(result.notice).toBe('Read the first 100 of 101 pages.');
    const pages = result.text.split('\f');
    expect(pages).toHaveLength(100);
    expect(pages[99]).toContain('This is page 100.');
    expect(result.text).not.toContain('This is page 101.');
    expect(progress.at(-1)).toEqual({ page: 100, pages: 100 });
  }, 60_000);

  it('says a scan has no readable text', async () => {
    const error = await failure(read(fixture('scan.pdf')));
    expect(error).toBeInstanceOf(DocumentReadError);
    expect(error.message).toBe('No readable text. Is it a scan? Paste the key parts as a note.');
  });

  it('asks to remove a password', async () => {
    const error = await failure(read(fixture('password.pdf')));
    expect(error).toBeInstanceOf(DocumentReadError);
    expect(error.message).toBe('Remove the password or paste the text as a note.');
  });

  it("says a broken file isn't a PDF it can read", async () => {
    const error = await failure(read(fixture('broken.pdf')));
    expect(error).toBeInstanceOf(DocumentReadError);
    expect(error.message).toBe("This file isn't a PDF Daybook can read.");
  });

  it('says the same of an empty file and of a real PDF cut in half', async () => {
    const empty = new File([], 'empty.pdf', { type: 'application/pdf' });
    expect((await failure(read(empty))).message).toBe(READ_ERRORS.broken);
    const whole = await fixture('two-pages.pdf').arrayBuffer();
    const half = new File([whole.slice(0, 40)], 'half.pdf', { type: 'application/pdf' });
    expect((await failure(read(half))).message).toBe(READ_ERRORS.broken);
  });

  it('stops when asked and leaves nothing running', async () => {
    const controller = new AbortController();
    const onProgress = vi.fn(() => controller.abort());
    const error = await failure(
      read(fixture('101-pages.pdf'), { signal: controller.signal, onProgress }),
    );
    expect(error.name).toBe('AbortError');
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it("says the reader couldn't start when pdf.js itself can't load", async () => {
    const error = await failure(
      read(fixture('two-pages.pdf'), {
        loadReader: async () => {
          throw new Error('Loading chunk failed');
        },
      }),
    );
    expect(error.message).toBe(READ_ERRORS.reader);
  });

  it('only asks pdf.js for text: no eval, no scripting, nothing but getDocument and getTextContent', async () => {
    const used = new Set();
    // Records every property the reader touches ("then" is how await looks at any value).
    const watch = (name, target) =>
      new Proxy(target, {
        get(object, key) {
          if (key !== 'then') used.add(`${name}.${String(key)}`);
          return object[key];
        },
      });
    const page = watch('page', {
      getTextContent: async () => ({ items: [{ str: 'Hello' }] }),
      cleanup: () => {},
    });
    const pdf = watch('pdf', { numPages: 1, getPage: async () => page });
    const task = watch('task', { promise: Promise.resolve(pdf), destroy: async () => {} });
    const getDocument = vi.fn(() => task);
    const pdfjs = watch('pdfjs', { getDocument, VerbosityLevel: { ERRORS: 0 } });
    const result = await read(fixture('two-pages.pdf'), { loadReader: async () => pdfjs });
    expect(result.text).toBe('Hello');
    expect(getDocument).toHaveBeenCalledExactlyOnceWith({
      data: expect.any(Uint8Array),
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    });
    expect([...used].sort()).toEqual([
      'page.cleanup',
      'page.getTextContent',
      'pdf.getPage',
      'pdf.numPages',
      'pdfjs.VerbosityLevel',
      'pdfjs.getDocument',
      'task.destroy',
      'task.promise',
    ]);
  });
});

describe('picking a file', () => {
  it('knows PDF, Word, .txt and .md by name or by type, whatever the case', () => {
    expect(fileTypeOf({ name: 'SOW.PDF', type: '' })).toBe('pdf');
    expect(fileTypeOf({ name: 'scope', type: 'application/pdf' })).toBe('pdf');
    expect(fileTypeOf({ name: 'Contract.DOCX', type: '' })).toBe('docx');
    expect(fileTypeOf({ name: 'contract', type: DOCX_TYPE })).toBe('docx');
    expect(fileTypeOf({ name: 'notes.txt', type: '' })).toBe('text');
    expect(fileTypeOf({ name: 'README.MD', type: '' })).toBe('text');
    expect(fileTypeOf({ name: 'notes', type: 'text/plain' })).toBe('text');
    expect(fileTypeOf({ name: 'notes', type: 'text/markdown' })).toBe('text');
  });

  it('knows an old .doc only to say so, and nothing else at all', () => {
    expect(fileTypeOf({ name: 'Old.DOC', type: '' })).toBe('doc');
    expect(fileTypeOf({ name: 'old', type: 'application/msword' })).toBe('doc');
    expect(fileTypeOf({ name: 'photo.png', type: 'image/png' })).toBeNull();
    expect(fileTypeOf({ name: 'macros.docm', type: '' })).toBeNull();
    expect(fileTypeOf({ name: 'scope.constructor', type: '' })).toBeNull();
    expect(fileTypeOf({ name: 'notes.txt', type: 'application/pdf' })).toBe('text');
  });

  it('offers the picker each extension with its MIME type', () => {
    expect(FILE_ACCEPT).toBe(
      '.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain,.md,text/markdown',
    );
  });

  it('refuses anything else, and anything over 20 MB before opening it', async () => {
    const png = new File(['x'], 'photo.png', { type: 'image/png' });
    expect((await failure(read(png))).message).toBe('Pick a PDF, Word (.docx), .txt or .md file.');
    const loader = vi.fn();
    const big = { name: 'big.pdf', type: 'application/pdf', size: MAX_FILE_BYTES + 1 };
    expect((await failure(read(big, { loadReader: loader }))).message).toBe(READ_ERRORS.tooBig);
    expect(loader).not.toHaveBeenCalled();
  });

  it('lets a file of exactly 20 MB through to the reader', async () => {
    const reader = vi.fn(async () => {
      throw new Error('stop here');
    });
    const file = { name: 'big.pdf', type: 'application/pdf', size: MAX_FILE_BYTES };
    expect((await failure(read(file, { loadReader: reader }))).code).toBe('reader');
    expect(reader).toHaveBeenCalledOnce();
  });

  it('keeps a long file name within the 200 characters of a title', async () => {
    const name = `${'a'.repeat(300)}.txt`;
    const result = await read(new File(['Some text'], name, { type: 'text/plain' }));
    expect(result.title).toHaveLength(200);
  });

  it('says what it is reading on the button', () => {
    expect(readingLabel(null)).toBe('Reading…');
    expect(readingLabel({ page: 12, pages: 14 })).toBe('Reading page 12 of 14…');
  });
});

describe('Word files', () => {
  it('reads a .docx as text with no pages, and never reports pages while reading', async () => {
    const onProgress = vi.fn();
    const result = await read(wordFixture('normal.docx'), { onProgress });
    expect(result).toEqual({
      title: 'normal.docx',
      text: NORMAL_TEXT,
      pages: null,
      pagesTotal: null,
      notice: null,
    });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('reads stored files and data descriptors, with the inflate it is given', async () => {
    const inflate = vi.fn((bytes) => Readable.toWeb(createInflateRaw().end(bytes)));
    const described = await read(wordFixture('data-descriptor.docx'), { inflate });
    expect(described.text).toBe(FIXTURE_TEXT.dataDescriptor);
    expect(inflate).toHaveBeenCalledOnce();
    expect((await read(wordFixture('stored.docx'))).text).toBe(FIXTURE_TEXT.stored);
  });

  it('says a .docx without words has no text', async () => {
    expect((await failure(read(wordFixture('no-text.docx')))).message).toBe(
      'This file has no text.',
    );
  });

  it('asks to remove a password from a .docx, and calls the same OLE file by another name old', async () => {
    expect((await failure(read(wordFixture('password.docx')))).message).toBe(
      'Remove the password or paste the text as a note.',
    );
    const unnamed = wordFixture('password.docx', { as: 'contract' });
    expect((await failure(read(unnamed))).message).toBe(READ_ERRORS.oldWord);
  });

  it('calls a .doc an old Word file without opening it, by name or by type', async () => {
    const message = 'This is an old Word file. Save it as .docx or PDF first.';
    expect((await failure(read(wordFixture('old-word.doc', { type: '' })))).message).toBe(message);
    const big = { name: 'old', type: 'application/msword', size: MAX_FILE_BYTES * 2 };
    big.arrayBuffer = vi.fn();
    expect((await failure(read(big))).message).toBe(message);
    expect(big.arrayBuffer).not.toHaveBeenCalled();
  });

  it("says a broken zip, or one without word/document.xml, isn't a Word file it can read", async () => {
    for (const name of ['broken.docx', 'no-document.docx']) {
      const error = await failure(read(wordFixture(name)));
      expect(error).toBeInstanceOf(DocumentReadError);
      expect(error.message).toBe("This file isn't a Word file Daybook can read.");
      expect(error.cause).toBeInstanceOf(DocxError);
    }
  });

  it('cuts a long .docx at 200,000 characters and says so', async () => {
    const bytes = docxFile(paragraph('x'.repeat(MAX_TEXT_LENGTH + 10)));
    const result = await read(new File([bytes], 'long.docx'));
    expect(result.text).toHaveLength(MAX_TEXT_LENGTH);
    expect(result.notice).toBe('Read the first 200,000 characters.');
  });

  it('refuses a .docx over 20 MB before opening it, and reads one of exactly 20 MB', async () => {
    const bytes = readFileSync(new URL('../fixtures/docx/normal.docx', import.meta.url));
    const file = (size) => ({
      name: 'big.docx',
      type: '',
      size,
      arrayBuffer: vi.fn(async () => bytes),
    });
    const over = file(MAX_FILE_BYTES + 1);
    expect((await failure(read(over))).message).toBe(READ_ERRORS.tooBig);
    expect(over.arrayBuffer).not.toHaveBeenCalled();
    expect((await read(file(MAX_FILE_BYTES))).text).toBe(NORMAL_TEXT);
  });

  it('stops when asked, with an AbortError rather than a sentence', async () => {
    const controller = new AbortController();
    const inflate = () => {
      controller.abort();
      return new Blob(['<w:document>']).stream();
    };
    const error = await failure(
      read(wordFixture('normal.docx'), { signal: controller.signal, inflate }),
    );
    expect(error.name).toBe('AbortError');
    expect(error).not.toBeInstanceOf(DocumentReadError);
  });

  it("says when the browser can't open Word files", async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    expect((await failure(read(wordFixture('normal.docx')))).message).toBe(READ_ERRORS.wordReader);
  });
});

describe('text files', () => {
  it('reads .txt and .md with no pages, and tidies the line breaks', async () => {
    const result = await read(new File(['  One\r\nTwo\rThree\fFour  \n'], 'a.txt'));
    expect(result).toEqual({
      title: 'a.txt',
      text: 'One\nTwo\nThree\nFour',
      pages: null,
      pagesTotal: null,
      notice: null,
    });
    expect((await read(new File(['# Scope'], 'a.md'))).text).toBe('# Scope');
  });

  it('cuts at 200,000 characters and says so', async () => {
    const result = await read(new File(['x'.repeat(MAX_TEXT_LENGTH + 5)], 'long.txt'));
    expect(result.text).toHaveLength(MAX_TEXT_LENGTH);
    expect(result.notice).toBe('Read the first 200,000 characters.');
  });

  it('refuses an empty file and a binary one', async () => {
    expect((await failure(read(new File([' \n\t '], 'a.txt')))).message).toBe(
      'This file has no text.',
    );
    const binary = new File([new Uint8Array([65, 0, 66, 0, 67])], 'a.txt');
    expect((await failure(read(binary))).message).toBe("This file isn't text Daybook can read.");
  });

  it('decodes UTF-8, Notepad’s UTF-16 and old Windows text', () => {
    const utf8 = new TextEncoder().encode('Café ₹');
    expect(decodeText(utf8)).toBe('Café ₹');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xe9, 0x00]))).toBe('Aé');
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0xe9]))).toBe('Aé');
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe('Café');
  });
});

describe('page text', () => {
  it('joins the pieces and keeps the line ends pdf.js marks', () => {
    const items = [
      { str: 'Go-live', hasEOL: false },
      { str: ' is soon', hasEOL: true },
    ];
    expect(pageText([...items, { str: 'Second line' }])).toBe('Go-live is soon\nSecond line');
  });

  it('takes form feeds and control characters out, so page numbers stay right', () => {
    expect(pageText([{ str: 'A\fB\u0007C' }])).toBe('A BC');
    expect(pageText([{ str: '' }, {}])).toBe('');
  });

  it('counts only real text as text', () => {
    expect(hasNoText('\f \f\n\f')).toBe(true);
    expect(hasNoText('\f\fword')).toBe(false);
  });

  it('keeps empty pages, so a page number still points at the right page', () => {
    expect(joinPages(['one', '', 'three']).text).toBe('one\f\fthree');
  });

  it('stays within 200,000 characters, form feeds included, and no half emoji at the end', () => {
    const { text, charactersCut } = joinPages(['a'.repeat(100_000), 'b'.repeat(100_000)]);
    expect(text).toHaveLength(MAX_TEXT_LENGTH);
    expect(charactersCut).toBe(true);
    const emoji = joinPages([`${'a'.repeat(MAX_TEXT_LENGTH - 1)}😀`]);
    expect(emoji.text).toHaveLength(MAX_TEXT_LENGTH - 1);
    expect(joinPages(['short']).charactersCut).toBe(false);
  });

  it('says what was left out, pages first', () => {
    expect(cutNotice({ pages: 100, pagesTotal: 140 })).toBe('Read the first 100 of 140 pages.');
    expect(cutNotice({ pages: 60, pagesTotal: 140, charactersCut: true })).toBe(
      'Read the first 60 of 140 pages.',
    );
    expect(cutNotice({ pages: 14, pagesTotal: 14, charactersCut: true })).toBe(
      'Read the first 200,000 characters.',
    );
    expect(cutNotice({ pages: 14, pagesTotal: 14 })).toBeNull();
    expect(cutNotice({ charactersCut: true })).toBe('Read the first 200,000 characters.');
  });
});
