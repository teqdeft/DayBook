// Small helpers of the three file routes (CONTRACT 27, Downloads and Management): the per-person
// rate limits (downloads, views and thumbnails share one bucket of 600 a minute; edits and deletes
// 120), the `[id]` of the path, the PATCH body read with a size cap, and the GET answer that shows
// a failed link's sentence as a plain page.
import { AppError } from '@/lib/errors';
import { checkRateLimit } from '@/lib/route';
import { projectFiles } from '@/modules/projectFiles';
import { fileNotFound } from '@/modules/projectFiles/errors';
import { routeId } from '@/modules/projectPlan/schemas';

const MINUTE = 60_000;

/** Per person per minute (Limits). */
export const FILE_LIMITS = Object.freeze({
  read: { key: 'project-files-read', limit: 600, windowMs: MINUTE },
  change: { key: 'project-files-change', limit: 120, windowMs: MINUTE },
});

/**
 * Counts one request of the person against its bucket (first, in every handler).
 * @param {keyof typeof FILE_LIMITS} kind
 * @param {{ id: number }} user
 * @throws RATE_LIMITED (429)
 */
export function countRequest(kind, user) {
  checkRateLimit(FILE_LIMITS[kind], `/api/project-files:${kind}`, `user:${user.id}`);
}

/**
 * The file id of the path; anything but a plain positive number is NOT_FOUND, as an unknown id.
 * @param {Record<string, string>} params
 * @throws NOT_FOUND ("We couldn't find that file.")
 */
export function fileIdOf(params) {
  const id = routeId(params);
  if (!id) throw fileNotFound();
  return id;
}

// A PATCH body is a name of at most 200 characters, a place and who sees it.
const MAX_BODY_BYTES = 4096;

function tooLarge() {
  return new AppError('PAYLOAD_TOO_LARGE', { status: 413, message: 'That request is too large.' });
}

/**
 * The PATCH body, read here rather than by withRoute: the rate limit counts the request first, and
 * a body far bigger than any edit is refused before it is parsed.
 * @param {Request} request
 * @returns {Promise<unknown>} the parsed JSON ({} for an empty body)
 * @throws PAYLOAD_TOO_LARGE (413), BAD_REQUEST (not JSON)
 */
export async function readEditBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw tooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw tooLarge();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('BAD_REQUEST', { message: 'The request body must be JSON.' });
  }
}

/**
 * GET of a file, its picture or its thumbnail for the signed-in person: the streamed answer, or
 * for a 404 opened as a page (Accept: text/html) the sentence as plain text. Every other error
 * goes to withRoute (a 5xx is logged there).
 * @param {{ user: object, params: Record<string, string>, request: Request }} context
 * @param {'download' | 'view' | 'thumb'} mode
 * @returns {Promise<Response>}
 */
export async function answerFile({ user, params, request }, mode) {
  try {
    countRequest('read', user);
    return await projectFiles.fileResponse({ request, viewer: user, id: fileIdOf(params), mode });
  } catch (error) {
    const plain = projectFiles.plainNotFound(request, error);
    if (plain) return plain;
    throw error;
  }
}
