// The body of a document or AI route, read by the route rather than by withRoute: it is counted as it
// arrives and refused past 1 MB, before anything is parsed. 200,000 characters of any script fit.
import { AppError } from '@/lib/errors';

export const MAX_BODY_BYTES = 1024 * 1024;

function tooLarge() {
  return new AppError('PAYLOAD_TOO_LARGE', { status: 413, message: 'That request is too large.' });
}

/**
 * The raw body as text. A body without a Content-Length is counted as it arrives, so it never fills
 * the memory first.
 * @param {Request} request
 * @param {number} limit bytes
 * @returns {Promise<string>}
 * @throws PAYLOAD_TOO_LARGE (413)
 */
async function readLimitedText(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) throw tooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The parsed JSON body of a request of at most 1 MB.
 * @param {Request} request
 * @param {{ limit?: number }} [options] limit in bytes
 * @returns {Promise<unknown>} the parsed JSON ({} for an empty body)
 * @throws PAYLOAD_TOO_LARGE (413), BAD_REQUEST (not JSON)
 */
export async function readLimitedJson(request, { limit = MAX_BODY_BYTES } = {}) {
  const text = await readLimitedText(request, limit);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('BAD_REQUEST', { message: 'The request body must be JSON.' });
  }
}
