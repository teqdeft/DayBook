// Reads the text of a Word .docx in the browser (CONTRACT 22), with nothing but the platform. A .docx
// is a zip: Daybook finds word/document.xml in its central directory, inflates it with the browser's
// own DecompressionStream and takes the text out with a small tokenizer. There is no DOMParser, no
// DTD and no entity beyond XML's own five and numeric references, so nothing in a file is ever run
// or fetched. Pure apart from DecompressionStream, which the tests swap for node:zlib.
import { docxText } from './docxText';

/** The most an unzipped word/document.xml may hold. */
export const MAX_XML_BYTES = 50 * 1024 * 1024;

const DOCUMENT_PART = 'word/document.xml';
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];
const SIGNATURES = Object.freeze({
  end: 0x06054b50,
  zip64Locator: 0x07064b50,
  central: 0x02014b50,
  local: 0x04034b50,
});
const END_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;
const ZIP64_MARK = 0xffffffff;
const ENCRYPTED_FLAGS = 0x0001 | 0x0040; // traditional and strong encryption
const STORED = 0;
const DEFLATED = 8;

/**
 * A .docx Daybook can't read. `code`: 'ole' (an OLE file: a password-protected .docx or an old
 * .doc), 'unsupported' (this browser has no DecompressionStream) or 'broken'; `message` is for
 * developers, never the screen.
 */
export class DocxError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'DocxError';
    this.code = code;
  }
}

const broken = (why) => new DocxError('broken', why);

/**
 * The browser's own inflate for a zip entry's raw deflate data.
 * @param {Uint8Array} bytes
 * @returns {ReadableStream<Uint8Array>}
 */
export function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new DocxError('unsupported', 'No DecompressionStream in this browser.');
  }
  return new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
}

/** True for an OLE compound file, which Word uses for .doc and for a .docx with a password. */
export function isOleFile(bytes) {
  return OLE_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** The end of central directory record, searched from the end past any comment. */
function findEnd(view) {
  const last = view.byteLength - END_SIZE;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let at = last; at >= first; at -= 1) {
    if (view.getUint32(at, true) !== SIGNATURES.end) continue;
    if (at + END_SIZE + view.getUint16(at + 20, true) <= view.byteLength) return at;
  }
  throw broken('No end of central directory.');
}

/** Where the central directory is. Split archives and zip64 are refused. */
function centralDirectory(view) {
  const end = findEnd(view);
  if (end >= 20 && view.getUint32(end - 20, true) === SIGNATURES.zip64Locator) {
    throw broken('Zip64 archive.');
  }
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
    throw broken('Split archive.');
  }
  if (count === 0xffff || size === ZIP64_MARK || offset === ZIP64_MARK) throw broken('Zip64.');
  if (offset + size > end) throw broken('Central directory out of bounds.');
  return { count, start: offset, limit: offset + size };
}

/**
 * The central directory entry of one part. Its sizes are the ones to trust: a local header
 * written before its data descriptor holds zeros.
 * @returns {{ flags: number, method: number, compressedSize: number, size: number,
 *   localOffset: number } | null}
 */
function findEntry(bytes, view, wanted) {
  const { count, start, limit } = centralDirectory(view);
  const names = new TextDecoder();
  let at = start;
  for (let index = 0; index < count; index += 1) {
    if (at + CENTRAL_SIZE > limit || view.getUint32(at, true) !== SIGNATURES.central) {
      throw broken('Bad central directory entry.');
    }
    const nameLength = view.getUint16(at + 28, true);
    const next = at + CENTRAL_SIZE + nameLength + view.getUint16(at + 30, true);
    const end = next + view.getUint16(at + 32, true);
    if (end > limit) throw broken('Central directory entry out of bounds.');
    const name = names.decode(bytes.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength));
    if (name.toLowerCase() === wanted) {
      return {
        flags: view.getUint16(at + 8, true),
        method: view.getUint16(at + 10, true),
        compressedSize: view.getUint32(at + 20, true),
        size: view.getUint32(at + 24, true),
        localOffset: view.getUint32(at + 42, true),
      };
    }
    at = end;
  }
  return null;
}

/** An entry's stored bytes, still compressed, after its local header. */
function entryData(bytes, view, entry) {
  if (entry.flags & ENCRYPTED_FLAGS) throw broken('Encrypted entry.');
  if ([entry.compressedSize, entry.size, entry.localOffset].includes(ZIP64_MARK)) {
    throw broken('Zip64 entry.');
  }
  if (entry.method !== STORED && entry.method !== DEFLATED) throw broken('Unknown method.');
  const at = entry.localOffset;
  if (at + LOCAL_SIZE > bytes.length || view.getUint32(at, true) !== SIGNATURES.local) {
    throw broken('Bad local header.');
  }
  const start = at + LOCAL_SIZE + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  if (start + entry.compressedSize > bytes.length) throw broken('Entry out of bounds.');
  return bytes.subarray(start, start + entry.compressedSize);
}

/**
 * Inflates an entry as text, stopping as soon as it passes `maxBytes`, before the rest is inflated.
 * @param {ReadableStream<Uint8Array>} stream
 */
async function inflatedText(stream, { maxBytes, signal }) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let total = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw broken('document.xml is too big.');
      parts.push(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    if (error instanceof DocxError || signal?.aborted) throw error;
    throw broken('Inflate failed.');
  }
  parts.push(decoder.decode());
  return parts.join('');
}

/** The part's XML as text. */
async function partText(data, entry, { inflate, maxBytes, signal }) {
  if (entry.method === STORED) {
    if (data.byteLength > maxBytes) throw broken('document.xml is too big.');
    return new TextDecoder().decode(data);
  }
  return inflatedText(inflate(data), { maxBytes, signal });
}

/**
 * The text of a .docx, in document order (see docxText).
 * @param {Uint8Array} bytes the whole file
 * @param {{ inflate?: (bytes: Uint8Array) => ReadableStream<Uint8Array>, maxXmlBytes?: number,
 *   signal?: AbortSignal }} [options] inflate: raw deflate to a stream (the browser's
 *   DecompressionStream by default); maxXmlBytes: the most the unzipped document.xml may hold
 * @returns {Promise<string>} the text, possibly empty
 * @throws {DocxError} 'ole', 'unsupported' or 'broken'; the signal's reason when stopped
 */
export async function readDocxText(
  bytes,
  { inflate = inflateRaw, maxXmlBytes = MAX_XML_BYTES, signal } = {},
) {
  if (isOleFile(bytes)) throw new DocxError('ole', 'An OLE compound file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entry = findEntry(bytes, view, DOCUMENT_PART);
  if (!entry) throw broken('No word/document.xml.');
  const data = entryData(bytes, view, entry);
  signal?.throwIfAborted();
  const text = docxText(await partText(data, entry, { inflate, maxBytes: maxXmlBytes, signal }));
  if (text === null) throw broken('document.xml is not a Word document.');
  return text;
}
