// GET /api/attendance/month/export?month=&userId= — the month Excel for HR and Admins (CONTRACT
// 25, item 4): everyone the viewer may see, or one person (userId). NOT_FOUND for an unknown
// person or a hidden Admin; 400 over 200 people; 429 while another month export is being built
// in this process; RATE_LIMITED past 10 a minute for one person.
import { checkRateLimit, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { monthExportQuerySchema } from '@/modules/attendance/monthSchemas';

const PER_PERSON = { key: 'attendance-month-export', limit: 10, windowMs: 60_000 };
const ROUTE = '/api/attendance/month/export';

export const GET = withRoute(
  { permission: 'attendance.correct', query: monthExportQuerySchema },
  async ({ user, query }) => {
    checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
    return attendance.exportMonthResponse({
      viewer: user,
      month: query.month,
      userId: query.userId,
    });
  },
);
