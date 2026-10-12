// GET /api/attendance/summary?date= — the Attendance screen's numbers for a day, counting Admins
// only for an Admin viewer.
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { dateQuerySchema } from '@/modules/attendance/schemas';

export const GET = withRoute(
  { permission: 'attendance.view_all', query: dateQuerySchema },
  async ({ user, query }) =>
    attendance.getDaySummary(await attendance.resolveDate(query.date), { viewer: user }),
);
