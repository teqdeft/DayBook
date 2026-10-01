// GET /api/activity/team?date= — every tracked person's screen time on one day (default today),
// with what each one is doing right now.
import { withRoute } from '@/lib/route';
import { activity } from '@/modules/activity';
import { dateQuerySchema } from '@/modules/activity/schemas';

export const GET = withRoute(
  { permission: 'activity.view_all', query: dateQuerySchema },
  async ({ query }) => activity.getTeamDay(await activity.resolveDate(query.date)),
);
