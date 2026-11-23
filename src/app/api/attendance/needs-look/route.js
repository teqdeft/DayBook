// GET /api/attendance/needs-look — Needs a look this month for HR and Admins (CONTRACT 25, item
// 10): the current payroll month through today (Admins only for an Admin viewer).
// RATE_LIMITED past 60 a minute for one person.
import { checkRateLimit, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';

const PER_PERSON = { key: 'attendance-needs-look', limit: 60, windowMs: 60_000 };
const ROUTE = '/api/attendance/needs-look';

export const GET = withRoute({ permission: 'attendance.correct' }, async ({ user }) => {
  checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
  return attendance.getNeedsLook({ viewer: user });
});
