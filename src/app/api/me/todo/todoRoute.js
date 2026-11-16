// Shared by the /api/me/todo routes (CONTRACT 24): the per-person rate limits, the route params
// and the paste route's own body reading. Not a route itself (no route.js here).
import { AppError } from '@/lib/errors';
import { checkRateLimit } from '@/lib/route';
import { idParamsSchema } from '@/modules/reports/schemas';
import { entryIdParamsSchema } from '@/modules/reports/todoSchemas';

// Per person, not per IP: behind the office network everyone shares one address. The card saves
// each tick and line at once, so a burst is normal; these only stop a stuck page or script.
const WRITES = { key: 'me-todo-writes', limit: 60, windowMs: 60_000 };
const SLACK_POSTS = { key: 'me-todo-slack', limit: 6, windowMs: 60_000 };
// The card asks every 5 seconds while a post is sending; reads are counted on their own.
const READS = { key: 'me-todo-reads', limit: 120, windowMs: 60_000 };
const ROUTE = '/api/me/todo';
/** The paste route's largest body: 20,000 characters of text, as JSON, with room to spare. */
export const MAX_BULK_BYTES = 128 * 1024;

/** One of the person's 60 to-do writes a minute (every route but GET and Slack). */
export function countWrite(user) {
  checkRateLimit(WRITES, ROUTE, `user:${user.id}`);
}

/** One of the person's 6 Slack posts a minute. */
export function countSlackPost(user) {
  checkRateLimit(SLACK_POSTS, ROUTE, `user:${user.id}`);
}

/** One of the person's 120 reads a minute. */
export function countRead(user) {
  checkRateLimit(READS, ROUTE, `user:${user.id}`);
}

/** The line id in the path; anything else is a line that isn't there. */
export function lineIdOf(params) {
  const parsed = idParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new AppError('NOT_FOUND', {
      message: "We couldn't find that task in today's to-do. Reload the page to see the latest.",
    });
  }
  return parsed.data.id;
}

/** The report entry id in the path; anything else is a project that isn't there. */
export function entryIdOf(params) {
  const parsed = entryIdParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new AppError('NOT_FOUND', {
      message: "We couldn't find that project in today's to-do. Reload the page to see the latest.",
    });
  }
  return parsed.data.entryId;
}

function tooLarge() {
  return new AppError('PAYLOAD_TOO_LARGE', { status: 413, message: 'That request is too large.' });
}

/**
 * Reads a JSON body of at most `max` bytes, stopping as soon as it is bigger (a missing or wrong
 * Content-Length doesn't matter).
 * @param {Request} request
 * @param {number} max bytes
 * @returns {Promise<unknown>} the parsed JSON ({} for an empty body)
 * @throws PAYLOAD_TOO_LARGE (413), BAD_REQUEST (not JSON)
 */
export async function readCappedJson(request, max) {
  if (Number(request.headers.get('content-length')) > max) throw tooLarge();
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('BAD_REQUEST', { message: 'The request body must be JSON.' });
  }
}
