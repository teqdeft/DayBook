// HR's break fixes (CONTRACT 25, item 2), attendance.correct only, never on their own row:
// PATCH /api/attendance/:id/breaks/:breakId { endClock: 'HH:mm', reason } changes the end;
// DELETE with a body { reason } (as push/subscriptions) deletes the break. Both return the
// BreakList. FORBIDDEN (own row), NOT_FOUND, VALIDATION_FAILED, UPDATE_NEEDED (503, before
// migration 018); RATE_LIMITED past 60 a minute for one person.
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import {
  breakChangeSchema,
  breakDeleteSchema,
  breakRouteIds,
} from '@/modules/attendance/breakSchemas';

const PER_PERSON = { key: 'attendance-breaks-fix', limit: 60, windowMs: 60_000 };
const ROUTE = '/api/attendance/breaks/fix';

/** The row and break ids, after counting the request. @throws RATE_LIMITED, NOT_FOUND */
function idsFor({ user, params }) {
  checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
  const ids = breakRouteIds(params);
  if (!ids?.breakId) throw new AppError('NOT_FOUND');
  return ids;
}

export const PATCH = withRoute(
  { permission: 'attendance.correct', body: breakChangeSchema },
  async ({ user, params, body, ip }) =>
    attendance.changeBreakEnd({ actor: user, ...idsFor({ user, params }), ...body, ip }),
);

export const DELETE = withRoute(
  { permission: 'attendance.correct', body: breakDeleteSchema },
  async ({ user, params, body, ip }) =>
    attendance.deleteBreak({ actor: user, ...idsFor({ user, params }), ...body, ip }),
);
