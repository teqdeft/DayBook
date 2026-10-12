// Employee detailed view: profile, numbers, calendar, hours, tasks to watch and report history.
// An Admin's page is 404 for anyone but another Admin (their attendance is Admin-only).
import { AppError } from '@/lib/errors';
import { withRoute } from '@/lib/route';
import { dashboard } from '@/modules/dashboard';
import { employeeDetailQuerySchema, userIdParamSchema } from '@/modules/dashboard/schemas';

export const GET = withRoute(
  { permission: 'team.view', query: employeeDetailQuerySchema },
  async ({ user, params, query }) => {
    const userId = userIdParamSchema.safeParse(params.userId);
    if (!userId.success)
      throw new AppError('NOT_FOUND', { message: "We couldn't find that person." });
    return dashboard.getEmployeeDetail({ userId: userId.data, viewer: user, ...query });
  },
);
