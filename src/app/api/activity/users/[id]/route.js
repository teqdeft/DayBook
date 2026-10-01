// GET /api/activity/users/[id]?from=&to= — one person's screen time per day, for PMs and Admin
// (defaults to this month so far).
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { activity } from '@/modules/activity';
import { rangeQuerySchema, userIdParamSchema } from '@/modules/activity/schemas';

export const GET = withRoute(
  { permission: 'activity.view_all', query: rangeQuerySchema },
  async ({ params, query }) => {
    const userId = userIdParamSchema.safeParse(params.id);
    if (!userId.success) {
      throw new AppError('NOT_FOUND', { message: "We couldn't find that person." });
    }
    return activity.getUserRange({ userId: userId.data, ...query });
  },
);
