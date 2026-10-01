// GET /api/reports/me?date=YYYY-MM-DD (default today): the person's report for the day. Creates
// the draft (with carry-over) when there is none and the day hasn't locked yet.
import { withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { reportForDateQuerySchema } from '@/modules/reports/schemas';

export const GET = withRoute(
  { permission: 'report.self', query: reportForDateQuerySchema },
  async ({ user, query }) => reports.openForDate({ user, workDate: query.date }),
);
