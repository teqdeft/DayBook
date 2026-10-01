// GET /api/reports?userId=&from=&to=&limit=&offset=: a person's reports, newest first. Other
// people's reports need team.view (checked in the service).
import { listResult, withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { listReportsQuerySchema } from '@/modules/reports/schemas';

export const GET = withRoute(
  { permission: 'signed_in', query: listReportsQuerySchema },
  async ({ user, query }) => {
    const { rows, total } = await reports.listReports({ user, ...query });
    return listResult(rows, { limit: query.limit, offset: query.offset, total });
  },
);
