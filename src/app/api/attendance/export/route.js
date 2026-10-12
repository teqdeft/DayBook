// GET /api/attendance/export?date= — the day as an Excel file (Admins only for an Admin viewer).
import { xlsxResponse } from '@/lib/excel';
import { withRoute } from '@/lib/route';
import { attendance } from '@/modules/attendance';
import { dateQuerySchema } from '@/modules/attendance/schemas';

export const GET = withRoute(
  { permission: 'attendance.view_all', query: dateQuerySchema },
  async ({ user, query }) => {
    const date = await attendance.resolveDate(query.date);
    return xlsxResponse(await attendance.exportDay(date, { viewer: user }));
  },
);
