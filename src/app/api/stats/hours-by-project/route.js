// Hours by project from submitted reports in a date range (optionally one person's).
import { listResult, withRoute } from '@/lib/route';
import { dashboard } from '@/modules/dashboard';
import { hoursByProjectQuerySchema } from '@/modules/dashboard/schemas';

export const GET = withRoute(
  { permission: 'team.view', query: hoursByProjectQuerySchema },
  async ({ query }) => {
    const { rows, total } = await dashboard.getHoursByProject(query);
    return listResult(rows, { limit: query.limit, offset: query.offset, total });
  },
);
