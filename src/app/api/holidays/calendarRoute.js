// Shared by the /api/holidays and /api/leave routes (CONTRACT 25, items 6 and 9): the per-person
// rate limits and the :id. Not a route itself (no route.js here).
import { AppError } from '@/lib/errors';
import { checkRateLimit } from '@/lib/route';
import { calendarIdOf } from '@/modules/attendance/calendarSchemas';

// Per person, not per IP: behind the office network everyone shares one address. Holidays and
// leave share one bucket of 60 writes and one of 120 reads a minute (the leave preview, asked
// 300 ms after each change in the Mark leave dialog, counts as a read).
const WRITES = { key: 'calendar-writes', limit: 60, windowMs: 60_000 };
const READS = { key: 'calendar-reads', limit: 120, windowMs: 60_000 };
const ROUTE = '/api/holidays-and-leave';

/** One of the person's 60 holiday and leave writes a minute. */
export function countWrite(user) {
  checkRateLimit(WRITES, ROUTE, `user:${user.id}`);
}

/** One of the person's 120 holiday and leave reads a minute. */
export function countRead(user) {
  checkRateLimit(READS, ROUTE, `user:${user.id}`);
}

/**
 * The :id of the path; anything but plain digits is NOT_FOUND with `message`, as a missing one.
 * @param {Record<string, string>} params
 * @param {string} message "That holiday no longer exists." / "That leave no longer exists."
 */
export function idFrom(params, message) {
  const id = calendarIdOf(params);
  if (!id) throw new AppError('NOT_FOUND', { message });
  return id;
}
