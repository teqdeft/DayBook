// Reads a picked file into text, in the browser (CONTRACT 22). The server never opens a file, because
// of the host's memory limits: only the text goes to it, and the file is never kept. pdf.js and its
// worker load on the first PDF, not with the page. It only ever extracts text: nothing in a PDF is run
// or drawn, and the viewer and annotation parts of pdf.js are never used. A Word .docx is read with
// the browser's own zip inflate (readDocx.js), and a .txt or .md as it is.
import {
  cutText,
  MAX_PAGES,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
} from '@/modules/projectSummaries/schemas';
import { DocxError, readDocxText } from './readDocx';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** What the file picker offers: each extension Daybook reads, and its MIME type. */
export const FILE_ACCEPT = [
  '.pdf',
  'application/pdf',
  '.docx',
  DOCX_TYPE,
  '.txt',
  'text/plain',
  '.md',
  'text/markdown',
].join(',');

/** The words of each way reading can fail. They go straight into a toast. */
export const READ_ERRORS = Object.freeze({
  tooBig: 'This file is over 20 MB. Paste the key parts as a note.',
  wrongType: 'Pick a PDF, Word (.docx), .txt or .md file.',
  noText: 'No readable text. Is it a scan? Paste the key parts as a note.',
  password: 'Remove the password or paste the text as a note.',
  broken: "This file isn't a PDF Daybook can read.",
  oldWord: 'This is an old Word file. Save it as .docx or PDF first.',
  brokenWord: "This file isn't a Word file Daybook can read.",
  wordReader: "This browser can't open Word files. Update it, or save the file as PDF.",
  emptyText: 'This file has no text.',
  notText: "This file isn't text Daybook can read.",
  reader: "Daybook couldn't start the PDF reader. Reload the page and try again.",
});

const PAGE_BREAK = '\f';
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g;
const TYPES_BY_EXTENSION = new Map([
  ['pdf', 'pdf'],
  ['docx', 'docx'],
  ['doc', 'doc'],
  ['txt', 'text'],
  ['md', 'text'],
]);
const TYPES_BY_MIME = new Map([
  ['application/pdf', 'pdf'],
  [DOCX_TYPE, 'docx'],
  ['application/msword', 'doc'],
  ['text/plain', 'text'],
  ['text/markdown', 'text'],
]);

/** A file Daybook can't read; `message` is the sentence to show. */
export class DocumentReadError extends Error {
  /**
   * @param {keyof typeof READ_ERRORS} code
   * @param {{ cause?: unknown }} [options] cause: what the reader threw, for the console
   */
  constructor(code, options) {
    super(READ_ERRORS[code], options);
    this.name = 'DocumentReadError';
    this.code = code;
  }
}

/**
 * What a picked file is, by its extension first and then by its MIME type.
 * @param {{ name?: string, type?: string }} file
 * @returns {'pdf'|'docx'|'doc'|'text'|null} doc: an old Word file, known only to say so; null: not
 *   something Daybook reads
 */
export function fileTypeOf({ name = '', type = '' }) {
  const dot = name.lastIndexOf('.');
  const extension = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  return TYPES_BY_EXTENSION.get(extension) ?? TYPES_BY_MIME.get(type.toLowerCase()) ?? null;
}

/** "Reading page 12 of 14…", or "Reading…" before the number of pages is known. */
export function readingLabel(progress) {
  return progress ? `Reading page ${progress.page} of ${progress.pages}…` : 'Reading…';
}

/** Control characters out, except line breaks and tabs. The server does the same. */
function cleanText(text) {
  return text.replace(CONTROL_CHARACTERS, '');
}

/**
 * A page's text from pdf.js's items. A form feed inside it would make a page that isn't there.
 * @param {Array<{ str?: string, hasEOL?: boolean }>} items
 * @returns {string}
 */
