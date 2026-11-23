// POST /api/attendance/missing-checkouts/fix (CONTRACT 25, item 7): HR fixes missing check-outs
// in one go. Body { items: [{ attendanceId, checkOut: 'HH:mm' }] (1 to 50), reason (2 to 500) } →
// { fixed: [{ attendanceId, checkOutAt }], failed: [{ attendanceId, field, message }] }, 200 even
// when every row fails (each row has its own message). Reads its own body: the rate limit counts
// the request first, then a body over 16 KB is 413 PAYLOAD_TOO_LARGE, then it is parsed
// (VALIDATION_FAILED). RATE_LIMITED past 10 a minute for one person.
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { bulkFixSchema, parseBody } from '@/modules/attendance/missingSchemas';

const PER_PERSON = { key: 'attendance-missing-bulk-fix', limit: 10, windowMs: 60_000 };
const ROUTE = '/api/attendance/missing-checkouts/fix';
const MAX_BODY_BYTES = 16 * 1024;

function tooLarge() {
  return new AppError('PAYLOAD_TOO_LARGE', { status: 413, message: 'That request is too large.' });
}

/**
 * The body as JSON, refused before parsing when it is over 16 KB.
 * @param {Request} request
 * @returns {Promise<unknown>} {} for an empty body
 * @throws PAYLOAD_TOO_LARGE (413), BAD_REQUEST (not JSON)
 */
async function readCappedJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw tooLarge();
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw tooLarge();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('BAD_REQUEST', { message: 'The request body must be JSON.' });
  }
}

export const POST = withRoute(
  { permission: 'attendance.correct' },
  async ({ user, request, ip }) => {
    checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
    const body = parseBody(bulkFixSchema, await readCappedJson(request));
    return attendance.fixMissingCheckouts({
      actor: user,
      items: body.items,
      reason: body.reason,
      ip,
    });
  },
);
