// GET /api/attendance/people/[userId]/month?month= — one person's payroll month for HR and Admins
// (CONTRACT 25, item 8). NOT_FOUND for an id that isn't plain digits, an unknown person or an
// Admin when the viewer isn't one; RATE_LIMITED past 60 a minute for one person.
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { personMonthQuerySchema, userIdParamSchema } from '@/modules/attendance/monthSchemas';

const PER_PERSON = { key: 'attendance-person-month', limit: 60, windowMs: 60_000 };
const ROUTE = '/api/attendance/people/month';

export const GET = withRoute(
  { permission: 'attendance.correct', query: personMonthQuerySchema },
  async ({ user, query, params }) => {
    checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
    const id = userIdParamSchema.safeParse(params.userId);
    if (!id.success) throw new AppError('NOT_FOUND', { message: "We couldn't find that person." });
    return attendance.getPersonMonth({ viewer: user, userId: id.data, month: query.month });
  },
);
