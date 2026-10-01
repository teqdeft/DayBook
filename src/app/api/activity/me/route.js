// GET /api/activity/me?from=&to= — the signed-in person's own screen time per day (defaults to
// this month so far).
import { withRoute } from '@/lib/route';
import { activity } from '@/modules/activity';
import { rangeQuerySchema } from '@/modules/activity/schemas';

export const GET = withRoute(
  { permission: 'activity.self', query: rangeQuerySchema },
  async ({ user, query }) => activity.getMyRange({ user, ...query }),
);
