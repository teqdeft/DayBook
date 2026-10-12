// GET /api/activity/team?date= — every tracked person's screen time on one day (default today),
// with what each one is doing right now. Admins are listed for another Admin only.
import { withRoute } from '@/lib/route';
import { activity } from '@/modules/activity';
import { dateQuerySchema } from '@/modules/activity/schemas';

export const GET = withRoute(
  { permission: 'activity.view_all', query: dateQuerySchema },
  async ({ user, query }) =>
    activity.getTeamDay(await activity.resolveDate(query.date), { viewer: user }),
);
