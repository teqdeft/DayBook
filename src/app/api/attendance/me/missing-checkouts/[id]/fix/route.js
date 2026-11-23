// POST /api/attendance/me/missing-checkouts/:id/fix (CONTRACT 25, item B): the person enters the
// time they left for one of their own missing check-outs from Today's pop-up. Body { checkOut:
// 'HH:mm', reason? } → { outcome: 'saved', row, missing } within the self-fix limit, or
// { outcome: 'sent', correction, missing } after it (a check_out correction request for HR).
// NOT_FOUND for anything but the person's own missing row of the last 30 days (also an id that
// isn't plain digits), VALIDATION_FAILED (checkOut, reason), CONFLICT, REQUEST_ALREADY_PENDING,
// UPDATE_NEEDED before migration 018. RATE_LIMITED past 20 a minute for one person.
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { isPlainId, selfFixSchema } from '@/modules/attendance/missingSchemas';

// Per person, not per IP: behind the office network everyone shares one address.
const PER_PERSON = { key: 'attendance-missing-self-fix', limit: 20, windowMs: 60_000 };
const ROUTE = '/api/attendance/me/missing-checkouts/fix';

export const POST = withRoute(
  { permission: 'attendance.self', body: selfFixSchema },
  async ({ user, body, params, ip }) => {
    checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
    if (!isPlainId(params.id)) {
      throw new AppError('NOT_FOUND', { message: "We couldn't find that missing check-out." });
    }
    return attendance.fixMyMissingCheckout({
      user,
      attendanceId: Number(params.id),
      checkOut: body.checkOut,
      reason: body.reason,
      ip,
    });
  },
);
