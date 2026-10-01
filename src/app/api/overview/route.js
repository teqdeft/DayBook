// Company overview numbers (Admin).
import { withRoute } from '@/lib/route';
import { dashboard } from '@/modules/dashboard';
import { overviewQuerySchema } from '@/modules/dashboard/schemas';

export const GET = withRoute(
  { permission: 'overview.view', query: overviewQuerySchema },
  async ({ query }) => dashboard.getOverview({ range: query.range }),
);
