// GET /api/report-edit-requests?status=pending|handled (report.approve_edit): requests this person
// may handle. POST (report.self): ask to edit a locked report, or add a forgotten day.
import { listResult, withRoute } from '@/lib/route';
import { reports } from '@/modules/reports';
import { editRequestSchema, listEditRequestsQuerySchema } from '@/modules/reports/schemas';

export const GET = withRoute(
  { permission: 'report.approve_edit', query: listEditRequestsQuerySchema },
  async ({ user, query }) => {
    const { rows, total } = await reports.pageEditRequestsFor(user, query);
    return listResult(rows, { limit: query.limit, offset: query.offset, total });
  },
);

export const POST = withRoute(
  { permission: 'report.self', body: editRequestSchema, status: 201 },
  async ({ user, body }) =>
    reports.requestEdit({ user, workDate: body.workDate, reason: body.reason }),
);
