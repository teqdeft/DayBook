// GET /api/attendance/month?month=&filter= — everyone's payroll month for HR and Admins
// (CONTRACT 25, item 4): getMonth (a later month reads as the current one; Admins only for an
// Admin viewer). RATE_LIMITED past 60 a minute for one person.
import { checkRateLimit, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { monthQuerySchema } from '@/modules/attendance/monthSchemas';

// Per person, not per IP: behind the office network everyone shares one address.
const PER_PERSON = { key: 'attendance-month', limit: 60, windowMs: 60_000 };
const ROUTE = '/api/attendance/month';

export const GET = withRoute(
  { permission: 'attendance.correct', query: monthQuerySchema },
  async ({ user, query }) => {
    checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
    return attendance.getMonth({ viewer: user, month: query.month, filter: query.filter });
  },
);
