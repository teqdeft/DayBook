// Team dashboard data for today: numbers, attendance donut, urgent projects and the team board.
// Admins' attendance shows only to another Admin, so the signed-in person is passed on.
import { withRoute } from '@/lib/route';
import { dashboard } from '@/modules/dashboard';
import { teamTodayQuerySchema } from '@/modules/dashboard/schemas';

export const GET = withRoute(
  { permission: 'team.view', query: teamTodayQuerySchema },
  async ({ user, query }) => dashboard.getTeamToday({ filter: query.filter, viewer: user }),
);