export function pageText(items) {
  const text = items.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ''}`).join('');
  return cleanText(text.replaceAll(PAGE_BREAK, ' ')).trim();
}

/** True when there is nothing to read but spaces and page breaks. */
export function hasNoText(text) {
  return text.replaceAll(PAGE_BREAK, '').trim() === '';
}

/**
 * What the toast adds when only part of a file was read.
 * @param {{ pages?: number | null, pagesTotal?: number | null, charactersCut?: boolean }} read
 * @returns {string | null}
 */
export function cutNotice({ pages = null, pagesTotal = null, charactersCut = false }) {
  if (pages && pagesTotal && pages < pagesTotal) {
    return `Read the first ${pages} of ${pagesTotal} pages.`;
  }
  return charactersCut
    ? `Read the first ${MAX_TEXT_LENGTH.toLocaleString('en-US')} characters.`
    : null;
}

/**
 * Page texts as one text, within the limit.
 * @param {string[]} pages
 * @returns {{ text: string, charactersCut: boolean }}
 */
export function joinPages(pages) {
  const whole = pages.join(PAGE_BREAK);
  return { text: cutText(whole, MAX_TEXT_LENGTH), charactersCut: whole.length > MAX_TEXT_LENGTH };
}

/**
 * Bytes as text: the marker at the start says which encoding (Notepad's "Unicode" is UTF-16), and a
 * file that isn't valid UTF-8 is an old Windows one.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * A file's text without pages (.txt, .md, .docx), within the character limit.
 * @param {string} text with no control characters but line breaks and tabs
 */
function unpagedRead(text) {
  const trimmed = text.trim();
  if (trimmed === '') throw new DocumentReadError('emptyText');
  const charactersCut = trimmed.length > MAX_TEXT_LENGTH;
  return {
    text: cutText(trimmed, MAX_TEXT_LENGTH),
    pages: null,
    pagesTotal: null,
    notice: cutNotice({ charactersCut }),
  };
}

/** A .txt or .md file. It has no pages, so a form feed in it is just a line break. */
async function readTextFile(file) {
  const decoded = decodeText(new Uint8Array(await file.arrayBuffer()));
  if (decoded.includes('\u0000')) throw new DocumentReadError('notText');
  return unpagedRead(cleanText(decoded.replace(/\r\n?/g, '\n').replaceAll(PAGE_BREAK, '\n')));
}

/** The error to show for what readDocx threw. An OLE file named .docx has a password. */
function wordFailure(error, name) {
  if (!(error instanceof DocxError)) return new DocumentReadError('brokenWord', { cause: error });
  if (error.code === 'unsupported') return new DocumentReadError('wordReader', { cause: error });
  if (error.code !== 'ole') return new DocumentReadError('brokenWord', { cause: error });
  const named = name.toLowerCase().endsWith('.docx');
  return new DocumentReadError(named ? 'password' : 'oldWord', { cause: error });
}

/** A Word .docx. It has no pages: a page break in it is a line break, like any other. */
async function readWordFile(file, { signal, inflate }) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  let text;
  try {
    text = await readDocxText(bytes, { signal, inflate });
  } catch (error) {
    throw signal?.aborted ? error : wordFailure(error, file.name);
  }
  return unpagedRead(text);
}

/** pdf.js and where its worker is. Both are bundled by the build and only fetched when called. */
async function loadPdfReader() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;
  return pdfjs;
}

function abortError() {
  return new DOMException('Reading was stopped.', 'AbortError');
}

/** The error to show for what pdf.js threw while opening a file. */
function openFailure(error) {
  if (error?.name === 'PasswordException') return new DocumentReadError('password');
  // Its worker couldn't start, which says nothing about the file.
  if (/worker/i.test(error?.message ?? '')) return new DocumentReadError('reader');
  return new DocumentReadError('broken');
}

/** One page's text; a damaged page counts as empty, so the other pages keep their numbers. */
async function readPage(pdf, number) {
  try {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    page.cleanup();
    return { text: pageText(content.items), failed: false };
  } catch {
    return { text: '', failed: true };
  }
}

/** Reads the first pages until the page limit or the character limit. */
async function readPages(pdf, { onProgress, signal }) {
  const last = Math.min(pdf.numPages, MAX_PAGES);
  const pages = [];
  let length = 0;
  let failures = 0;
  for (let number = 1; number <= last && length < MAX_TEXT_LENGTH; number += 1) {
    signal?.throwIfAborted();
    onProgress?.({ page: number, pages: last });
    const { text, failed } = await readPage(pdf, number);
    if (failed) failures += 1;
    pages.push(text);
    length += text.length + 1;
  }
  return { pages, failures };
}

async function readPdf(file, { onProgress, signal, loadReader }) {
  let pdfjs;
  try {
    pdfjs = await loadReader();
  } catch {
    throw new DocumentReadError('reader');
  }
  signal?.throwIfAborted();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  const stop = () => task.destroy();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const pdf = await task.promise.catch((error) => {
      throw signal?.aborted ? abortError() : openFailure(error);
    });
    const { pages, failures } = await readPages(pdf, { onProgress, signal });
    const { text, charactersCut } = joinPages(pages);
    if (hasNoText(text)) throw new DocumentReadError(failures > 0 ? 'broken' : 'noText');
    const pagesTotal = pdf.numPages;
    const read = { pages: pages.length, pagesTotal, charactersCut };
    return { text, pages: pages.length, pagesTotal, notice: cutNotice(read) };
  } finally {
    signal?.removeEventListener('abort', stop);
    await task.destroy().catch(() => {});
  }
}

/** How each kind of file is read. */
const READERS = Object.freeze({
  pdf: readPdf,
  docx: readWordFile,
  text: readTextFile,
});

/**
 * Reads a picked file. Browser only for a PDF (pdf.js's worker) and a .docx (DecompressionStream).
 * @param {File} file
 * @param {{ onProgress?: (progress: { page: number, pages: number }) => void,
 *   signal?: AbortSignal, loadReader?: () => Promise<object>,
 *   inflate?: (bytes: Uint8Array) => ReadableStream<Uint8Array> }} [options] onProgress: the PDF
 *   page being read, out of the pages that will be read (never called for other files, whose button
 *   just says "Reading…"); loadReader: how to get pdf.js (tests use Node's); inflate: how a .docx
 *   is unzipped (the browser's DecompressionStream by default)
 * @returns {Promise<{ title: string, text: string, pages: number | null,
 *   pagesTotal: number | null, notice: string | null }>} a PDF's pages joined by \f, at most 100
 *   pages; any file at most 200,000 characters; pages and pagesTotal null but for a PDF; notice:
 *   says what was left out
 * @throws {DocumentReadError} with the sentence to show; AbortError when `signal` stopped it
 */
export async function readDocumentFile(
  file,
  { onProgress, signal, loadReader = loadPdfReader, inflate } = {},
) {
  const type = fileTypeOf(file);
  if (!type) throw new DocumentReadError('wrongType');
  if (type === 'doc') throw new DocumentReadError('oldWord');
  if (file.size > MAX_FILE_BYTES) throw new DocumentReadError('tooBig');
  const read = await READERS[type](file, { onProgress, signal, loadReader, inflate });
  return { title: cutText(file.name, MAX_TITLE_LENGTH), ...read };
}
