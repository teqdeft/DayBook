// GET /api/activity/export?date= — the team's screen time on one day (default today) as Excel,
// with the same people as the Screen time page (Admins for another Admin only).
import { xlsxResponse } from '@/lib/excel';
import { withRoute } from '@/lib/route';
import { activity } from '@/modules/activity';
import { dateQuerySchema } from '@/modules/activity/schemas';

export const GET = withRoute(
  { permission: 'activity.view_all', query: dateQuerySchema },
  async ({ user, query }) =>
    xlsxResponse(
      await activity.exportDay(await activity.resolveDate(query.date), { viewer: user }),
    ),
);
