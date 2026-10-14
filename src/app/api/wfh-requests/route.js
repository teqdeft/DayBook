// GET /api/wfh-requests?status=&handledSince=&limit=&offset= — work-from-home requests: everyone's
// for HR and Admins (an Admin's for Admins only), otherwise the person's own (CONTRACT 17).
// POST /api/wfh-requests — body { fromDate, toDate?, reason }: a person asks HR to work from home.
import { listResult, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { wfhListSchema, wfhRequestSchema } from '@/modules/attendance/schemas';

export const GET = withRoute(
  { permission: 'signed_in', query: wfhListSchema },
  async ({ user, query }) => {
    const { items, total } = await attendance.listWfhRequests({ ...query, viewer: user });
    return listResult(items, { limit: query.limit, offset: query.offset, total });
  },
);

export const POST = withRoute(
  { permission: 'attendance.self', body: wfhRequestSchema, status: 201 },
  async ({ user, body, ip }) => attendance.requestWfh({ user, ip, ...body }),
);
