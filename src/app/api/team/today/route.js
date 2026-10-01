// Team dashboard data for today: numbers, attendance donut, urgent projects and the team board.
import { withRoute } from '@/lib/route';
import { dashboard } from '@/modules/dashboard';
import { teamTodayQuerySchema } from '@/modules/dashboard/schemas';

export const GET = withRoute(
  { permission: 'team.view', query: teamTodayQuerySchema },
  async ({ query }) => dashboard.getTeamToday({ filter: query.filter }),
);
