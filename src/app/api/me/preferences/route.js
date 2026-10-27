// The signed-in person's own preferences (CONTRACT 21, My settings).
// GET → every key (stored values over the defaults). PATCH, body: one or more keys → saves them and
// returns every key; an unknown key, a wrong value or an empty body is VALIDATION_FAILED with the
// field named. RATE_LIMITED past 60 a minute for one person (GET and PATCH together).
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { preferences } from '@/modules/preferences';

// Per person, not per IP: behind the office network everyone shares one address. My settings saves
// each change at once, so a few quick toggles are normal; this only stops a stuck page or script.
const PER_PERSON = { key: 'me-preferences', limit: 60, windowMs: 60_000 };
const ROUTE = '/api/me/preferences';
// Every key at once is under 300 characters; anything far bigger isn't from My settings.
const MAX_BODY_LENGTH = 2048;

function tooLarge() {
  return new AppError('PAYLOAD_TOO_LARGE', { status: 413, message: 'That request is too large.' });
}

/**
 * The PATCH body, read here rather than by withRoute: the rate limit counts the request first,
 * and an oversized body is refused before it is parsed.
 * @param {Request} request
 * @returns {Promise<unknown>} the parsed JSON ({} for an empty body)
 * @throws PAYLOAD_TOO_LARGE (413), BAD_REQUEST (not JSON)
 */
async function readSmallJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_LENGTH) throw tooLarge();
  const text = await request.text();
  if (text.length > MAX_BODY_LENGTH) throw tooLarge();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('BAD_REQUEST', { message: 'The request body must be JSON.' });
  }
}

export const GET = withRoute({ permission: 'signed_in' }, async ({ user }) => {
  checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
  return preferences.getFor(user.id);
});

// preferences.update validates the body (preferencesUpdateSchema).
export const PATCH = withRoute({ permission: 'signed_in' }, async ({ user, request }) => {
  checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
  return preferences.update({ user, values: await readSmallJson(request) });
});
