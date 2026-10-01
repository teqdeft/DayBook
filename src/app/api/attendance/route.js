// GET /api/attendance?date=&filter=late|wfh|not_checked_in|unverified — everyone's row for a day.
// POST /api/attendance — HR adds a row for someone who forgot to check in (reason required).
import { listResult, withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { createRowSchema, listQuerySchema } from '@/modules/attendance/schemas';

export const GET = withRoute(
  { permission: 'attendance.view_all', query: listQuerySchema },
  async ({ query }) => {
    const date = await attendance.resolveDate(query.date);
    const { items, total } = await attendance.listForDay({ ...query, date });
    return listResult(items, { limit: query.limit, offset: query.offset, total });
  },
);

export const POST = withRoute(
  { permission: 'attendance.correct', body: createRowSchema, status: 201 },
  async ({ user, body, ip }) => attendance.createForUser({ actor: user, ...body, ip }),
);
