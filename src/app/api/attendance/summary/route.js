// GET /api/attendance/summary?date= — the Attendance screen's numbers for a day.
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { dateQuerySchema } from '@/modules/attendance/schemas';

export const GET = withRoute(
  { permission: 'attendance.view_all', query: dateQuerySchema },
  async ({ query }) => attendance.getDaySummary(await attendance.resolveDate(query.date)),
);
