// Company overview numbers (Admin). The requests are counted for the signed-in viewer.
import { withRoute } from '@/lib/route';
import { dashboard } from '@/modules/dashboard';
import { overviewQuerySchema } from '@/modules/dashboard/schemas';

export const GET = withRoute(
  { permission: 'overview.view', query: overviewQuerySchema },
  async ({ user, query }) => dashboard.getOverview({ viewer: user, range: query.range }),
);
