// File downloads (CONTRACT 27, Downloads): the answer of `GET /api/project-files/[id]` (any type,
// always an attachment as application/octet-stream), `/view` (a magic-checked PNG, JPEG, GIF or
// WebP shown inline) and `/thumb` (the browser-made JPEG thumbnail). `canSeeFile` runs first, also
// before a 304. The file streams 64 KiB at a time (memory stays flat; when the person stops the
// download the stream and its handle are destroyed), with one Range (206, 416), If-Range, a strong
// ETag, If-None-Match (304) and headers that keep a file from ever running as a page.
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { FILE_SENTENCES, fileError, fileNotFound } from './errors';
import { pictureType } from './kinds';
import { contentDisposition } from './names';
import { contentRange, parseRange, unsatisfiedRange } from './ranges';
import { getForDownload } from './reads';

const CHUNK_BYTES = 65_536;
const CACHE = 'private, no-cache, no-transform'; // no-transform keeps Next's gzip off
const CSP = Object.freeze({
  download: "default-src 'none'; sandbox",
  picture: "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
});

/** The strong ETag of a file (files never change after upload). */
export const etagOf = (file) =>
  `"f${file.id}-${file.sizeBytes}-${new Date(file.createdAt).getTime()}"`;

/** If-None-Match holds this ETag (or `*`); weak comparison, as RFC 9110 asks for it. */
function noneMatch(header, etag) {
  if (!header) return false;
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === '*' || tag === etag);
}

/** The bytes to send: one range when asked for and If-Range (if any) is our ETag. */
function rangeFor(request, size, etag) {
  const range = request.headers.get('range');
  if (!range) return 'all';
  const ifRange = request.headers.get('if-range');
  if (ifRange && ifRange.trim() !== etag) return 'all';
  return parseRange(range, size);
}

/** Opens the disk file; a missing one is FILE_MISSING (404), with one warning naming the id. */
async function openFile(path, fileId) {
  try {
    return await open(path, 'r');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    logger.warn({ fileId }, 'files: the disk file is missing');
    throw fileError('FILE_MISSING');
  }
}

/** What a mode answers with: the disk path, Content-Type, disposition and CSP. */
function servingFor(mode, { file, path, thumbPath }) {
  if (mode === 'download') {
    return { path, type: 'application/octet-stream', kind: 'attachment', csp: CSP.download };
  }
  if (mode === 'view') {
    const type = file.isPicture ? pictureType(file.ext) : null;
    if (!type) throw new AppError('NOT_FOUND', { message: FILE_SENTENCES.notShown });
    return { path, type, kind: 'inline', csp: CSP.picture };
  }
  if (!thumbPath) throw fileNotFound();
  return { path: thumbPath, type: 'image/jpeg', kind: 'inline', csp: CSP.picture };
}

/**
 * The streamed answer for a file the viewer may see.
 * @param {{ request: Request, viewer: object, id: number | string,
 *   mode: 'download' | 'view' | 'thumb' }} args
 * @returns {Promise<Response>} 200, 206, 304 or 416
 * @throws NOT_FOUND ("We couldn't find that file."; `/view` of a file that isn't a picture "This
 *   file can't be shown here. Download it instead."), FILE_MISSING (404), FILES_UNAVAILABLE (503),
 *   UPDATE_NEEDED (503)
 */
export async function fileResponse({ request, viewer, id, mode = 'download' }) {
  const found = await getForDownload({ viewer, id });
  const serving = servingFor(mode, found);
  const etag = etagOf(found.file);
  const common = {
    'Cache-Control': CACHE,
    ETag: etag,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  };
  if (noneMatch(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: common });
  }
  const handle = await openFile(serving.path, found.file.id);
  try {
    const { size } = await handle.stat();
    const range = rangeFor(request, size, etag);
    const headers = {
      ...common,
      'Content-Type': serving.type,
      'Content-Disposition': contentDisposition(serving.kind, found.file.name),
      'Content-Security-Policy': serving.csp,
      'Accept-Ranges': 'bytes',
    };
    if (range === 'unsatisfiable' || size === 0) {
      await handle.close();
      if (range === 'unsatisfiable') {
        return new Response(null, {
          status: 416,
          headers: { ...headers, 'Content-Range': unsatisfiedRange(size) },
        });
      }
      return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } });
    }
    const { start, end } = range === 'all' ? { start: 0, end: size - 1 } : range;
    if (range !== 'all') headers['Content-Range'] = contentRange(start, end, size);
    headers['Content-Length'] = String(end - start + 1);
    const status = range === 'all' ? 200 : 206;
    if (request.method === 'HEAD') {
      // Next answers HEAD with the GET handler: the headers only, no stream left open.
      await handle.close();
      return new Response(null, { status, headers });
    }
    const stream = handle.createReadStream({ start, end, highWaterMark: CHUNK_BYTES });
    return new Response(Readable.toWeb(stream), { status, headers });
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

/**
 * A failed file link opened in the browser shows its sentence as a plain page: a 404 answers
 * `text/plain` with `Content-Security-Policy: sandbox` when the request's Accept holds
 * `text/html`; anything else (and every 5xx, which withRoute logs) is left to withRoute's JSON.
 * @param {Request} request
 * @param {unknown} error
 * @returns {Response | null}
 */
export function plainNotFound(request, error) {
  if (!(error instanceof AppError) || error.status !== 404) return null;
  if (!(request.headers.get('accept') ?? '').includes('text/html')) return null;
  return new Response(error.message, {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Security-Policy': 'sandbox',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
